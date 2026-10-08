// Resumable uploads of dataset files with the tus protocol (https://tus.io), mounted at /api/files/upload in index.ts
// A client creates an upload with metadata (dataset_id, type, filename, and optionally version and updates), sends the file in chunks
// (and can resume after a dropped connection), and when the last chunk arrives the file is moved into place and its Files row is created
import { Server } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { ActivityType } from "@commons/activity.ts";
import { FileTypes, type IFile } from "@commons/file.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { userFromHeader } from "@src/middleware/auth.ts";
import { Datasets } from "@src/models/dataset.ts";
import { getAccess, hasAccess } from "@src/services/access.ts";
import { logActivityAs, toPlain } from "@src/services/activity.ts";
import * as service from "@src/services/file.ts";
import * as storage from "@src/services/storage.ts";
import { randomUUID } from "node:crypto";

// Largest accepted upload; 30 GiB unless UPLOAD_MAX_BYTES is set
export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 30 * 1024 * 1024 * 1024;
// Unfinished uploads are deleted this long after they were created (long enough to resume a 30 GiB upload after a break)
const EXPIRATION_MS = 48 * 60 * 60 * 1000;

// Route the tus server answers on (the frontend uses the same path)
export const TUS_PATH = "/api/files/upload";

// Rejects the tus request with this status and message (the shape @tus/server expects from a hook)
const reject = (status_code: number, message: string) => ({ status_code, body: `${message}\n` });

// Metadata keys a client may send; user_id is added by the server and any client-sent value is dropped
const METADATA_KEYS = ["dataset_id", "type", "filename", "version", "updates"] as const;

// File records need the metadata as a typed object; this also validates it, returning an error message or the parsed values
const parseMetadata = (metadata: Record<string, string | null | undefined> = {}, size: number | undefined) => {
    const { dataset_id, type, filename, version, updates } = metadata;
    if (!dataset_id) return "dataset_id is required";
    if (!type) return "type is required";
    if (!filename) return "filename is required";
    if (size === undefined) return "The upload size must be known up front (Upload-Length)";
    const fields: Partial<IFile> & Pick<IFile, "dataset_id" | "type" | "ogName" | "sizeBytes"> = {
        dataset_id,
        type: type as FileTypes,
        ogName: filename,
        sizeBytes: size,
    };
    if (version) fields.version = Number(version);
    if (updates) fields.updates = updates;
    const invalid = service.validateFileFields(fields);
    if (invalid) return invalid;
    // The extension (and for covers the size) must fit the file type; mime types are not checked since tus does not carry them
    const allowed = storage.ALLOWED_EXTENSIONS[fields.type];
    if (!allowed.includes(storage.extensionOf(fields.ogName)))
        return `A ${fields.type} file must have one of these extensions: ${allowed.join(", ")}`;
    if (fields.type === FileTypes.COVER && size > storage.MAX_COVER_BYTES)
        return `A COVER file must be at most ${storage.MAX_COVER_BYTES / 1024 / 1024} MB`;
    // Update notes are only collected for RDS files
    if (fields.updates && fields.type !== FileTypes.RDS) return "updates are only allowed on RDS files";
    return fields;
};

// Incoming uploads are stored here until they are complete (see services/storage.ts for the final locations)
const datastore = new FileStore({ directory: storage.TMP_DIR, expirationPeriodInMilliseconds: EXPIRATION_MS });

export const tusServer = new Server({
    path: TUS_PATH,
    datastore,
    maxSize: MAX_UPLOAD_BYTES,
    // Behind a proxy the Location header must use the public host and protocol
    respectForwardedHeaders: true,
    // The browser app is the only origin that may upload
    allowedOrigins: process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : [],

    // A finished or half-finished upload can only be continued or inspected by the user who created it
    onIncomingRequest: async (req, uploadId) => {
        if (req.method === "OPTIONS" || !uploadId) return;
        const upload = await datastore.getUpload(uploadId).catch(() => null);
        if (!upload) return; // unknown id: tus answers 404 itself
        const user = await userFromHeader(req.headers.get("authorization"));
        if (!user || upload.metadata?.user_id !== user.id) throw reject(403, "Forbidden");
    },

    // Validates a new upload before any bytes are accepted
    onUploadCreate: async (req, upload) => {
        const user = await userFromHeader(req.headers.get("authorization"));
        if (!user) throw reject(401, "Unauthorized");
        const parsed = parseMetadata(upload.metadata, upload.size);
        if (typeof parsed === "string") throw reject(400, parsed);
        // EDIT access to the dataset; 404 when it does not exist or is not visible, so private datasets are not revealed
        const dataset = await Datasets.findByPk(parsed.dataset_id);
        const access = dataset ? await getAccess(user, dataset) : null;
        if (!access) throw reject(404, "Dataset not found");
        if (!hasAccess(access, PermissionOptions.EDIT)) throw reject(403, "Forbidden");
        // Fail early (before sending gigabytes) when the requested version is not newer than the latest one; checked again at the end
        const latest = await service.latestVersion(parsed.dataset_id, parsed.type);
        if (parsed.version !== undefined && parsed.version <= latest)
            throw reject(400, `version must be higher than the latest version (${latest})`);
        const metadata: Record<string, string> = { user_id: user.id };
        for (const key of METADATA_KEYS) if (upload.metadata?.[key] != null) metadata[key] = upload.metadata[key];
        return { metadata };
    },

    // The last chunk has arrived: move the file into place and create its record as the current version
    onUploadFinish: async (req, upload) => {
        const parsed = parseMetadata(upload.metadata, upload.size);
        const user_id = upload.metadata?.user_id;
        if (typeof parsed === "string" || !user_id) throw reject(400, "Invalid upload metadata");
        const tmpPath = upload.storage?.path;
        if (!tmpPath) throw reject(500, "Upload not found on disk");
        try {
            const latest = await service.latestVersion(parsed.dataset_id, parsed.type);
            const version = parsed.version ?? latest + 1;
            if (version <= latest) throw reject(409, `version must be higher than the latest version (${latest})`);
            const record = { ...parsed, version, updates: parsed.updates ?? null, id: randomUUID(), user_id };
            // The move runs inside the transaction: a failed move leaves no row, and a failed row (e.g. a duplicate version) moves nothing
            const { created, replaced } = await service.createCurrent(record, () => storage.store(tmpPath, record));
            // Only the current version is kept on disk. The new file is already stored and recorded, so a failed cleanup
            // is only logged: throwing would make the catch below answer 500 for an upload that succeeded
            await storage.removeStored(replaced).catch((err) => console.error("[TUS] Failed to remove replaced files:", err));
            console.log(`[TUS] Stored upload at ${storage.storedPath(record)}`);
            await logActivityAs(user_id, ActivityType.FILE_UPLOADED, toPlain(created));
            return { status_code: 200, body: JSON.stringify(toPlain(created)) };
        } catch (err) {
            // The upload is complete but unusable: don't leave gigabytes in the temporary folder
            await datastore.remove(upload.id).catch(() => {});
            if (err && typeof err === "object" && "status_code" in err) throw err;
            console.error("[TUS] Failed to finish upload:", err);
            throw reject(500, "Unable to save the uploaded file");
        } finally {
            // After a successful move the data file is gone; this drops the leftover .json info file (and the data file on failure)
            await datastore.configstore.delete(upload.id).catch(() => {});
        }
    },
});

/** Deletes unfinished uploads past their expiration; run on a timer from index.ts */
export const cleanUpExpiredUploads = async () => {
    try {
        const removed = await tusServer.cleanUpExpiredUploads();
        if (removed) console.log(`[TUS] Removed ${removed} expired uploads`);
    } catch (err) {
        console.error("[TUS] Failed to clean up expired uploads:", err);
    }
};

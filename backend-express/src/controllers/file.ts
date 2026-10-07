// Request handlers for Files; thin wrappers that call the file service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/file.ts";
import { IFile } from "@src/models/file.ts";
import { authorizeDataset, caller } from "@src/services/access.ts";
import { pick } from "@src/utils/pick.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";
import { FileTypes } from "@commons/file.ts";

// Whitelist of columns clients may set when creating a file; user_id is always the caller (see create)
const FILE_FIELDS = ["dataset_id", "type", "sizeBytes", "ogName"] as const;
// A file cannot move to another dataset or change uploader after creation
const FILE_UPDATE_FIELDS = ["type", "sizeBytes", "ogName"] as const;

// Returns an error message for the first client-supplied field that is present but invalid, or null if all are fine.
// Changing type on update (or creating a second file of a kind) can violate the one-file-per-kind unique constraint;
// that surfaces as a UniqueConstraintError, which the global error handler in index.ts maps to 409
const validateFileFields = (fields: Partial<IFile>) => {
    if (fields.type !== undefined && !Object.values(FileTypes).includes(fields.type))
        return `type must be one of: ${Object.values(FileTypes).join(", ")}`;
    if (fields.sizeBytes !== undefined && !(Number.isSafeInteger(fields.sizeBytes) && fields.sizeBytes >= 0))
        return "sizeBytes must be a non-negative integer";
    // 255 matches the STRING column length of ogName
    if (fields.ogName !== undefined && (typeof fields.ogName !== "string" || !fields.ogName.trim() || fields.ogName.length > 255))
        return "ogName must be a non-empty string of at most 255 characters";
    return null;
};

// Files follow the access rules of their dataset: VIEW to read, EDIT to create, change or delete.
// Loads a file and checks the caller's access to its dataset; on failure it sends 404/403 and returns null
const authorizeFile = async (res: Response, id: string, min: PermissionOptions) => {
    const file = await service.getById(id);
    if (!file) {
        console.log("[FILE CONTROLLER] File not found");
        res.status(404).json({ error: "File not found" });
        return null;
    }
    return (await authorizeDataset(res, file.dataset_id, min, "File not found")) ? file : null;
};

// GET /files?dataset_id=... lists the files of one dataset the caller may view; without dataset_id only admins may list every file
export const list = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to list files...");
    const datasetId = typeof req.query.dataset_id === "string" ? req.query.dataset_id : undefined;
    if (datasetId) {
        if (!(await authorizeDataset(res, datasetId, PermissionOptions.VIEW))) return;
    } else if (caller(res)?.role !== UserRoles.ADMIN) {
        return res.status(caller(res) ? 403 : 401).json({ error: caller(res) ? "Forbidden" : "Unauthorized" });
    }
    res.status(200).json(await service.getAll(datasetId));
};

/** GET /byDataset/:datasetId : lists the files of one dataset (200); 404 if it does not exist or the caller cannot view it */
export const listByDataset = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to list files by dataset...");
    if (!(await authorizeDataset(res, req.params.datasetId as string, PermissionOptions.VIEW))) return;
    res.status(200).json(await service.getAll(req.params.datasetId as string));
};

/** GET /:id : returns one file (200), or 404 if it does not exist or its dataset is not visible to the caller */
export const get = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to get file...");
    const item = await authorizeFile(res, req.params.id as string, PermissionOptions.VIEW);
    if (item) res.status(200).json(item);
};

/** POST / : creates a file on the body's dataset (201), uploaded by the caller; needs EDIT access to that dataset */
export const create = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to create file...");
    const fields = pick<IFile>(req.body, FILE_FIELDS);
    if (typeof fields.dataset_id !== "string") return res.status(400).json({ error: "dataset_id is required" });
    if (!(await authorizeDataset(res, fields.dataset_id, PermissionOptions.EDIT))) return;
    // All three are NOT NULL columns, so they are required on create
    if (fields.type === undefined || fields.sizeBytes === undefined || fields.ogName === undefined)
        return res.status(400).json({ error: "type, sizeBytes and ogName are required" });
    const invalid = validateFileFields(fields);
    if (invalid) return res.status(400).json({ error: invalid });
    res.status(201).json(await service.create({ ...fields, user_id: caller(res)!.id }));
};

/** PUT /:id : updates an existing file (200); needs EDIT access to its dataset (404 if not found or not visible, 403 otherwise) */
export const update = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to update file...");
    if (!(await authorizeFile(res, req.params.id as string, PermissionOptions.EDIT))) return;
    const fields = pick<IFile>(req.body, FILE_UPDATE_FIELDS);
    const invalid = validateFileFields(fields);
    if (invalid) return res.status(400).json({ error: invalid });
    res.status(200).json(await service.update(req.params.id as string, fields));
};

/** DELETE /:id : deletes a file (204 with no body); needs EDIT access to its dataset (404 if not found or not visible, 403 otherwise) */
export const remove = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to delete file...");
    if (!(await authorizeFile(res, req.params.id as string, PermissionOptions.EDIT))) return;
    await service.remove(req.params.id as string);
    res.status(204).send();
};

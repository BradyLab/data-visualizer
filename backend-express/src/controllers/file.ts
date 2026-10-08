// Request handlers for Files; thin wrappers that call the file service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/file.ts";
import { IFile } from "@src/models/file.ts";
import { diff, logActivity, toPlain } from "@src/services/activity.ts";
import { authorizeDataset, caller } from "@src/services/access.ts";
import { pick } from "@src/utils/pick.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";
import { ActivityType } from "@commons/activity.ts";
import { FileTypes } from "@commons/file.ts";
import * as storage from "@src/services/storage.ts";

// Once uploaded, only the update notes can change (the stored file and its version are fixed; upload a new version instead)
const FILE_UPDATE_FIELDS = ["updates"] as const;

// Files follow the access rules of their dataset: VIEW to read, EDIT to upload (see services/tus.ts), change or delete.
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

/** PUT /:id : updates an existing file (200); needs EDIT access to its dataset (404 if not found or not visible, 403 otherwise) */
export const update = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to update file...");
    const file = await authorizeFile(res, req.params.id as string, PermissionOptions.EDIT);
    if (!file) return;
    const fields = pick<IFile>(req.body, FILE_UPDATE_FIELDS);
    const invalid = service.validateFileFields(fields);
    if (invalid) return res.status(400).json({ error: invalid });
    // Update notes are only collected for RDS files
    if (fields.updates && file.type !== FileTypes.RDS)
        return res.status(400).json({ error: "updates are only allowed on RDS files" });
    const updated = await service.update(file.id, fields);
    // There is no FILE_UPDATED type, so a changed file record (version or update notes) is logged as FILE_UPLOADED
    const changes = updated && diff(file, updated, FILE_UPDATE_FIELDS);
    if (changes) await logActivity(res, ActivityType.FILE_UPLOADED, { file_id: file.id, dataset_id: file.dataset_id, changes });
    res.status(200).json(updated);
};

/** DELETE /:id : deletes a file (204 with no body); needs EDIT access to its dataset (404 if not found or not visible, 403 otherwise) */
export const remove = async (req: Request, res: Response) => {
    console.log("[FILE CONTROLLER] Attempting to delete file...");
    const file = await authorizeFile(res, req.params.id as string, PermissionOptions.EDIT);
    if (!file) return;
    await service.remove(file.id);
    await storage.removeStored([file]);
    await logActivity(res, ActivityType.FILE_DELETED, toPlain(file));
    res.status(204).send();
};

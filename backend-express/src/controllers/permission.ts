// Request handlers for Permissions; thin wrappers that call the permission service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/permission.ts";
import { IPermission } from "@src/models/permission.ts";
import { pick } from "@src/utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const PERMISSION_FIELDS = ["user_id", "dataset_id", "perm"] as const;
// Returns the value only if it is a string (query params can also be arrays/objects)
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /permissions?user_id=...&dataset_id=... lists permissions, optionally filtered
export const list = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions...");
    const filters: { user_id?: string; dataset_id?: string } = {};
    const userId = str(req.query.user_id);
    const datasetId = str(req.query.dataset_id);
    if (userId) filters.user_id = userId;
    if (datasetId) filters.dataset_id = datasetId;
    res.status(200).json(await service.getAll(filters));
};

/** GET /byUser/:userId : lists all permissions of one user (200) */
export const listByUser = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions by user...");
    res.status(200).json(await service.getAll({ user_id: req.params.userId as string }));
};

/** GET /byDataset/:datasetId : lists all permissions on one dataset (200) */
export const listByDataset = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions by dataset...");
    res.status(200).json(await service.getAll({ dataset_id: req.params.datasetId as string }));
};

/** GET /:userId/:datasetId : returns one permission (200), or 404 if it does not exist */
export const get = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to get permission...");
    const item = await service.getById(req.params.userId as string, req.params.datasetId as string);
    if (!item) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    res.status(200).json(item);
};

/** POST / : creates a permission from the request body (201) */
export const create = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to create permission...");
    res.status(201).json(await service.create(pick<IPermission>(req.body, PERMISSION_FIELDS)));
};

/** PUT /:userId/:datasetId : updates an existing permission (200), or 404 if it does not exist */
export const update = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to update permission...");
    const item = await service.update(
        req.params.userId as string,
        req.params.datasetId as string,
        pick<IPermission>(req.body, ["perm"])
    );
    if (!item) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    res.status(200).json(item);
};

/** DELETE /:userId/:datasetId : deletes a permission (204 with no body), or 404 if it does not exist */
export const remove = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to delete permission...");
    if (!(await service.remove(req.params.userId as string, req.params.datasetId as string))) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    res.status(204).send();
};

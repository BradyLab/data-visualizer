// Request handlers for Permissions; thin wrappers that call the permission service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/permission.ts";
import { IPermission } from "@src/models/permission.ts";
import * as userService from "@src/services/user.ts";
import { diff, logActivity, toPlain } from "@src/services/activity.ts";
import { authorizeDataset, caller, OWNER } from "@src/services/access.ts";
import { Datasets } from "@src/models/dataset.ts";
import { pick } from "@src/utils/pick.ts";
import { ActivityType } from "@commons/activity.ts";
import { grantError, PermissionOptions } from "@commons/permissions.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const PERMISSION_FIELDS = ["user_id", "dataset_id", "perm"] as const;
// Only a dataset's OWNER (or an admin) may see or change who it is shared with, so these checks are all OWNER-level.
// Checks that perm is a valid level for the user receiving it (rules shared with the frontend, see commons/permissions.ts);
// returns the error message, or null if fine. OWNER is not a permission (it is the dataset's owner column), so it is never valid here
const checkGrant = async (dataset: Datasets, userId: string, perm: unknown) => {
    const target = await userService.getById(userId);
    if (!target) return "User not found";
    if (dataset.owner === userId) return "The owner already has full access to their dataset";
    return grantError(target.role, perm);
};

// Returns the value only if it is a string (query params can also be arrays/objects)
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /permissions?user_id=...&dataset_id=... lists permissions, optionally filtered (admin only, see the router)
export const list = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions...");
    const filters: { user_id?: string; dataset_id?: string } = {};
    const userId = str(req.query.user_id);
    const datasetId = str(req.query.dataset_id);
    if (userId) filters.user_id = userId;
    if (datasetId) filters.dataset_id = datasetId;
    res.status(200).json(await service.getAll(filters));
};

/** GET /byUser/:userId : lists all permissions of one user (200); the router limits it to that user or an admin */
export const listByUser = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions by user...");
    res.status(200).json(await service.getAll({ user_id: req.params.userId as string }));
};

/** GET /byDataset/:datasetId : lists all permissions on one dataset (200); needs OWNER access (404 if not found or not visible, 403 otherwise) */
export const listByDataset = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to list permissions by dataset...");
    if (!(await authorizeDataset(res, req.params.datasetId as string, OWNER))) return;
    res.status(200).json(await service.getAll({ dataset_id: req.params.datasetId as string }));
};

/** GET /:userId/:datasetId : returns one permission (200), or 404 if it does not exist; a user may read their own, otherwise it needs OWNER access */
export const get = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to get permission...");
    if (req.params.userId !== caller(res)!.id && !(await authorizeDataset(res, req.params.datasetId as string, OWNER))) return;
    const item = await service.getById(req.params.userId as string, req.params.datasetId as string);
    if (!item) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    res.status(200).json(item);
};

/**
 * POST / : creates a permission from the request body (201); needs OWNER access to the dataset, and perm must suit the
 * user's role (400 otherwise). A duplicate user/dataset pair becomes a 409 in the global error handler
 */
export const create = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to create permission...");
    const fields = pick<IPermission>(req.body, PERMISSION_FIELDS);
    if (typeof fields.user_id !== "string" || typeof fields.dataset_id !== "string")
        return res.status(400).json({ error: "user_id and dataset_id are required" });
    const found = await authorizeDataset(res, fields.dataset_id, OWNER);
    if (!found) return;
    // A missing perm defaults to VIEW; the same value is validated and stored so the two can't diverge
    const perm = fields.perm ?? PermissionOptions.VIEW;
    const problem = await checkGrant(found.dataset, fields.user_id, perm);
    if (problem) return res.status(400).json({ error: problem });
    const created = await service.create({ ...fields, perm });
    await logActivity(res, ActivityType.PERM_GRANTED, toPlain(created));
    res.status(201).json(created);
};

/** PUT /:userId/:datasetId : updates an existing permission (200), or 404 if it does not exist; needs OWNER access and a perm that suits the user's role (400) */
export const update = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to update permission...");
    const found = await authorizeDataset(res, req.params.datasetId as string, OWNER);
    if (!found) return;
    const problem = await checkGrant(found.dataset, req.params.userId as string, req.body?.perm);
    if (problem) return res.status(400).json({ error: problem });
    const before = await service.getById(req.params.userId as string, req.params.datasetId as string);
    const item = await service.update(
        req.params.userId as string,
        req.params.datasetId as string,
        pick<IPermission>(req.body, ["perm"])
    );
    if (!item) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    const changes = before && diff(before, item, ["perm"]);
    if (changes)
        await logActivity(res, ActivityType.PERM_GRANTED, { user_id: item.user_id, dataset_id: item.dataset_id, changes });
    res.status(200).json(item);
};

/** DELETE /:userId/:datasetId : deletes a permission (204 with no body), or 404 if it does not exist; needs OWNER access */
export const remove = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to delete permission...");
    if (!(await authorizeDataset(res, req.params.datasetId as string, OWNER))) return;
    const existing = await service.getById(req.params.userId as string, req.params.datasetId as string);
    if (!existing || !(await service.remove(req.params.userId as string, req.params.datasetId as string))) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    await logActivity(res, ActivityType.PERM_REVOKED, toPlain(existing));
    res.status(204).send();
};

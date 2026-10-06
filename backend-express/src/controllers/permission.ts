// Request handlers for Permissions; thin wrappers that call the permission service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/permission.ts";
import { IPermission } from "@src/models/permission.ts";
import * as userService from "@src/services/user.ts";
import { authorizeDataset, caller } from "@src/services/access.ts";
import { pick } from "@src/utils/pick.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const PERMISSION_FIELDS = ["user_id", "dataset_id", "perm"] as const;
// Only a dataset's OWNER (or an admin) may see or change who it is shared with, so these checks are all OWNER-level.
// Checks that perm is a valid level for the user receiving it; returns the error message, or null if fine:
// EXTERNAL users only ever get VIEW, and admins/lab members already see every dataset so a VIEW row would be redundant
const grantError = async (userId: string, perm: unknown) => {
    if (!Object.values(PermissionOptions).includes(perm as PermissionOptions)) return "A valid perm is required";
    const target = await userService.getById(userId);
    if (!target) return "User not found";
    if (target.role === UserRoles.EXTERNAL && perm !== PermissionOptions.VIEW) return "External users can only be granted VIEW";
    if (target.role !== UserRoles.EXTERNAL && perm === PermissionOptions.VIEW)
        return "Admins and lab members can already view every dataset";
    return null;
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
    if (!(await authorizeDataset(res, req.params.datasetId as string, PermissionOptions.OWNER))) return;
    res.status(200).json(await service.getAll({ dataset_id: req.params.datasetId as string }));
};

/** GET /:userId/:datasetId : returns one permission (200), or 404 if it does not exist; a user may read their own, otherwise it needs OWNER access */
export const get = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to get permission...");
    if (
        req.params.userId !== caller(res)!.id &&
        !(await authorizeDataset(res, req.params.datasetId as string, PermissionOptions.OWNER))
    )
        return;
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
    if (!(await authorizeDataset(res, fields.dataset_id, PermissionOptions.OWNER))) return;
    const problem = await grantError(fields.user_id, fields.perm ?? PermissionOptions.VIEW);
    if (problem) return res.status(400).json({ error: problem });
    res.status(201).json(await service.create(fields));
};

/** PUT /:userId/:datasetId : updates an existing permission (200), or 404 if it does not exist; needs OWNER access and a perm that suits the user's role (400) */
export const update = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to update permission...");
    if (!(await authorizeDataset(res, req.params.datasetId as string, PermissionOptions.OWNER))) return;
    const problem = await grantError(req.params.userId as string, req.body?.perm);
    if (problem) return res.status(400).json({ error: problem });
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

/** DELETE /:userId/:datasetId : deletes a permission (204 with no body), or 404 if it does not exist; needs OWNER access */
export const remove = async (req: Request, res: Response) => {
    console.log("[PERMISSION CONTROLLER] Attempting to delete permission...");
    if (!(await authorizeDataset(res, req.params.datasetId as string, PermissionOptions.OWNER))) return;
    if (!(await service.remove(req.params.userId as string, req.params.datasetId as string))) {
        console.log("[PERMISSION CONTROLLER] Permission not found");
        return res.status(404).json({ error: "Permission not found" });
    }
    res.status(204).send();
};

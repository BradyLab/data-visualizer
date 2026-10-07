// Request handlers for Datasets; thin wrappers that call the dataset service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/dataset.ts";
import { IDataset } from "@src/models/dataset.ts";
import * as userService from "@src/services/user.ts";
import { diff, logActivity, toPlain } from "@src/services/activity.ts";
import { authorizeDataset, caller, getAccess, hasAccess, OWNER } from "@src/services/access.ts";
import { pick } from "@src/utils/pick.ts";
import { ActivityType } from "@commons/activity.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const DATASET_FIELDS = [
    "name",
    "owner",
    "url",
    "description",
    "doi",
    "attribution",
    "treatments",
    "plots",
    "visibility",
] as const;
// Same whitelist minus owner, which is set when the dataset is created and cannot be changed afterwards
const DATASET_UPDATE_FIELDS = DATASET_FIELDS.filter((f) => f !== "owner");
/** GET / : returns the datasets the caller may see (200); guests get only PUBLIC ones */
export const list = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to list datasets...");
    res.status(200).json(await service.getVisibleTo(caller(res)));
};

/** GET /:id : returns one dataset (200), or 404 if it does not exist or the caller cannot see it */
export const get = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset...");
    const found = await authorizeDataset(res, req.params.id as string, PermissionOptions.VIEW);
    if (found) res.status(200).json(found.dataset);
};

/** GET /byURL/:url : returns the dataset with this url slug (200), or 404 if it does not exist or the caller cannot see it */
export const getByUrl = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset by url...");
    const item = await service.getByUrl(req.params.url as string);
    if (!item || !hasAccess(await getAccess(caller(res), item), PermissionOptions.VIEW)) {
        console.log("[DATASET CONTROLLER] Dataset not found or not visible to the caller");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(200).json(item);
};

/**
 * POST / : creates a dataset from the request body (201).
 * The owner is the caller; only an admin may name a different owner, who must be an admin or lab member (else 400)
 */
export const create = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to create dataset...");
    const user = caller(res)!;
    const fields = pick<IDataset>(req.body, DATASET_FIELDS);
    const owner = user.role === UserRoles.ADMIN && fields.owner ? fields.owner : user.id;
    if (owner !== user.id) {
        const target = await userService.getById(owner);
        if (!target || (target.role !== UserRoles.ADMIN && target.role !== UserRoles.LAB_MEMBER))
            return res.status(400).json({ error: "The owner must be an admin or lab member" });
    }
    const created = await service.create({ ...fields, owner });
    await logActivity(res, ActivityType.DATASET_CREATED, toPlain(created));
    res.status(201).json(created);
};

/**
 * PUT /:id : updates an existing dataset (200). Needs EDIT access, and changing visibility needs OWNER.
 * 404 if the dataset does not exist or is not visible to the caller, 403 if they lack the access
 */
export const update = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to update dataset...");
    const found = await authorizeDataset(res, req.params.id as string, PermissionOptions.EDIT);
    if (!found) return;
    const fields = pick<IDataset>(req.body, DATASET_UPDATE_FIELDS);
    if (fields.visibility !== undefined && fields.visibility !== found.dataset.visibility && !hasAccess(found.access, OWNER)) {
        console.log("[DATASET CONTROLLER] Only an owner may change visibility");
        return res.status(403).json({ error: "Forbidden" });
    }
    const updated = await service.update(found.dataset.id, fields);
    const changes = updated && diff(found.dataset, updated, DATASET_UPDATE_FIELDS);
    if (changes) await logActivity(res, ActivityType.DATASET_UPDATED, { dataset_id: found.dataset.id, changes });
    res.status(200).json(updated);
};

/** DELETE /:id : deletes a dataset (204 with no body); needs OWNER access (404 if not found or not visible, 403 if not an owner) */
export const remove = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to delete dataset...");
    const found = await authorizeDataset(res, req.params.id as string, OWNER);
    if (!found) return;
    await service.remove(found.dataset.id);
    await logActivity(res, ActivityType.DATASET_DELETED, toPlain(found.dataset));
    res.status(204).send();
};

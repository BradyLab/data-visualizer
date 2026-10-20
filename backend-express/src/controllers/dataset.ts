// Request handlers for Datasets; thin wrappers that call the dataset service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/dataset.ts";
import { IDataset } from "@src/models/dataset.ts";
import * as userService from "@src/services/user.ts";
import * as fileService from "@src/services/file.ts";
import { removeParquet, removeStored } from "@src/services/storage.ts";
import { diff, logActivity, toPlain } from "@src/services/activity.ts";
import { emitDatasetCreated, emitDatasetDeleted, emitDatasetUpdated } from "@src/services/socket.ts";
import { authorizeDataset, caller, getAccess, hasAccess, OWNER } from "@src/services/access.ts";
import { pick } from "@src/utils/pick.ts";
import { ActivityType } from "@commons/activity.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";
import { SHINY_PREFIX, VIEWER_TICKET_PARAM } from "@src/middleware/shinyProxy.ts";
import { signViewerTicket, viewerEnabled } from "@src/services/viewer.ts";
import * as processing from "@src/services/processing.ts";
import { DatasetStatus } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const DATASET_FIELDS = [
    "name",
    "owner",
    "url",
    "description",
    "doi",
    "attribution",
    "plots",
    "visibility",
] as const;
// Same whitelist minus owner, which is set when the dataset is created and cannot be changed afterwards
const DATASET_UPDATE_FIELDS = DATASET_FIELDS.filter((f) => f !== "owner");

/** GET / : returns the datasets the caller may see (200); guests get only PUBLIC ones */
export const list = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to list datasets...");
    res.status(200).json(await service.withOwnerName(await service.getVisibleTo(caller(res))));
};

/** GET /:id : returns one dataset (200), or 404 if it does not exist or the caller cannot see it */
export const get = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset...");
    const found = await authorizeDataset(res, req.params.id as string, PermissionOptions.VIEW);
    if (found) res.status(200).json((await service.withOwnerName([found.dataset]))[0]);
};

/** GET /byURL/:url : returns the dataset with this url slug (200), or 404 if it does not exist or the caller cannot see it */
export const getByUrl = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset by url...");
    const item = await service.getByUrl(req.params.url as string);
    if (!item || !hasAccess(await getAccess(caller(res), item), PermissionOptions.VIEW)) {
        console.log("[DATASET CONTROLLER] Dataset not found or not visible to the caller");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(200).json((await service.withOwnerName([item]))[0]);
};

/**
 * POST /:id/viewer : returns { url } for the dataset's Shiny viewer (200): a path under /shiny with a one-minute ticket the proxy
 * swaps for a cookie session. Needs VIEW access (404 if the dataset does not exist or is not visible), and 503 if Shiny is not configured
 */
export const viewer = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to issue a viewer ticket...");
    if (!viewerEnabled()) return res.status(503).json({ error: "The viewer is not configured" });
    const found = await authorizeDataset(res, req.params.id as string, PermissionOptions.VIEW);
    if (!found) return;
    // The viewer reads the Parquet files made from the RDS; until they exist (or after a failure) there is nothing to show
    if (found.dataset.status !== DatasetStatus.READY)
        return res.status(409).json({ error: "The plot data for this dataset is not ready", status: found.dataset.status });
    const ticket = signViewerTicket(found.dataset.id, caller(res)?.id ?? null);
    res.status(200).json({
        url: `${SHINY_PREFIX}/${encodeURIComponent(found.dataset.url)}/?${VIEWER_TICKET_PARAM}=${encodeURIComponent(ticket)}`,
    });
};

/** Datasets with a reprocess request in flight, so a concurrent request is rejected before the job is queued */
const reprocessing = new Set<string>();

/**
 * POST /:id/reprocess : rebuilds the plot data from the current RDS file, e.g. to retry after a failure (202 with the dataset, now PROCESSING).
 * Needs EDIT access (404 if not found or not visible, 403 otherwise); 409 if it is already being processed or has no data file yet
 */
export const reprocess = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to reprocess dataset...");
    const found = await authorizeDataset(res, req.params.id as string, PermissionOptions.EDIT);
    if (!found) return;
    const id = found.dataset.id;
    // Claim the dataset synchronously: isBusy() only turns true after start()'s await, so concurrent requests could otherwise both pass it
    if (reprocessing.has(id) || processing.isBusy(id))
        return res.status(409).json({ error: "This dataset is already being processed" });
    reprocessing.add(id);
    try {
        if (!(await fileService.getCurrent(id, FileTypes.RDS)))
            return res.status(409).json({ error: "This dataset has no data file yet" });
        await processing.start(id);
    } finally {
        reprocessing.delete(id);
    }
    const updated = await service.getById(found.dataset.id);
    res.status(202).json(updated && (await service.withOwnerName([updated]))[0]);
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
    const withName = (await service.withOwnerName([created]))[0]!;
    await emitDatasetCreated(withName);
    res.status(201).json(withName);
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
    // Read before the update in case the service changes the same instance
    const visibilityBefore = found.dataset.visibility;
    const updated = await service.update(found.dataset.id, fields);
    const changes = updated && diff(found.dataset, updated, DATASET_UPDATE_FIELDS);
    if (changes) await logActivity(res, ActivityType.DATASET_UPDATED, { dataset_id: found.dataset.id, changes });
    const withName = updated && (await service.withOwnerName([updated]))[0];
    if (withName) await emitDatasetUpdated(withName, visibilityBefore);
    res.status(200).json(withName);
};

/** DELETE /:id : deletes a dataset (204 with no body); needs OWNER access (404 if not found or not visible, 403 if not an owner) */
export const remove = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to delete dataset...");
    const found = await authorizeDataset(res, req.params.id as string, OWNER);
    if (!found) return;
    // The database rows are deleted with the dataset; the stored files must be removed by hand
    const files = await fileService.getAll(found.dataset.id);
    // A running or queued processing job is dropped, and the plot data it made goes with the dataset
    processing.cancel(found.dataset.id);
    await service.remove(found.dataset.id);
    await removeStored(files);
    await removeParquet(found.dataset.id);
    await logActivity(res, ActivityType.DATASET_DELETED, toPlain(found.dataset));
    await emitDatasetDeleted(found.dataset.id);
    res.status(204).send();
};

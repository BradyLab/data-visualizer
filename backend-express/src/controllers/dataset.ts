// Request handlers for Datasets; thin wrappers that call the dataset service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/dataset.ts";
import { IDataset } from "@src/models/dataset.ts";
import { pick } from "@src/utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const DATASET_FIELDS = [
    "name",
    "owner",
    "url",
    "description",
    "doi",
    "rawDataLink",
    "treatments",
    "plots",
    "visibility",
] as const;
// Same whitelist minus owner, which is set when the dataset is created and cannot be changed afterwards
const DATASET_UPDATE_FIELDS = DATASET_FIELDS.filter((f) => f !== "owner");
/** GET / : returns all datasets (200) */
export const list = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to list datasets...");
    res.status(200).json(await service.getAll());
};

/** GET /:id : returns one dataset (200), or 404 if it does not exist */
export const get = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset...");
    const item = await service.getById(req.params.id as string);
    if (!item) {
        console.log("[DATASET CONTROLLER] Dataset not found");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(200).json(item);
};

/** GET /byURL/:url : returns the dataset with this url slug (200), or 404 if it does not exist */
export const getByUrl = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to get dataset by url...");
    const item = await service.getByUrl(req.params.url as string);
    if (!item) {
        console.log("[DATASET CONTROLLER] Dataset not found");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(200).json(item);
};

/** POST / : creates a dataset from the request body (201) */
export const create = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to create dataset...");
    res.status(201).json(await service.create(pick<IDataset>(req.body, DATASET_FIELDS)));
};

/** PUT /:id : updates an existing dataset (200), or 404 if it does not exist */
export const update = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to update dataset...");
    const item = await service.update(req.params.id as string, pick<IDataset>(req.body, DATASET_UPDATE_FIELDS));
    if (!item) {
        console.log("[DATASET CONTROLLER] Dataset not found");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(200).json(item);
};

/** DELETE /:id : deletes a dataset (204 with no body), or 404 if it does not exist */
export const remove = async (req: Request, res: Response) => {
    console.log("[DATASET CONTROLLER] Attempting to delete dataset...");
    if (!(await service.remove(req.params.id as string))) {
        console.log("[DATASET CONTROLLER] Dataset not found");
        return res.status(404).json({ error: "Dataset not found" });
    }
    res.status(204).send();
};

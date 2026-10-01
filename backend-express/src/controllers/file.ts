// Request handlers for Files; thin wrappers that call the file service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "../services/file.ts";

// GET /files?dataset_id=... lists files, optionally for one dataset
export const list = async (req: Request, res: Response) => {
    const datasetId = typeof req.query.dataset_id === "string" ? req.query.dataset_id : undefined;
    res.status(200).json(await service.getAll(datasetId));
};

/** GET /:id : returns one file (200), or 404 if it does not exist */
export const get = async (req: Request, res: Response) => {
    const item = await service.getById(req.params.id as string);
    if (!item) return res.status(404).json({ error: "File not found" });
    res.status(200).json(item);
};

/** POST / : creates a file from the request body (201) */
export const create = async (req: Request, res: Response) => {
    res.status(201).json(await service.create(req.body));
};

/** PUT /:id : updates an existing file (200), or 404 if it does not exist */
export const update = async (req: Request, res: Response) => {
    const item = await service.update(req.params.id as string, req.body);
    if (!item) return res.status(404).json({ error: "File not found" });
    res.status(200).json(item);
};

/** DELETE /:id : deletes a file (204 with no body), or 404 if it does not exist */
export const remove = async (req: Request, res: Response) => {
    if (!(await service.remove(req.params.id as string))) return res.status(404).json({ error: "File not found" });
    res.status(204).send();
};

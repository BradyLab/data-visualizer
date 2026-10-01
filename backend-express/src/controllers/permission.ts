// Request handlers for Permissions; thin wrappers that call the permission service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "../services/permission.ts";

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

// GET /permissions?user_id=...&dataset_id=... lists permissions, optionally filtered
export const list = async (req: Request, res: Response) => {
    const filters: { user_id?: string; dataset_id?: string } = {};
    const userId = str(req.query.user_id);
    const datasetId = str(req.query.dataset_id);
    if (userId) filters.user_id = userId;
    if (datasetId) filters.dataset_id = datasetId;
    res.status(200).json(await service.getAll(filters));
};

export const get = async (req: Request, res: Response) => {
    const item = await service.getById(req.params.userId as string, req.params.datasetId as string);
    if (!item) return res.status(404).json({ error: "Permission not found" });
    res.status(200).json(item);
};

export const create = async (req: Request, res: Response) => {
    res.status(201).json(await service.create(req.body));
};

export const update = async (req: Request, res: Response) => {
    const item = await service.update(req.params.userId as string, req.params.datasetId as string, req.body);
    if (!item) return res.status(404).json({ error: "Permission not found" });
    res.status(200).json(item);
};

export const remove = async (req: Request, res: Response) => {
    if (!(await service.remove(req.params.userId as string, req.params.datasetId as string)))
        return res.status(404).json({ error: "Permission not found" });
    res.status(204).send();
};

// Request handlers for Datasets; thin wrappers that call the dataset service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "../services/dataset.ts";

export const list = async (req: Request, res: Response) => {
    res.status(200).json(await service.getAll());
};

export const get = async (req: Request, res: Response) => {
    const item = await service.getById(req.params.id as string);
    if (!item) return res.status(404).json({ error: "Dataset not found" });
    res.status(200).json(item);
};

export const create = async (req: Request, res: Response) => {
    res.status(201).json(await service.create(req.body));
};

export const update = async (req: Request, res: Response) => {
    const item = await service.update(req.params.id as string, req.body);
    if (!item) return res.status(404).json({ error: "Dataset not found" });
    res.status(200).json(item);
};

export const remove = async (req: Request, res: Response) => {
    if (!(await service.remove(req.params.id as string))) return res.status(404).json({ error: "Dataset not found" });
    res.status(204).send();
};

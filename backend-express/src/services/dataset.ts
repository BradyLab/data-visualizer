// Database access for Datasets
import { Datasets, IDataset } from "../models/dataset.ts";
import { pick } from "../utils/pick.ts";

const DATASET_FIELDS = ["name", "owner", "url", "description", "doi", "rawDataLink", "treatments", "plots"] as const;

export const getAll = () => Datasets.findAll();

export const getById = (id: string) => Datasets.findByPk(id);

export const create = (body: unknown) => Datasets.create(pick<IDataset>(body, DATASET_FIELDS) as IDataset);

export const update = async (id: string, body: unknown) => {
    const dataset = await Datasets.findByPk(id);
    if (!dataset) return null;
    return dataset.update(pick<IDataset>(body, DATASET_FIELDS));
};

// Soft-deletes the dataset (and its permissions); returns false if not found
export const remove = async (id: string) => {
    const dataset = await Datasets.findByPk(id);
    if (!dataset) return false;
    await dataset.destroy();
    return true;
};

// Database access for Datasets
import { Datasets, IDataset } from "../models/dataset.ts";
import { pick } from "../utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const DATASET_FIELDS = ["name", "owner", "url", "description", "doi", "rawDataLink", "treatments", "plots"] as const;

/** Returns all non-deleted datasets */
export const getAll = () => Datasets.findAll();

/** Finds a dataset by primary key, or null */
export const getById = (id: string) => Datasets.findByPk(id);

/** Creates a dataset from the whitelisted body fields */
export const create = (body: unknown) => Datasets.create(pick<IDataset>(body, DATASET_FIELDS) as IDataset);

/** Updates a dataset with the whitelisted body fields; returns null if not found */
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

// Database access for Datasets
import { Datasets, IDataset } from "../models/dataset.ts";
import { pick } from "../utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const DATASET_FIELDS = ["name", "owner", "url", "description", "doi", "rawDataLink", "treatments", "plots"] as const;

/** Returns all non-deleted datasets */
export const getAll = () => {
    console.log("[DATASET SERVICE] Fetching all datasets...");
    return Datasets.findAll();
};

/** Finds a dataset by primary key, or null */
export const getById = (id: string) => {
    console.log("[DATASET SERVICE] Fetching dataset by id...");
    return Datasets.findByPk(id);
};

/** Creates a dataset from the whitelisted body fields */
export const create = (body: unknown) => {
    console.log("[DATASET SERVICE] Creating dataset...");
    return Datasets.create(pick<IDataset>(body, DATASET_FIELDS) as IDataset);
};

/** Updates a dataset with the whitelisted body fields; returns null if not found */
export const update = async (id: string, body: unknown) => {
    console.log("[DATASET SERVICE] Updating dataset...");
    const dataset = await Datasets.findByPk(id);
    if (!dataset) {
        console.log("[DATASET SERVICE] Dataset to update not found");
        return null;
    }
    return dataset.update(pick<IDataset>(body, DATASET_FIELDS));
};

// Soft-deletes the dataset (and its permissions); returns false if not found
export const remove = async (id: string) => {
    console.log("[DATASET SERVICE] Deleting dataset...");
    const dataset = await Datasets.findByPk(id);
    if (!dataset) {
        console.log("[DATASET SERVICE] Dataset to delete not found");
        return false;
    }
    await dataset.destroy();
    return true;
};

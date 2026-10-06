// Database access for Datasets
import { Op } from "sequelize";
import { Datasets, IDataset } from "@src/models/dataset.ts";
import { Permissions } from "@src/models/permission.ts";
import { Users } from "@src/models/user.ts";
import { DatasetVisibility } from "@commons/dataset.ts";
import { UserRoles } from "@commons/user.ts";

/**
 * Returns the datasets a user (null = guest) may see, filtered in the query itself:
 * ADMIN and LAB_MEMBER see everything, anyone else sees PUBLIC datasets plus those they own or hold a permission row on
 */
export const getVisibleTo = async (user: Users | null) => {
    console.log("[DATASET SERVICE] Fetching visible datasets...");
    if (user && (user.role === UserRoles.ADMIN || user.role === UserRoles.LAB_MEMBER)) return Datasets.findAll();
    if (!user) return Datasets.findAll({ where: { visibility: DatasetVisibility.PUBLIC } });
    const shared = (await Permissions.findAll({ where: { user_id: user.id }, attributes: ["dataset_id"] })).map(
        (p) => p.dataset_id
    );
    return Datasets.findAll({
        where: { [Op.or]: [{ visibility: DatasetVisibility.PUBLIC }, { owner: user.id }, { id: shared }] },
    });
};

/** Finds a dataset by primary key, or null */
export const getById = (id: string) => {
    console.log("[DATASET SERVICE] Fetching dataset by id...");
    return Datasets.findByPk(id);
};

/** Finds a dataset by its url slug, or null */
export const getByUrl = (url: string) => {
    console.log("[DATASET SERVICE] Fetching dataset by url...");
    return Datasets.findOne({ where: { url } });
};

/** Creates a dataset from the whitelisted body fields */
export const create = (body: Partial<IDataset>) => {
    console.log("[DATASET SERVICE] Creating dataset...");
    return Datasets.create(body as IDataset);
};

/** Updates a dataset with the whitelisted body fields; returns null if not found */
export const update = async (id: string, body: Partial<IDataset>) => {
    console.log("[DATASET SERVICE] Updating dataset...");
    const dataset = await Datasets.findByPk(id);
    if (!dataset) {
        console.log("[DATASET SERVICE] Dataset to update not found");
        return null;
    }
    return dataset.update(body);
};

// Deletes the dataset (and its permissions and files via cascade); returns false if not found
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

/** Number of datasets owned by a user (the owner column is a foreign key, so such a user cannot be deleted) */
export const countOwnedBy = (owner: string) => {
    console.log("[DATASET SERVICE] Counting datasets owned by user...");
    return Datasets.count({ where: { owner } });
};

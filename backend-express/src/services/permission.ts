// Database access for Permissions (composite key: user_id + dataset_id)
import { Permissions, IPermission } from "@src/models/permission.ts";

// Optional filters so clients can list by user and/or dataset
export const getAll = (filters: { user_id?: string; dataset_id?: string }) => {
    console.log("[PERMISSION SERVICE] Fetching permissions...");
    const where: Partial<IPermission> = {};
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.dataset_id) where.dataset_id = filters.dataset_id;
    return Permissions.findAll({ where });
};

/** Finds a permission by its user_id + dataset_id pair, or null */
export const getById = (user_id: string, dataset_id: string) => {
    console.log("[PERMISSION SERVICE] Fetching permission by user and dataset...");
    return Permissions.findOne({ where: { user_id, dataset_id } });
};

// Creates a permission; fails on the composite primary key if the user already has one for this dataset (deleted rows are gone for good)
export const create = async (data: Partial<IPermission>) => {
    console.log("[PERMISSION SERVICE] Creating permission...");
    return Permissions.create(data as IPermission);
};

// Only the permission level can change; the user/dataset pair is the identity
export const update = async (user_id: string, dataset_id: string, body: Partial<IPermission>) => {
    console.log("[PERMISSION SERVICE] Updating permission...");
    const permission = await getById(user_id, dataset_id);
    if (!permission) {
        console.log("[PERMISSION SERVICE] Permission to update not found");
        return null;
    }
    return permission.update(body);
};

/** Hard-deletes a permission (the row is removed, not flagged); returns false if not found */
export const remove = async (user_id: string, dataset_id: string) => {
    console.log("[PERMISSION SERVICE] Deleting permission...");
    const permission = await getById(user_id, dataset_id);
    if (!permission) {
        console.log("[PERMISSION SERVICE] Permission to delete not found");
        return false;
    }
    await permission.destroy();
    return true;
};

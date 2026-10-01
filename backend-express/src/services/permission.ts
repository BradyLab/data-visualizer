// Database access for Permissions (composite key: user_id + dataset_id)
import { Permissions, IPermission } from "../models/permission.ts";
import { pick } from "../utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const PERMISSION_FIELDS = ["user_id", "dataset_id", "perm"] as const;

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

// Re-activates a previously soft-deleted permission instead of violating the composite primary key
export const create = async (body: unknown) => {
    console.log("[PERMISSION SERVICE] Creating permission...");
    const data = pick<IPermission>(body, PERMISSION_FIELDS);
    const existing = await Permissions.findOne({
        where: { user_id: data.user_id, dataset_id: data.dataset_id } as Partial<IPermission>,
        paranoid: false,
    });
    if (existing?.deletedAt) {
        console.log("[PERMISSION SERVICE] Restoring previously deleted permission");
        await existing.restore();
        return existing.update({ perm: data.perm ?? "VIEW" } as Partial<IPermission>);
    }
    return Permissions.create(data as IPermission);
};

// Only the permission level can change; the user/dataset pair is the identity
export const update = async (user_id: string, dataset_id: string, body: unknown) => {
    console.log("[PERMISSION SERVICE] Updating permission...");
    const permission = await getById(user_id, dataset_id);
    if (!permission) {
        console.log("[PERMISSION SERVICE] Permission to update not found");
        return null;
    }
    return permission.update(pick<IPermission>(body, ["perm"]));
};

/** Soft-deletes a permission; returns false if not found */
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

// Database access for Activities (event log rows; soft-deleted since the Activities table is paranoid)
import { Activities, IActivity } from "@src/models/activity.ts";

// Optional filters to list one user's activity and/or one activity type, newest first
export const getAll = (filters: { user_id?: string | undefined; type?: string | undefined } = {}) => {
    console.log("[ACTIVITY SERVICE] Fetching activities...");
    const where: Record<string, string> = {};
    if (filters.user_id) where.user_id = filters.user_id;
    if (filters.type) where.type = filters.type;
    return Activities.findAll({ where, order: [["createdAt", "DESC"]] });
};

/** Finds an activity record by primary key, or null */
export const getById = (id: string) => {
    console.log("[ACTIVITY SERVICE] Fetching activity by id...");
    return Activities.findByPk(id);
};

/** Creates an activity record from the whitelisted body fields */
export const create = (body: Partial<IActivity>) => {
    console.log("[ACTIVITY SERVICE] Creating activity...");
    return Activities.create(body as IActivity);
};

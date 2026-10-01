// Database access for Activities (event log rows; soft-deleted since the Activities table is paranoid)
import { Activities, IActivity } from "../models/activity.ts";
import { pick } from "../utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const ACTIVITY_FIELDS = ["user_id", "type", "data"] as const;

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
export const create = (body: unknown) => {
    console.log("[ACTIVITY SERVICE] Creating activity...");
    return Activities.create(pick<IActivity>(body, ACTIVITY_FIELDS) as IActivity);
};

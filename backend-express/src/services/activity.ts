// Database access for Activities (event log rows; soft-deleted since the Activities table is paranoid)
import { Response } from "express";
import { Model } from "sequelize";
import { Activities, IActivity } from "@src/models/activity.ts";
import { ActivityType } from "@commons/activity.ts";

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

/** A model instance as a plain object (for logging a whole record); plain objects are copied as they are */
export const toPlain = (record: object): Record<string, unknown> =>
    record instanceof Model ? record.get({ plain: true }) : { ...record };

/**
 * Compares the listed fields of two records and returns { field: { before, after } } for those that differ, or null if none do.
 * Values are compared by their JSON form so arrays (treatments, plots) and dates compare by value, not reference
 */
export const diff = (before: object, after: object, fields: readonly string[]) => {
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of fields) {
        const b = (before as Record<string, unknown>)[field];
        const a = (after as Record<string, unknown>)[field];
        if (JSON.stringify(b) !== JSON.stringify(a)) changes[field] = { before: b, after: a };
    }
    return Object.keys(changes).length ? changes : null;
};

/**
 * Records an activity for the logged-in user (res.locals.user, set by the auth middleware).
 * Call it after the action succeeded. A failure to log is only reported to the console, so it never turns a
 * successful request into an error
 */
export const logActivity = async (res: Response, type: ActivityType, data: Record<string, unknown>) => {
    try {
        await create({ user_id: res.locals.user?.id ?? null, type, data });
    } catch (error) {
        console.error("[ACTIVITY SERVICE] Failed to log activity", type, error);
    }
};

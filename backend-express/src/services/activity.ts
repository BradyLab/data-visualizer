// Database access for Activities (event log rows; soft-deleted since the Activities table is paranoid)
import { Response } from "express";
import { Model, Op, type WhereOptions } from "sequelize";
import { Activities, IActivity } from "@src/models/activity.ts";
import { ActivityType } from "@commons/activity.ts";

// Optional filters to list the activity of any of the given users and/or of any of the given activity types, newest first.
// Returns one page (limit rows after skipping offset) plus the total number of matches, since the log grows without bound
export const getAll = async (
    filters: { user_id?: string[] | undefined; type?: string[] | undefined } = {},
    page: { limit: number; offset: number }
) => {
    console.log("[ACTIVITY SERVICE] Fetching activities...");
    const where: WhereOptions = {};
    if (filters.user_id?.length) where.user_id = { [Op.in]: filters.user_id };
    if (filters.type?.length) where.type = { [Op.in]: filters.type };
    const { rows, count } = await Activities.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: page.limit,
        offset: page.offset,
    });
    return { rows, total: count };
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
export const logActivity = (res: Response, type: ActivityType, data: Record<string, unknown>) =>
    logActivityAs(res.locals.user?.id ?? null, type, data);

/** Like logActivity, for code that runs outside a normal request/response (e.g. when a resumable upload finishes) */
export const logActivityAs = async (user_id: string | null, type: ActivityType, data: Record<string, unknown>) => {
    try {
        await create({ user_id, type, data });
    } catch (error) {
        console.error("[ACTIVITY SERVICE] Failed to log activity", type, error);
    }
};

// Request handlers for Activities; thin wrappers that call the activity service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/activity.ts";
import { ActivityType } from "@commons/activity.ts";

// Page size used when ?limit= is absent, and the most a client may request
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Reads a query param sent as a single comma-separated string into a list of values (undefined if absent or empty)
const strList = (v: unknown) => {
    const list = typeof v === "string" ? v.split(",").filter(Boolean) : [];
    return list.length ? list : undefined;
};

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITY_TYPES: string[] = Object.values(ActivityType);

// Reads ?limit= and ?offset= into a page: limit is clamped to 1..MAX_PAGE_SIZE (default DEFAULT_PAGE_SIZE) and offset is at least 0
const pageOf = (query: Request["query"]) => {
    const limit = Number.parseInt(String(query.limit), 10);
    const offset = Number.parseInt(String(query.offset), 10);
    return {
        limit: Number.isNaN(limit) ? DEFAULT_PAGE_SIZE : Math.min(Math.max(limit, 1), MAX_PAGE_SIZE),
        offset: Number.isNaN(offset) ? 0 : Math.max(offset, 0),
    };
};

/**
 * GET /activities?user_id=a,b&type=x,y&limit=&offset= : lists one page of activities, newest first, optionally filtered
 * by users and/or types (comma-separated); responds 200 with { rows, total }
 */
export const list = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to list activities...");
    const filters = { user_id: strList(req.query.user_id), type: strList(req.query.type) };
    // Checked here for a clear 400; otherwise Postgres rejects the value and the error handler answers with a generic one
    if (filters.user_id?.some((id) => !UUID_FORMAT.test(id)))
        return res.status(400).json({ error: "user_id must be a list of user ids" });
    const badType = filters.type?.find((type) => !ACTIVITY_TYPES.includes(type));
    if (badType) return res.status(400).json({ error: `Unknown activity type: ${badType}` });
    res.status(200).json(await service.getAll(filters, pageOf(req.query)));
};

/** GET /byUser/:userId?limit=&offset= : lists one page of a user's activities, newest first (200 with { rows, total }) */
export const listByUser = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to list activities by user...");
    if (!UUID_FORMAT.test(req.params.userId as string)) return res.status(400).json({ error: "userId must be a user id" });
    res.status(200).json(await service.getAll({ user_id: [req.params.userId as string] }, pageOf(req.query)));
};

/** GET /:id : returns one activity (200), or 404 if it does not exist */
export const get = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to get activity...");
    const item = await service.getById(req.params.id as string);
    if (!item) {
        console.log("[ACTIVITY CONTROLLER] Activity not found");
        return res.status(404).json({ error: "Activity not found" });
    }
    res.status(200).json(item);
};

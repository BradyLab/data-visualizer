// Request handlers for Activities; thin wrappers that call the activity service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/activity.ts";

// Page size used when ?limit= is absent, and the most a client may request
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

// Reads a query param sent as a single comma-separated string into a list of values (undefined if absent or empty)
const strList = (v: unknown) => {
    const list = typeof v === "string" ? v.split(",").filter(Boolean) : [];
    return list.length ? list : undefined;
};

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
    res.status(200).json(await service.getAll(filters, pageOf(req.query)));
};

/** GET /byUser/:userId?limit=&offset= : lists one page of a user's activities, newest first (200 with { rows, total }) */
export const listByUser = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to list activities by user...");
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

// Request handlers for Activities; thin wrappers that call the activity service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/activity.ts";
import { IActivity } from "@src/models/activity.ts";
import { pick } from "@src/utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const ACTIVITY_FIELDS = ["user_id", "type", "data"] as const;
// Reads a query param only if it was sent as a single string
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

// GET /activities?user_id=...&type=... lists activities, optionally filtered by user and/or type
export const list = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to list activities...");
    res.status(200).json(await service.getAll({ user_id: str(req.query.user_id), type: str(req.query.type) }));
};

/** GET /byUser/:userId : lists one user's activities, newest first (200) */
export const listByUser = async (req: Request, res: Response) => {
    console.log("[ACTIVITY CONTROLLER] Attempting to list activities by user...");
    res.status(200).json(await service.getAll({ user_id: req.params.userId as string }));
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

/** POST / : creates an activity from the request body (201) */
// export const create = async (req: Request, res: Response) => {
//     console.log("[ACTIVITY CONTROLLER] Attempting to create activity...");
//     res.status(201).json(await service.create(pick<IActivity>(req.body, ACTIVITY_FIELDS)));
// };

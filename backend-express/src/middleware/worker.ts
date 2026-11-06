// Express middleware for the large-memory worker's routes (/api/worker): a shared secret in "Authorization: Bearer <token>", not a user login.
// The secret opens only these routes; a user's login token does not work on them and this secret does not work anywhere else
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Both sides are hashed first, so the comparison takes the same time whatever their lengths and however much of the token was right
const digest = (value: string) => createHash("sha256").update(value).digest();

/** 503 while REMOTE_WORKER_TOKEN is not set (the feature is off), 401 unless the request carries it */
export const requireWorker = (req: Request, res: Response, next: NextFunction) => {
    const secret = process.env.REMOTE_WORKER_TOKEN;
    if (!secret) return res.status(503).json({ error: "Large-memory processing is not configured" });
    const header = req.headers.authorization;
    const given = header?.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !timingSafeEqual(digest(given), digest(secret))) return res.status(401).json({ error: "Unauthorized" });
    next();
};

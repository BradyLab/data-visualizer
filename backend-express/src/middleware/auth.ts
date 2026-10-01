// Express middleware that requires a valid "Authorization: Bearer <token>" header
import { NextFunction, Request, Response } from "express";
import { verifyToken } from "../services/auth.ts";
import { Users } from "../models/user.ts";

/** Rejects with 401 unless the token is valid and the user still exists; sets res.locals.user */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    console.log("[AUTH MIDDLEWARE] Checking authorization...");
    const header = req.headers.authorization;
    const id = header?.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
    const user = id ? await Users.findByPk(id, { attributes: { exclude: ["password"] } }) : null;
    if (!user) {
        console.log("[AUTH MIDDLEWARE] Unauthorized: missing or invalid token");
        return res.status(401).json({ error: "Unauthorized" });
    }
    console.log("[AUTH MIDDLEWARE] Authorized");
    res.locals.user = user;
    next();
};

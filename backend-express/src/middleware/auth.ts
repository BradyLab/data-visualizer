// Express middleware that requires a valid "Authorization: Bearer <token>" header
import { NextFunction, Request, Response } from "express";
import { verifyToken } from "@src/services/auth.ts";
import { Users } from "@src/models/user.ts";
import { UserStatus } from "@commons/user.ts";

/** Rejects with 401 unless the token is valid and the user still exists; sets res.locals.user */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    console.log("[AUTH MIDDLEWARE] Checking authorization...");
    // Steps: extract the Bearer token -> verify signature/expiry to get the user id -> reload the user from the DB,
    // so deleted users are rejected even if their token has not expired
    const header = req.headers.authorization;
    const id = header?.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
    const user = id ? await Users.findByPk(id, { attributes: { exclude: ["password"] } }) : null;
    if (!user) {
        console.log("[AUTH MIDDLEWARE] Unauthorized: missing or invalid token");
        return res.status(401).json({ error: "Unauthorized" });
    }
    if (user && user.status == UserStatus.INACTIVE) {
        console.log("[AUTH MIDDLEWARE] Unauthorized: user is inactive");
        return res.status(401).json({ error: "Unauthorized" });
    }
    console.log("[AUTH MIDDLEWARE] Authorized");
    res.locals.user = user;
    next();
};

// Express middleware that requires a valid "Authorization: Bearer <token>" header
import { NextFunction, Request, Response } from "express";
import { verifyToken } from "@src/services/auth.ts";
import { Users } from "@src/models/user.ts";
import { UserStatus } from "@commons/user.ts";
import { PASSWORD_CHANGE_REQUIRED } from "@commons/general.ts";

// Builds the middleware; allowInvited lets INVITED users (still on the default password) through
const authenticate = (allowInvited: boolean) => async (req: Request, res: Response, next: NextFunction) => {
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
    if (user.status == UserStatus.INACTIVE) {
        console.log("[AUTH MIDDLEWARE] Unauthorized: user is inactive");
        return res.status(401).json({ error: "Unauthorized" });
    }
    // INVITED users are still on the default password; they get 403 (not 401, since the token is fine and the
    // client should not log them out) until they change it, except on routes that opt in via allowInvited
    if (user.status == UserStatus.INVITED && !allowInvited) {
        console.log("[AUTH MIDDLEWARE] Forbidden: invited user must change the default password first");
        return res.status(403).json({ error: "Password change required", code: PASSWORD_CHANGE_REQUIRED });
    }
    console.log("[AUTH MIDDLEWARE] Authorized");
    res.locals.user = user;
    next();
};

/** Rejects with 401 unless the token is valid and the user still exists, and with 403 while the user is INVITED; sets res.locals.user */
export const requireAuth = authenticate(false);

/** Like requireAuth but lets INVITED users through; for the routes they need to finish setup (/me, /change-password, /logout) */
export const requireAuthAllowInvited = authenticate(true);

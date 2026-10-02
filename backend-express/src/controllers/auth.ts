// Request handlers for authentication
import { Request, Response } from "express";
import * as service from "@src/services/auth.ts";

/** POST /login : returns { token, user } (200), 400 if email/password are missing, or 401 for bad credentials */
export const login = async (req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Attempting to log in...");
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
        console.log("[AUTH CONTROLLER] Login rejected: email and password are required");
        return res.status(400).json({ error: "Email and password are required" });
    }
    const result = await service.login(email, password);
    if (!result) {
        console.log("[AUTH CONTROLLER] Login failed: invalid credentials");
        return res.status(401).json({ error: "Invalid email or password" });
    }
    console.log("[AUTH CONTROLLER] Login successful");
    res.status(200).json(result);
};

/** POST /logout : returns 204; tokens are stateless JWTs, so the client discards its token (set by requireAuth) */
export const logout = (_req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Logging out user", res.locals.user?.id);
    res.status(204).send();
};

/** POST /change-password : changes the logged-in user's password (204), 400 if a field is missing, or 403 if the old password is wrong */
export const changePassword = async (req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Attempting to change password...");
    const { oldPassword, newPassword } = req.body ?? {};
    if (typeof oldPassword !== "string" || typeof newPassword !== "string" || !newPassword) {
        return res.status(400).json({ error: "Old and new passwords are required" });
    }
    if (!(await service.changePassword(res.locals.user.id, oldPassword, newPassword))) {
        return res.status(403).json({ error: "Old password is incorrect" });
    }
    res.status(204).send();
};

/** GET /me : returns the logged-in user (set by requireAuth) */
export const me = (req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Fetching the logged-in user...");
    res.status(200).json(res.locals.user);
};

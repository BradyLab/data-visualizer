// Request handlers for authentication
import { Request, Response } from "express";
import * as service from "@src/services/auth.ts";
import { logActivity } from "@src/services/activity.ts";
import { ActivityType } from "@commons/activity.ts";
import { MIN_PASSWORD_LENGTH } from "@commons/general.ts";
import { UserStatus } from "@commons/user.ts";

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

/** POST /logout : returns 204; tokens are stateless JWTs, so the client discards its token (user set by requireAuthAllowInvited) */
export const logout = (_req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Logging out user", res.locals.user?.id);
    res.status(204).send();
};

/** POST /change-password : changes the logged-in user's password (200, returns a new { token }; all older tokens stop working), 400 if a field is missing, the new password is shorter than MIN_PASSWORD_LENGTH, or it equals the old or default password, or 403 if the old password is wrong */
export const changePassword = async (req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Attempting to change password...");
    const { oldPassword, newPassword } = req.body ?? {};
    if (typeof oldPassword !== "string" || typeof newPassword !== "string" || !newPassword) {
        return res.status(400).json({ error: "Old and new passwords are required" });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (newPassword === oldPassword) {
        return res.status(400).json({ error: "New password must be different from the old password" });
    }
    // Invited users start on the default password, so it must not be reusable as a "new" one
    if (process.env.DEFAULT_PASSWORD && newPassword === process.env.DEFAULT_PASSWORD) {
        return res.status(400).json({ error: "New password must not be the default password" });
    }
    // An invited user becomes active by changing the default password; that is when they have joined
    const wasInvited = res.locals.user.status === UserStatus.INVITED;
    const token = await service.changePassword(res.locals.user.id, oldPassword, newPassword);
    if (!token) {
        return res.status(403).json({ error: "Old password is incorrect" });
    }
    if (wasInvited)
        await logActivity(res, ActivityType.USER_JOINED, {
            changes: { status: { before: UserStatus.INVITED, after: UserStatus.ACTIVE } },
        });
    // Tokens issued before the change no longer work, so hand back a fresh one for the caller's own session
    res.status(200).json({ token });
};

/** GET /me : returns the logged-in user (set by requireAuthAllowInvited) */
export const me = (req: Request, res: Response) => {
    console.log("[AUTH CONTROLLER] Fetching the logged-in user...");
    res.status(200).json(res.locals.user);
};

// Request handlers for Users; thin wrappers that call the user service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/user.ts";
import { IUserPass } from "@src/models/user.ts";
import { pick } from "@src/utils/pick.ts";
import { UserRoles } from "@commons/user.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const USER_FIELDS = ["email", "password", "name", "role", "status"] as const;

// Columns clients may change on an existing user; the password is deliberately absent so it can only be
// changed through POST /auth/change-password (which checks the old password)
const UPDATE_FIELDS = ["email", "name", "role", "status"] as const;

/** GET / : returns all users (200) */
export const list = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to list users...");
    res.status(200).json(await service.getAll());
};

/** GET /:id : returns one user (200), or 404 if it does not exist */
export const get = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to get user...");
    const item = await service.getById(req.params.id as string);
    if (!item) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json(item);
};

/** POST /invite : invites a user from {name, email, role} with INVITED status and the default password (201), or 400 if a field is missing or invalid */
export const create = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to invite user...");
    const { name, email, role } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !email.trim())
        return res.status(400).json({ error: "Name and email are required" });
    if (!Object.values(UserRoles).includes(role) || role === UserRoles.GUEST)
        return res.status(400).json({ error: "A valid role is required" });
    res.status(201).json(await service.create(pick<IUserPass>({ name: name.trim(), email: email.trim(), role }, ["email", "name", "role"] as const)));
};

/** PUT /:id : updates an existing user (200), or 404 if it does not exist */
export const update = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to update user...");
    const item = await service.update(req.params.id as string, pick<IUserPass>(req.body, UPDATE_FIELDS));
    if (!item) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json(item);
};

/** DELETE /:id : deletes a user (204 with no body), or 404 if it does not exist */
export const remove = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to delete user...");
    if (!(await service.remove(req.params.id as string))) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    res.status(204).send();
};

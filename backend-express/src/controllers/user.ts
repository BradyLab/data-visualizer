// Request handlers for Users; thin wrappers that call the user service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/user.ts";
import * as datasetService from "@src/services/dataset.ts";
import { diff, logActivity, toPlain } from "@src/services/activity.ts";
import { IUserPass } from "@src/models/user.ts";
import { pick } from "@src/utils/pick.ts";
import { ActivityType } from "@commons/activity.ts";
import { ASSIGNABLE_ROLES, UserRoles, UserStatus } from "@commons/user.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const USER_FIELDS = ["email", "password", "name", "role", "status"] as const;

// Columns clients may change on an existing user; the password is deliberately absent so it can only be
// changed through POST /auth/change-password (which checks the old password)
const UPDATE_FIELDS = ["email", "name", "role", "status"] as const;

// Same pattern as the invite dialog's frontend check: something@something.something with no whitespace
const EMAIL_FORMAT = /^\S+@\S+\.\S+$/;

// Returns the trimmed, lowercased email, or null if the value is not a string or is blank; used for the email in both create and update.
// Stored in one canonical form because login and the rate limiter treat different casings as the same account
const cleanEmail = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null);

/** GET / : returns all users (200) */
export const list = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to list users...");
    res.status(200).json(await service.getAll());
};

/** GET /names : returns just the id, name, role and status of every user (200); the router limits it to admins and lab members */
export const listNames = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to list user names...");
    res.status(200).json(await service.getNames());
};

/** GET /:id : returns one user (200), or 404 if it does not exist; the router limits it to that user or an admin */
export const get = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to get user...");
    const item = await service.getById(req.params.id as string);
    if (!item) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json(item);
};

/** POST / : invites a user from {name, email, role} with INVITED status and the default password (201), or 400 if a field is missing or invalid */
export const create = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to invite user...");
    const { name, role } = req.body ?? {};
    const email = cleanEmail(req.body?.email);
    if (typeof name !== "string" || !name.trim() || !email) return res.status(400).json({ error: "Name and email are required" });
    if (!EMAIL_FORMAT.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "A valid role is required" });
    const created = await service.create(pick<IUserPass>({ name: name.trim(), email, role }, ["email", "name", "role"] as const));
    await logActivity(res, ActivityType.INVITE_USER, toPlain(created));
    res.status(201).json(created);
};

/**
 * PUT /:id : updates an existing user (200), or 404 if it does not exist, 400 for a bad name, email (blank or badly formatted), role or status.
 * Admins may change any field; a user editing themselves may only change their name (403 if the body would change
 * their email, role or status). 409 if it would remove the last active admin
 */
export const update = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to update user...");
    const id = req.params.id as string;
    const fields = pick<IUserPass>(req.body, UPDATE_FIELDS);
    if (fields.name !== undefined) {
        if (typeof fields.name !== "string" || !fields.name.trim())
            return res.status(400).json({ error: "Name cannot be empty" });
        fields.name = fields.name.trim();
    }
    if (fields.email !== undefined) {
        const email = cleanEmail(fields.email);
        if (!email) return res.status(400).json({ error: "Email cannot be empty" });
        if (!EMAIL_FORMAT.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
        fields.email = email;
    }
    if (fields.role !== undefined && !ASSIGNABLE_ROLES.includes(fields.role))
        return res.status(400).json({ error: "A valid role is required" });
    const target = await service.getById(id);
    if (!target) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    // Status must be a real UserStatus; INVITED is only accepted as a no-op, since a user cannot be set back to INVITED
    // (it means "still on the default password") and the edit dialog resends the current status of an invited user
    if (
        fields.status !== undefined &&
        (!Object.values(UserStatus).includes(fields.status) ||
            (fields.status === UserStatus.INVITED && target.status !== UserStatus.INVITED))
    )
        return res.status(400).json({ error: "A valid status is required" });
    // The router lets non-admins through only for their own record; they may not change anything but the name
    // fields.email was cleaned (trimmed, lowercased) above, so the stored email is cleaned the same way to compare like with like
    if (res.locals.user.role !== UserRoles.ADMIN) {
        const { name: _name, ...restricted } = fields;
        const current = { ...target.get({ plain: true }), email: cleanEmail(target.email) };
        if (Object.entries(restricted).some(([key, value]) => current[key as keyof typeof current] !== value))
            return res.status(403).json({ error: "Forbidden" });
    }
    const losesAdmin =
        target.role === UserRoles.ADMIN &&
        target.status === UserStatus.ACTIVE &&
        ((fields.role !== undefined && fields.role !== UserRoles.ADMIN) || fields.status === UserStatus.INACTIVE);
    if (losesAdmin && !(await service.hasOtherActiveAdmin(id)))
        return res.status(409).json({ error: "There must be at least one active admin" });
    const updated = await service.update(id, fields);
    // One entry per request: a status change takes the more specific type, other changed fields ride along in the same entry
    const changes = updated && diff(target, updated, UPDATE_FIELDS);
    if (changes) {
        const status = changes.status;
        const type =
            status?.after === UserStatus.INACTIVE
                ? ActivityType.USER_DEACTIVATED
                : status?.before === UserStatus.INACTIVE && status.after === UserStatus.ACTIVE
                  ? ActivityType.USER_REACTIVATED
                  : ActivityType.USER_UPDATED;
        await logActivity(res, type, { user_id: id, changes });
    }
    res.status(200).json(updated);
};

/** DELETE /:id : deletes a user (204 with no body), or 404 if it does not exist, 409 if it is the last active admin or still owns datasets */
export const remove = async (req: Request, res: Response) => {
    console.log("[USER CONTROLLER] Attempting to delete user...");
    const id = req.params.id as string;
    const target = await service.getById(id);
    if (!target) {
        console.log("[USER CONTROLLER] User not found");
        return res.status(404).json({ error: "User not found" });
    }
    // Only an active admin counts toward the "at least one active admin" rule, so removing an inactive one is always safe
    if (target.role === UserRoles.ADMIN && target.status === UserStatus.ACTIVE && !(await service.hasOtherActiveAdmin(id)))
        return res.status(409).json({ error: "There must be at least one active admin" });
    if (await datasetService.countOwnedBy(id))
        return res.status(409).json({ error: "This user owns datasets; reassign them first or deactivate the user instead" });
    const deleted = toPlain(target);
    await service.remove(id);
    await logActivity(res, ActivityType.USER_DELETED, deleted);
    res.status(204).send();
};

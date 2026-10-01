// Database access for Users; the password hash is never returned to callers
import { randomBytes, scryptSync } from "node:crypto";
import { Users, IUserPass } from "../models/user.ts";
import { pick } from "../utils/pick.ts";

// Whitelist of columns clients may set (see utils/pick.ts)
const USER_FIELDS = ["email", "password", "name", "role", "status"] as const;
// Query option that keeps the password hash out of query results
const PUBLIC_ATTRIBUTES = { exclude: ["password"] };

// Hashes a password as "salt:hash" (hex) using scrypt
const hashPassword = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

// Hashes the password field (if present) before it is stored
const prepare = (body: unknown) => {
    const data = pick<IUserPass>(body, USER_FIELDS);
    if (data.password) data.password = hashPassword(data.password);
    return data;
};

// Removes the password from a model instance before returning it
const toPublic = (user: Users) => {
    const { password, ...rest } = user.get({ plain: true });
    return rest;
};

/** Returns all non-deleted users without passwords */
export const getAll = () => {
    console.log("[USER SERVICE] Fetching all users...");
    return Users.findAll({ attributes: PUBLIC_ATTRIBUTES });
};

/** Finds a user by primary key without the password, or null */
export const getById = (id: string) => {
    console.log("[USER SERVICE] Fetching user by id...");
    return Users.findByPk(id, { attributes: PUBLIC_ATTRIBUTES });
};

/** Creates a user (password is hashed first) and returns it without the password */
export const create = async (body: unknown) => {
    console.log("[USER SERVICE] Creating user...");
    return toPublic(await Users.create(prepare(body) as IUserPass));
};

/** Updates a user (password is re-hashed if provided); returns null if not found */
export const update = async (id: string, body: unknown) => {
    console.log("[USER SERVICE] Updating user...");
    const user = await Users.findByPk(id);
    if (!user) {
        console.log("[USER SERVICE] User to update not found");
        return null;
    }
    await user.update(prepare(body));
    return toPublic(user);
};

// Soft-deletes the user (and their permissions); returns false if not found
export const remove = async (id: string) => {
    console.log("[USER SERVICE] Deleting user...");
    const user = await Users.findByPk(id);
    if (!user) {
        console.log("[USER SERVICE] User to delete not found");
        return false;
    }
    await user.destroy();
    return true;
};

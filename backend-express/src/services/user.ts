// Database access for Users; the password hash is never returned to callers
import { randomBytes, scryptSync } from "node:crypto";
import { Users, IUserPass } from "../models/user.ts";
import { pick } from "../utils/pick.ts";

const USER_FIELDS = ["email", "password", "name", "role", "status"] as const;
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

export const getAll = () => Users.findAll({ attributes: PUBLIC_ATTRIBUTES });

export const getById = (id: string) => Users.findByPk(id, { attributes: PUBLIC_ATTRIBUTES });

export const create = async (body: unknown) => toPublic(await Users.create(prepare(body) as IUserPass));

export const update = async (id: string, body: unknown) => {
    const user = await Users.findByPk(id);
    if (!user) return null;
    await user.update(prepare(body));
    return toPublic(user);
};

// Soft-deletes the user (and their permissions); returns false if not found
export const remove = async (id: string) => {
    const user = await Users.findByPk(id);
    if (!user) return false;
    await user.destroy();
    return true;
};

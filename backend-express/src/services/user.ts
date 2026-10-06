// Database access for Users; the password hash is never returned to callers
import { Users, IUserPass } from "@src/models/user.ts";
import { hashPassword } from "@src/utils/password.ts";
import { UserStatus } from "@commons/user.ts";

// Query option that keeps the password hash out of query results
const PUBLIC_ATTRIBUTES = { exclude: ["password"] };

// Removes the password from a model instance before returning it
const toPublic = (user: Users) => {
    const { password: _password, ...rest } = user.get({ plain: true });
    return rest;
};

/** Returns all users without passwords */
export const getAll = () => {
    console.log("[USER SERVICE] Fetching all users...");
    return Users.findAll({ attributes: PUBLIC_ATTRIBUTES });
};

/** Finds a user by primary key without the password, or null */
export const getById = (id: string) => {
    console.log("[USER SERVICE] Fetching user by id...");
    return Users.findByPk(id, { attributes: PUBLIC_ATTRIBUTES });
};

/**
 * Invites a user: creates them with INVITED status and the default password from the DEFAULT_PASSWORD env var.
 * Returns the user without the password. Throws if DEFAULT_PASSWORD is not configured.
 */
export const create = async (data: Partial<IUserPass>) => {
    console.log("[USER SERVICE] Inviting user...");
    const defaultPassword = process.env.DEFAULT_PASSWORD;
    if (!defaultPassword) throw new Error("DEFAULT_PASSWORD is not set");
    return toPublic(
        await Users.create({ ...data, status: UserStatus.INVITED, password: hashPassword(defaultPassword) } as IUserPass)
    );
};

/** Updates a user's email, name, role or status (any password in the body is ignored); returns null if not found */
export const update = async (id: string, body: Partial<IUserPass>) => {
    console.log("[USER SERVICE] Updating user...");
    const user = await Users.findByPk(id);
    if (!user) {
        console.log("[USER SERVICE] User to update not found");
        return null;
    }
    await user.update(body);
    return toPublic(user);
};

// Hard-deletes the user; their permissions and uploaded files are removed by the foreign-key cascades. Returns false if not found
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

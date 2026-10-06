// Database access for Users; the password hash is never returned to callers
import { Op } from "sequelize";
import { Users, IUserPass } from "@src/models/user.ts";
import { Permissions } from "@src/models/permission.ts";
import { hashPassword } from "@src/utils/password.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";

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

/** Returns only the id and name of every user */
export const getNames = () => {
    console.log("[USER SERVICE] Fetching user names...");
    return Users.findAll({ attributes: ["id", "name"] });
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

/** True if some other ACTIVE admin exists, i.e. this user can lose admin access without locking everyone out */
export const hasOtherActiveAdmin = async (id: string) =>
    (await Users.count({ where: { role: UserRoles.ADMIN, status: UserStatus.ACTIVE, id: { [Op.ne]: id } } })) > 0;

/**
 * Updates a user's email, name, role or status (any password in the body is ignored); returns null if not found.
 * Becoming EXTERNAL downgrades the user's EDIT permissions to DOWNLOAD, since external users cannot edit
 */
export const update = async (id: string, body: Partial<IUserPass>) => {
    console.log("[USER SERVICE] Updating user...");
    const user = await Users.findByPk(id);
    if (!user) {
        console.log("[USER SERVICE] User to update not found");
        return null;
    }
    const wasExternal = user.role === UserRoles.EXTERNAL;
    // Drop any password so it can't be saved unhashed (passwords change only through the auth service)
    const { password: _password, ...fields } = body;
    await user.update(fields);
    if (!wasExternal && user.role === UserRoles.EXTERNAL)
        await Permissions.update({ perm: PermissionOptions.DOWNLOAD }, { where: { user_id: id, perm: PermissionOptions.EDIT } });
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

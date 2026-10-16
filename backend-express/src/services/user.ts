// Database access for Users; the password hash is never returned to callers
import { Op, Transaction } from "sequelize";
import { Users, IUserPass } from "@src/models/user.ts";
import { Permissions } from "@src/models/permission.ts";
import { sequelize } from "@src/database.ts";
import { generatePassword, hashPassword } from "@src/utils/password.ts";
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

/** Returns only the id, name, role and status of every user */
export const getNames = () => {
    console.log("[USER SERVICE] Fetching user names...");
    return Users.findAll({ attributes: ["id", "name", "role", "status"] });
};

/** Finds a user by primary key without the password, or null */
export const getById = (id: string) => {
    console.log("[USER SERVICE] Fetching user by id...");
    return Users.findByPk(id, { attributes: PUBLIC_ATTRIBUTES });
};

/**
 * Invites a user: creates them with INVITED status and a random temporary password, which is stored only as a hash.
 * Returns the user without the password, and the temporary password in plain text; this is the only time it exists unhashed
 */
export const create = async (data: Partial<IUserPass>) => {
    console.log("[USER SERVICE] Inviting user...");
    const temporaryPassword = generatePassword();
    const user = toPublic(
        await Users.create({ ...data, status: UserStatus.INVITED, password: await hashPassword(temporaryPassword) } as IUserPass)
    );
    return { user, temporaryPassword };
};

/** Thrown by update and remove when the change would leave no ACTIVE admin */
export class LastAdminError extends Error {
    constructor() {
        super("There must be at least one active admin");
    }
}

// Arbitrary key of the Postgres advisory lock that serializes every change that can remove an active admin
const ADMIN_LOCK_KEY = 5_130_001;

// Takes the lock until the transaction ends. Without it, two admins demoting or deleting each other at the same time would each see
// the other as "another active admin" and both go through, leaving none (READ COMMITTED does not stop that, and there is no row to lock)
const lockAdmins = (transaction: Transaction) =>
    sequelize.query("SELECT pg_advisory_xact_lock(:key)", { replacements: { key: ADMIN_LOCK_KEY }, transaction });

// True if some other ACTIVE admin exists, i.e. this user can lose admin access without locking everyone out
const hasOtherActiveAdmin = async (id: string, transaction: Transaction) =>
    (await Users.count({ where: { role: UserRoles.ADMIN, status: UserStatus.ACTIVE, id: { [Op.ne]: id } }, transaction })) > 0;

/**
 * Updates a user's email, name, role or status (any password in the body is ignored); returns null if not found.
 * Becoming EXTERNAL downgrades the user's EDIT permissions to DOWNLOAD, since external users cannot edit.
 * Throws LastAdminError if the change would demote or deactivate the last active admin
 */
export const update = async (id: string, body: Partial<IUserPass>) => {
    console.log("[USER SERVICE] Updating user...");
    // Drop any password so it can't be saved unhashed (passwords change only through the auth service)
    const { password: _password, ...fields } = body;
    // One transaction so a failure in the permission downgrade also rolls back the user update,
    // instead of leaving an EXTERNAL user who still holds EDIT permissions
    return sequelize.transaction(async (transaction) => {
        await lockAdmins(transaction);
        // Read under the lock, so the admin check below sees the current role and status
        const user = await Users.findByPk(id, { transaction });
        if (!user) {
            console.log("[USER SERVICE] User to update not found");
            return null;
        }
        const wasExternal = user.role === UserRoles.EXTERNAL;
        const losesAdmin =
            user.role === UserRoles.ADMIN &&
            user.status === UserStatus.ACTIVE &&
            ((fields.role !== undefined && fields.role !== UserRoles.ADMIN) || fields.status === UserStatus.INACTIVE);
        if (losesAdmin && !(await hasOtherActiveAdmin(id, transaction))) throw new LastAdminError();
        await user.update(fields, { transaction });
        if (!wasExternal && user.role === UserRoles.EXTERNAL)
            await Permissions.update(
                { perm: PermissionOptions.DOWNLOAD },
                { where: { user_id: id, perm: PermissionOptions.EDIT }, transaction }
            );
        return toPublic(user);
    });
};

// Hard-deletes the user; their permissions and uploaded files are removed by the foreign-key cascades. Returns false if not found.
// Throws LastAdminError if the user is the last active admin (only an active admin counts, so removing an inactive one is always safe)
export const remove = async (id: string) => {
    console.log("[USER SERVICE] Deleting user...");
    return sequelize.transaction(async (transaction) => {
        await lockAdmins(transaction);
        const user = await Users.findByPk(id, { transaction });
        if (!user) {
            console.log("[USER SERVICE] User to delete not found");
            return false;
        }
        if (user.role === UserRoles.ADMIN && user.status === UserStatus.ACTIVE && !(await hasOtherActiveAdmin(id, transaction)))
            throw new LastAdminError();
        await user.destroy({ transaction });
        return true;
    });
};

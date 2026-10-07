// Shared permission types used by both the frontend and backend
import { UserRoles } from "./user.ts";

// Access levels that can be granted to a user on a dataset, from least to most; each level includes the ones before it:
// VIEW reads the dataset, DOWNLOAD also downloads its RDS file, EDIT also changes the dataset and its files.
// There is no OWNER level here: ownership is the dataset's owner column (see Datasets), so a dataset has exactly one
// owner, who also changes its visibility, deletes it and manages who it is shared with
export enum PermissionOptions {
    VIEW = "VIEW",
    DOWNLOAD = "DOWNLOAD",
    EDIT = "EDIT",
}

// A permission record: grants one user an access level on one dataset
// No separate id: (user_id, dataset_id) is the composite primary key
export interface IPermission {
    user_id: string;
    dataset_id: string;
    perm: PermissionOptions;
    createdAt: Date;
    updatedAt: Date | null;
}

// Access levels that may be granted to a user with this role. EXTERNAL users only ever get VIEW or DOWNLOAD; lab members
// already view and download every dataset, so only EDIT rows mean anything for them; admins already have full access to
// everything, so they can't be granted anything.
// The backend enforces this when granting, and the frontend uses it to offer only valid choices
export const grantablePermissions = (role: UserRoles): PermissionOptions[] => {
    if (role === UserRoles.ADMIN) return [];
    return role === UserRoles.EXTERNAL ? [PermissionOptions.VIEW, PermissionOptions.DOWNLOAD] : [PermissionOptions.EDIT];
};

// Returns the error message if perm can't be granted to a user with this role, or null if it can
export const grantError = (role: UserRoles, perm: unknown): string | null => {
    if (!Object.values(PermissionOptions).includes(perm as PermissionOptions)) return "A valid perm is required";
    if (role === UserRoles.ADMIN) return "Admins already have full access to every dataset";
    if (grantablePermissions(role).includes(perm as PermissionOptions)) return null;
    return role === UserRoles.EXTERNAL
        ? "External users can only be granted VIEW or DOWNLOAD"
        : "Lab members can already view and download every dataset";
};

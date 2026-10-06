// Dataset access rules: combines the caller's role (UserRoles) with their per-dataset permission (PermissionOptions)
import { Request, Response } from "express";
import { Datasets } from "@src/models/dataset.ts";
import { Permissions } from "@src/models/permission.ts";
import { Users } from "@src/models/user.ts";
import { DatasetVisibility } from "@commons/dataset.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles } from "@commons/user.ts";

/**
 * OWNER is the top access level, held by a dataset's owner (its owner column) and by admins. Unlike the other levels
 * it is never stored as a permission row, so it is not part of PermissionOptions
 */
export const OWNER = "OWNER" as const;

// What a user can hold on a dataset: a granted permission level, or OWNER
export type AccessLevel = PermissionOptions | typeof OWNER;

// null means no access at all
export type Access = AccessLevel | null;

const RANK: Record<AccessLevel, number> = {
    [PermissionOptions.VIEW]: 1,
    [PermissionOptions.DOWNLOAD]: 2,
    [PermissionOptions.EDIT]: 3,
    [OWNER]: 4,
};

const higher = (a: Access, b: Access): Access => (a && b ? (RANK[a] >= RANK[b] ? a : b) : (a ?? b));

// The lower of two levels
const atMost = (level: PermissionOptions, max: PermissionOptions) => (RANK[level] <= RANK[max] ? level : max);

/** True if the level is at least `min` */
export const hasAccess = (level: Access, min: AccessLevel) => level !== null && RANK[level] >= RANK[min];

/** The logged-in user set by requireAuth/optionalAuth, or null for a guest */
export const caller = (res: Response): Users | null => res.locals.user ?? null;

/**
 * The access level a user (null = guest) has on a dataset:
 * - ADMIN: OWNER on everything
 * - the dataset's owner (its owner column): OWNER whatever their role, so former lab members keep control of their datasets
 * - LAB_MEMBER: at least DOWNLOAD on everything, including PRIVATE; more only through a permission row
 * - EXTERNAL: the level of their permission row, capped at DOWNLOAD
 * - anyone, guests included: VIEW on PUBLIC datasets
 */
export const getAccess = async (user: Users | null, dataset: Datasets): Promise<Access> => {
    let level: Access = dataset.visibility === DatasetVisibility.PUBLIC ? PermissionOptions.VIEW : null;
    if (!user) return level;
    if (user.role === UserRoles.ADMIN) return OWNER;
    if (dataset.owner === user.id) return OWNER;
    const row = await Permissions.findOne({ where: { user_id: user.id, dataset_id: dataset.id } });
    if (row) level = higher(level, user.role === UserRoles.EXTERNAL ? atMost(row.perm, PermissionOptions.DOWNLOAD) : row.perm);
    if (user.role === UserRoles.LAB_MEMBER) level = higher(level, PermissionOptions.DOWNLOAD);
    return level;
};

/**
 * Loads a dataset and checks that the caller has at least `min` access to it. On failure it sends the response and
 * returns null: 404 if the dataset does not exist or the caller cannot even view it (so private datasets are not
 * revealed), 403 if they can view it but not at the `min` level.
 */
export const authorizeDataset = async (res: Response, datasetId: string, min: AccessLevel, notFound = "Dataset not found") => {
    const dataset = await Datasets.findByPk(datasetId);
    const access = dataset ? await getAccess(caller(res), dataset) : null;
    if (!dataset || !access) {
        console.log("[ACCESS] Dataset not found or not visible to the caller");
        res.status(404).json({ error: notFound });
        return null;
    }
    if (!hasAccess(access, min)) {
        console.log("[ACCESS] Caller lacks the required dataset access");
        res.status(403).json({ error: "Forbidden" });
        return null;
    }
    return { dataset, access };
};

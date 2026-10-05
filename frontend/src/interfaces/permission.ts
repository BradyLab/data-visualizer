import { type IPermission } from "@commons/permissions";

/** Payload for granting a permission */
export type CreatePermissionPayload = Pick<IPermission, "user_id" | "dataset_id" | "perm">;

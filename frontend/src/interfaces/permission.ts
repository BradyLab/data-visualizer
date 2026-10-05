import { type IPermission } from "@commons/permissions";

/** Payload for granting a permission */
// Create needs all three; timestamps are server-generated
export type CreatePermissionPayload = Pick<IPermission, "user_id" | "dataset_id" | "perm">;

import { type IUser } from "@commons/user";
import { type ServerFields } from "@src/interfaces/general";

/** Payload for creating a user */
export type CreateUserPayload = Omit<IUser, ServerFields>;

/** Payload for updating a user; any subset of the editable fields */
export type UpdateUserPayload = Partial<CreateUserPayload>;

/** Payload for inviting a user */
export type InviteUserPayload = Pick<IUser, "name" | "email" | "role">;
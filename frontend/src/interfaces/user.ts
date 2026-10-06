import { type IUser } from "@commons/user";
import { type ServerFields } from "@src/interfaces/general";

/** Payload for updating a user; any subset of the editable fields */
export type UpdateUserPayload = Partial<Omit<IUser, ServerFields>>;

/** Payload for inviting a user */
// Status is not sent; the backend assigns it (new users start as INVITED)
export type InviteUserPayload = Pick<IUser, "name" | "email" | "role">;

/** A user reduced to what name lookups need (the shape of GET /users/names) */
export type UserName = Pick<IUser, "id" | "name">;

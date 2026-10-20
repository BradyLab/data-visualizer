// Request and response types for the user API
import { type IUser, type IUserName } from "@commons/user";
import { type ServerFields } from "@src/interfaces/general";

/** Payload for updating a user; any subset of the editable fields */
export type UpdateUserPayload = Partial<Omit<IUser, ServerFields>>;

/** Payload for inviting a user */
export type InviteUserPayload = Pick<IUser, "name" | "email" | "role">;

/** Response to inviting a user: the temporary password is only ever sent here, and emailSent is false if the invite email failed or is not set up */
export interface InviteUserResult {
    user: IUser;
    temporaryPassword: string;
    emailSent: boolean;
}

/** A user reduced to what name lookups and role-based choices need (the shape of GET /users/names) */
export type UserName = IUserName;

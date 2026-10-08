// Shared user types used by both the frontend and backend
import type { Timestamp } from "./general.ts";

// Roles that determine a user's level of access in the app
export enum UserRoles {
    ADMIN = "ADMIN",
    LAB_MEMBER = "LAB_MEMBER",
    EXTERNAL = "EXTERNAL",
    GUEST = "GUEST",
}

// Roles a real user account can hold; GUEST is only the frontend's logged-out placeholder, so it is never assigned or filtered on
export const ASSIGNABLE_ROLES: UserRoles[] = Object.values(UserRoles).filter((r) => r !== UserRoles.GUEST);

// Account lifecycle states
export enum UserStatus {
    ACTIVE = "ACTIVE",
    INVITED = "INVITED",
    INACTIVE = "INACTIVE",
}

// A user account as stored in the Users table
// Deliberately has no password field; the backend adds it in IUserPass so it never reaches the frontend
export interface IUser {
    id: string;
    email: string;
    name: string;
    role: UserRoles;
    status: UserStatus;
    createdAt: Timestamp;
    updatedAt: Timestamp | null;
}

// Credentials sent to the login endpoint
export interface ILoginRequest {
    email: string;
    password: string;
}

// Returned by a successful login: a signed JWT and the logged-in user
export interface ILoginResponse {
    token: string;
    user: IUser;
}

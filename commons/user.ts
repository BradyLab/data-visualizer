// Shared user types used by both the frontend and backend

// Roles that determine a user's level of access in the app
export enum UserRoles {
    ADMIN = "ADMIN",
    LAB_MEMBER = "LAB_MEMBER",
    EXTERNAL = "EXTERNAL",
    GUEST = "GUEST",
}

// Account lifecycle states
export enum UserStatus {
    ACTIVE = "ACTIVE",
    INVITED = "INVITED",
    INACTIVE = "INACTIVE",
}

// A user account as stored in the Users table
export interface IUser {
    id: string;
    email: string;
    name: string;
    role: UserRoles;
    status: UserStatus;
    createdAt: Date;
    updatedAt: Date | null;
    deletedAt: Date | null;
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

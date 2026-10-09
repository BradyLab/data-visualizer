// Shared websocket types used by both the frontend and backend (Socket.IO, mounted on the same server as the REST API)
// The server decides which rooms a socket joins from its login token, so clients never send events; they only listen
import type { IActivity } from "./activity.ts";
import type { IDataset } from "./dataset.ts";
import type { FileTypes, IFile } from "./file.ts";
import type { IPermission } from "./permissions.ts";
import type { IUser, IUserName } from "./user.ts";

// Path the websocket server answers on (the frontend connects to the same path)
export const SOCKET_PATH = "/socket.io";

// Names of the events the server pushes. Values are used verbatim on the wire
export enum SocketEvent {
    DATASET_CREATED = "dataset:created",
    DATASET_UPDATED = "dataset:updated",
    DATASET_DELETED = "dataset:deleted",
    PERMISSION_CHANGED = "permission:changed",
    ACTIVITY_CREATED = "activity:created",
    FILE_UPLOADED = "file:uploaded",
    SESSION_REVOKED = "session:revoked",
    USER_CHANGED = "user:changed",
    USER_DELETED = "user:deleted",
    USER_NAME_CHANGED = "user:name-changed",
    FILE_REMOVED = "file:removed",
}

// Rooms a socket is put in by the server. Everyone is in their own user room (the prefix is followed by the user id);
// ADMIN holds the admins and LAB_MEMBERS the lab members, who see every dataset. The server sends a private dataset's events
// to those two rooms, its owner's room and the rooms of the users it is shared with, so a socket only hears about datasets it may see
export const socketRooms = {
    user: (userId: string) => `user:${userId}`,
    ADMIN: "admin",
    LAB_MEMBERS: "lab",
} as const;

// A dataset was created, or its fields changed; sent to everyone who may see it. Clients add it or replace their copy
export interface IDatasetEvent {
    dataset: IDataset;
}

// A dataset was deleted (or stopped being visible to this socket, e.g. made PRIVATE); only the id is sent
export interface IDatasetDeletedEvent {
    id: string;
}

// A permission was granted, changed or revoked; sent to the user it is for, the dataset's owner and admins.
// permission is the new row, or null when the access was revoked (user_id and dataset_id then say which row is gone)
export interface IPermissionChangedEvent {
    user_id: string;
    dataset_id: string;
    permission: IPermission | null;
}

// A new activity was logged; sent to admins only
export interface IActivityEvent {
    activity: IActivity;
}

// A file finished uploading and is now the current version; sent to everyone who may see the dataset
export interface IFileUploadedEvent {
    file: IFile;
}

// Why the server ended the session. After a password change every session but the one that made the change is ended;
// that one gets a new token and reconnects with it
export enum SessionRevokedReason {
    USER_DELETED = "USER_DELETED",
    USER_DEACTIVATED = "USER_DEACTIVATED",
    PASSWORD_CHANGED = "PASSWORD_CHANGED",
    TOKEN_EXPIRED = "TOKEN_EXPIRED",
}

// A user was invited, edited or activated; sent to admins and to that user, so their own session picks up a changed name, role or status
export interface IUserEvent {
    user: IUser;
}

// A user was invited or changed; sent to lab members, who may see names, roles and statuses but not emails (see GET /users/names)
export interface IUserNameEvent {
    user: IUserName;
}

// A user was deleted; sent to admins and lab members (the user's own sessions get session:revoked)
export interface IUserDeletedEvent {
    id: string;
}

// A file of a dataset was deleted (on its own, or because its uploader was deleted); sent to everyone who may see the dataset.
// Clients holding a copy (e.g. a cached cover) should drop it
export interface IFileRemovedEvent {
    id: string;
    dataset_id: string;
    type: FileTypes;
}

// The session ended on the server; the client should log out
export interface ISessionRevokedEvent {
    reason: SessionRevokedReason;
}

// Events the server sends, keyed by name, in the shape Socket.IO uses to type both sides
export interface ServerToClientEvents {
    [SocketEvent.DATASET_CREATED]: (event: IDatasetEvent) => void;
    [SocketEvent.DATASET_UPDATED]: (event: IDatasetEvent) => void;
    [SocketEvent.DATASET_DELETED]: (event: IDatasetDeletedEvent) => void;
    [SocketEvent.PERMISSION_CHANGED]: (event: IPermissionChangedEvent) => void;
    [SocketEvent.ACTIVITY_CREATED]: (event: IActivityEvent) => void;
    [SocketEvent.FILE_UPLOADED]: (event: IFileUploadedEvent) => void;
    [SocketEvent.SESSION_REVOKED]: (event: ISessionRevokedEvent) => void;
    [SocketEvent.USER_CHANGED]: (event: IUserEvent) => void;
    [SocketEvent.USER_DELETED]: (event: IUserDeletedEvent) => void;
    [SocketEvent.USER_NAME_CHANGED]: (event: IUserNameEvent) => void;
    [SocketEvent.FILE_REMOVED]: (event: IFileRemovedEvent) => void;
}

// Events the client may send: none yet
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ClientToServerEvents {}

// Data sent with the connection handshake; the server verifies the token the same way as for REST requests
export interface ISocketAuth {
    token: string;
}

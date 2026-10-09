// Websocket server (Socket.IO) that pushes changes to logged-in browsers; attached to the HTTP server in index.ts.
// Clients only listen: the server picks each socket's rooms from its login token and sends events with the emit* helpers below,
// which the controllers and services call after a change succeeded. Types and event names live in @commons/socket.ts
import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { Permissions } from "@src/models/permission.ts";
import { Datasets } from "@src/models/dataset.ts";
import { userFromHeader } from "@src/middleware/auth.ts";
import { PostgresStore } from "@src/middleware/rateLimitStore.ts";
import { verifyToken } from "@src/services/auth.ts";
import { ipKeyGenerator, type Options } from "express-rate-limit";
import { DatasetVisibility, type IDataset } from "@commons/dataset.ts";
import { UserRoles, UserStatus, type IUserName } from "@commons/user.ts";
import {
    SOCKET_PATH,
    SocketEvent,
    socketRooms,
    type ClientToServerEvents,
    type ServerToClientEvents,
    SessionRevokedReason,
} from "@commons/socket.ts";
import type { IActivity } from "@commons/activity.ts";
import type { IFile } from "@commons/file.ts";
import type { IPermission } from "@commons/permissions.ts";
import type { IUser } from "@commons/user.ts";

interface SocketData {
    userId: string;
    // When the login token this socket connected with expires (ms since the epoch), or null if it never does
    expiresAt: number | null;
}

// Failed connection attempts (bad, expired or missing token) allowed per client IP and window, counted in the same Postgres table as the
// login limiters. Successful connections don't count. Like those limiters, this sees the proxy's address unless the app trusts the proxy
const HANDSHAKE_WINDOW_MS = 15 * 60 * 1000;
const HANDSHAKE_FAILURES = 20;
const handshakeFailures = new PostgresStore("socket-handshake");
handshakeFailures.init({ windowMs: HANDSHAKE_WINDOW_MS } as Options);

// setTimeout cannot wait longer than this (about 24.8 days); longer waits are done in steps
const MAX_TIMER_MS = 2 ** 31 - 1;

type AppServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// Not set until attachSocket runs, so the emit helpers do nothing when the app is built without a server (e.g. in tests)
let io: AppServer | null = null;

/** Starts the websocket server on the HTTP server. Sockets need a valid login token of an ACTIVE user (checked once, when they connect) */
export const attachSocket = (server: HttpServer) => {
    io = new Server(server, {
        path: SOCKET_PATH,
        // Same rule as the REST API: only the browser app may connect
        cors: { origin: process.env.FRONTEND_URL as string },
    });
    io.use(async (socket, next) => {
        const ip = ipKeyGenerator(socket.handshake.address);
        let user: Awaited<ReturnType<typeof userFromHeader>>;
        try {
            // Too many recent failures from this address: refuse without looking at the token or the user table
            if (((await handshakeFailures.get(ip))?.totalHits ?? 0) >= HANDSHAKE_FAILURES)
                return next(new Error("Too many attempts"));
            const token = socket.handshake.auth?.token;
            user = typeof token === "string" ? await userFromHeader(`Bearer ${token}`).catch(() => null) : null;
            // INVITED users are treated as guests by the REST API until they change the default password, so they get no live data either;
            // they reconnect with their new token once they have
            if (!user || user.status !== UserStatus.ACTIVE) {
                await handshakeFailures.increment(ip);
                return next(new Error("Unauthorized"));
            }
            const exp = verifyToken(token as string)?.exp;
            socket.data.expiresAt = exp ? exp * 1000 : null;
        } catch (err) {
            // The limiter's database failed: refuse rather than skip the limit (as the REST limiters do)
            console.error("[SOCKET] Handshake check failed:", err);
            return next(new Error("Unavailable"));
        }
        socket.data.userId = user.id;
        socket.join(socketRooms.user(user.id));
        if (user.role === UserRoles.ADMIN) socket.join(socketRooms.ADMIN);
        if (user.role === UserRoles.LAB_MEMBER) socket.join(socketRooms.LAB_MEMBERS);
        next();
    });
    // The token is only checked when a socket connects, so end the socket when the token it connected with expires, as the REST API
    // would answer 401 from then on. The client logs out on session:revoked
    io.on("connection", (socket) => {
        let timer: NodeJS.Timeout | undefined;
        const check = () => {
            const left = (socket.data.expiresAt ?? Infinity) - Date.now();
            if (left === Infinity) return;
            if (left <= 0) {
                socket.emit(SocketEvent.SESSION_REVOKED, { reason: SessionRevokedReason.TOKEN_EXPIRED });
                socket.disconnect(true);
                return;
            }
            timer = setTimeout(check, Math.min(left, MAX_TIMER_MS));
            timer.unref();
        };
        check();
        socket.on("disconnect", () => clearTimeout(timer));
    });
    return io;
};

// Runs a send, reporting a failure to the console only: a push that fails must never turn a successful request into an error
const safely = async (what: string, send: (io: AppServer) => void | Promise<void>) => {
    if (!io) return;
    try {
        await send(io);
    } catch (err) {
        console.error(`[SOCKET] Failed to send ${what}:`, err);
    }
};

// The rooms that hear about a PRIVATE dataset: admins, lab members, its owner, and the users it is shared with
const privateRooms = async (dataset: Pick<IDataset, "id" | "owner">) => {
    const shared = await Permissions.findAll({ where: { dataset_id: dataset.id }, attributes: ["user_id"] });
    return [
        socketRooms.ADMIN,
        socketRooms.LAB_MEMBERS,
        socketRooms.user(dataset.owner),
        ...shared.map((p) => socketRooms.user(p.user_id)),
    ];
};

// Sends an event to everyone who may see the dataset: all connected users if it is PUBLIC, otherwise the rooms above
const toDatasetAudience = async <E extends SocketEvent>(
    server: AppServer,
    dataset: Pick<IDataset, "id" | "owner" | "visibility">,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
) => {
    const target = dataset.visibility === DatasetVisibility.PUBLIC ? server : server.to(await privateRooms(dataset));
    (target.emit as (event: E, ...args: Parameters<ServerToClientEvents[E]>) => void)(event, ...args);
};

/** A dataset was created */
export const emitDatasetCreated = (dataset: IDataset) =>
    safely("dataset:created", (s) => toDatasetAudience(s, dataset, SocketEvent.DATASET_CREATED, { dataset }));

/**
 * A dataset was updated. Pass its visibility from before the update: when it went from PUBLIC to PRIVATE, everyone outside the
 * private audience is told it is gone, since they can no longer see it
 */
export const emitDatasetUpdated = (dataset: IDataset, before: DatasetVisibility) =>
    safely("dataset:updated", async (s) => {
        await toDatasetAudience(s, dataset, SocketEvent.DATASET_UPDATED, { dataset });
        if (before === DatasetVisibility.PUBLIC && dataset.visibility === DatasetVisibility.PRIVATE)
            s.except(await privateRooms(dataset)).emit(SocketEvent.DATASET_DELETED, { id: dataset.id });
    });

/** A dataset was deleted. Sent to every socket (an id of a deleted dataset reveals nothing); clients without it ignore it */
export const emitDatasetDeleted = (id: string) =>
    safely("dataset:deleted", (s) => {
        s.emit(SocketEvent.DATASET_DELETED, { id });
    });

/** A permission was granted, changed (pass the new row) or revoked (pass null and the ids of the removed row) */
export const emitPermissionChanged = (
    ids: { user_id: string; dataset_id: string },
    permission: IPermission | null,
    datasetOwner: string
) =>
    safely("permission:changed", (s) => {
        // Only the two ids are copied: the argument may be a model instance, which must not be spread into the payload
        const { user_id, dataset_id } = ids;
        s.to([socketRooms.user(user_id), socketRooms.user(datasetOwner), socketRooms.ADMIN]).emit(
            SocketEvent.PERMISSION_CHANGED,
            {
                user_id,
                dataset_id,
                permission,
            }
        );
    });

/**
 * Several permissions changed or were removed at once (a user's EDIT rows downgraded, or a deleted user's rows cascaded away).
 * Their datasets' owners are looked up here so they hear about it too
 */
export const emitPermissionsChanged = (rows: IPermission[], removed: boolean) =>
    safely("permission:changed", async (s) => {
        if (!rows.length) return;
        const datasets = await Datasets.findAll({ where: { id: rows.map((r) => r.dataset_id) }, attributes: ["id", "owner"] });
        for (const row of rows) {
            const owner = datasets.find((d) => d.id === row.dataset_id)?.owner;
            s.to([socketRooms.user(row.user_id), socketRooms.ADMIN, ...(owner ? [socketRooms.user(owner)] : [])]).emit(
                SocketEvent.PERMISSION_CHANGED,
                { user_id: row.user_id, dataset_id: row.dataset_id, permission: removed ? null : row }
            );
        }
    });

/** A user was invited or changed; admins and the user themselves get the whole record, lab members only the name, role and status */
export const emitUserChanged = (user: IUser) =>
    safely("user:changed", (s) => {
        s.to([socketRooms.ADMIN, socketRooms.user(user.id)]).emit(SocketEvent.USER_CHANGED, { user });
        const summary: IUserName = { id: user.id, name: user.name, role: user.role, status: user.status };
        s.to(socketRooms.LAB_MEMBERS).emit(SocketEvent.USER_NAME_CHANGED, { user: summary });
    });

/** A user was deleted; admins and lab members hear about it */
export const emitUserDeleted = (id: string) =>
    safely("user:deleted", (s) => {
        s.to([socketRooms.ADMIN, socketRooms.LAB_MEMBERS]).emit(SocketEvent.USER_DELETED, { id });
    });

/** Moves a user's open sockets into the rooms their new role belongs to, so they hear about the right datasets and logs without reconnecting */
export const updateRooms = (userId: string, role: UserRoles) =>
    safely("room update", (s) => {
        const sockets = s.in(socketRooms.user(userId));
        sockets.socketsLeave([socketRooms.ADMIN, socketRooms.LAB_MEMBERS]);
        if (role === UserRoles.ADMIN) sockets.socketsJoin(socketRooms.ADMIN);
        if (role === UserRoles.LAB_MEMBER) sockets.socketsJoin(socketRooms.LAB_MEMBERS);
    });

/** An activity was logged; only admins see the log */
export const emitActivity = (activity: IActivity) =>
    safely("activity:created", (s) => {
        s.to(socketRooms.ADMIN).emit(SocketEvent.ACTIVITY_CREATED, { activity });
    });

/** A file finished uploading and became the current version of its dataset */
export const emitFileUploaded = (file: IFile) =>
    safely("file:uploaded", async (s) => {
        const dataset = await Datasets.findByPk(file.dataset_id);
        if (dataset) await toDatasetAudience(s, dataset, SocketEvent.FILE_UPLOADED, { file });
    });

/** A file of a dataset was deleted; everyone who may see the dataset is told so they can drop their copies */
export const emitFileRemoved = (file: Pick<IFile, "id" | "dataset_id" | "type">) =>
    safely("file:removed", async (s) => {
        const dataset = await Datasets.findByPk(file.dataset_id);
        if (dataset)
            await toDatasetAudience(s, dataset, SocketEvent.FILE_REMOVED, {
                id: file.id,
                dataset_id: file.dataset_id,
                type: file.type,
            });
    });

/**
 * Tells every open session of a user that it ended, then closes their sockets (the login token itself is checked per REST request).
 * Pass the socket id of the session that caused the change to leave that one open, e.g. the tab that just changed the password
 */
export const revokeSession = (userId: string, reason: SessionRevokedReason, exceptSocketId?: string) =>
    safely("session:revoked", (s) => {
        const room = socketRooms.user(userId);
        const others = exceptSocketId ? s.in(room).except(exceptSocketId) : s.in(room);
        others.emit(SocketEvent.SESSION_REVOKED, { reason });
        others.disconnectSockets(true);
    });

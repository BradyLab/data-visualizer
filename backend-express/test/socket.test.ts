// Tests for the websocket server (services/socket) with real Socket.IO clients: who may connect, which rooms hear which event, and how
// sessions end. The database is stubbed (users, permissions, datasets and the handshake failure counter)
import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { DatasetVisibility, type IDataset } from "@commons/dataset.ts";
import { SOCKET_PATH, SocketEvent, SessionRevokedReason } from "@commons/socket.ts";
import { UserRoles, UserStatus, type IUser } from "@commons/user.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { FileTypes, type IFile } from "@commons/file.ts";
import type { IActivity } from "@commons/activity.ts";

process.env.JWT_SECRET = "test-secret";
process.env.FRONTEND_URL = "http://frontend.test";

const {
    attachSocket,
    emitActivity,
    emitDatasetCreated,
    emitDatasetDeleted,
    emitDatasetUpdated,
    emitUserChanged,
    emitUserDeleted,
} = await import("@src/services/socket.ts");
const { emitFileRemoved, emitFileUploaded, emitPermissionChanged, emitPermissionsChanged, revokeSession, updateRooms } = await import("@src/services/socket.ts");
const { signToken } = await import("@src/services/auth.ts");
const { passwordVersion } = await import("@src/services/auth.ts");
const { Users } = await import("@src/models/user.ts");
const { Datasets } = await import("@src/models/dataset.ts");
const { Permissions } = await import("@src/models/permission.ts");
const { PostgresStore } = await import("@src/middleware/rateLimitStore.ts");

// The users the stubbed database knows
const users: Record<string, { id: string; role: UserRoles; status: UserStatus; password: string }> = {};
const addUser = (id: string, role: UserRoles, status = UserStatus.ACTIVE) =>
    (users[id] = { id, role, status, password: `hash-${id}` });
const tokenOf = (id: string) => signToken(id, users[id]!.password);

let failures = 0; // the handshake failure counter of the address
let counterBroken = false;
let datasetVisibility = DatasetVisibility.PRIVATE; // of the stubbed dataset d1
let sharedWith: Record<string, PermissionOptions> = {}; // the permission level each user holds on the dataset

let server: http.Server;
let url: string;
const sockets: Socket[] = [];
before(async () => {
    server = http.createServer();
    attachSocket(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
    mock.restoreAll();
    await new Promise((resolve) => (server.closeAllConnections(), server.close(resolve)));
});
afterEach(() => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    for (const id of Object.keys(users)) delete users[id];
    failures = 0;
    counterBroken = false;
    sharedWith = {};
    datasetVisibility = DatasetVisibility.PRIVATE;
    delete process.env.JWT_EXPIRES_IN;
});

mock.method(Users, "findByPk", async (id: string) => {
    const user = users[id];
    return user ? { ...user, dataValues: { ...user } } : null;
});
mock.method(Permissions, "findAll", async ({ where }: { where: { perm?: PermissionOptions[] } }) =>
    Object.entries(sharedWith)
        .filter(([, perm]) => !where.perm || where.perm.includes(perm))
        .map(([user_id]) => ({ user_id }))
);
mock.method(Datasets, "findAll", async () => [{ id: "d1", owner: "owner" }]);
mock.method(Datasets, "findByPk", async () => ({ id: "d1", owner: "owner", visibility: datasetVisibility }));
mock.method(PostgresStore.prototype, "get", async () => {
    if (counterBroken) throw new Error("db down");
    return failures ? { totalHits: failures, resetTime: new Date() } : undefined;
});
mock.method(PostgresStore.prototype, "increment", async () => ({ totalHits: ++failures, resetTime: new Date() }));

/** Connects (resolving once the server accepted the socket) and records the events it receives */
const open = (token?: string) => {
    const socket = connect(url, {
        path: SOCKET_PATH,
        transports: ["websocket"],
        auth: token ? { token } : {},
        reconnection: false,
    });
    sockets.push(socket);
    const events: { name: string; payload: unknown }[] = [];
    socket.onAny((name, payload) => events.push({ name, payload }));
    return new Promise<{ socket: Socket; events: typeof events }>((resolve, reject) => {
        socket.on("connect", () => resolve({ socket, events }));
        socket.on("connect_error", reject);
    });
};
const connectAs = (id: string) => open(tokenOf(id));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = () => sleep(100); // long enough for an event to arrive over loopback
const heard = <T extends { name: string }>(events: T[], name: string) => events.filter((e) => e.name === name);

const dataset = (visibility: DatasetVisibility) => ({ id: "d1", owner: "owner", visibility }) as IDataset;
const standardUsers = () => {
    addUser("admin", UserRoles.ADMIN);
    addUser("lab", UserRoles.LAB_MEMBER);
    addUser("owner", UserRoles.EXTERNAL);
    addUser("shared", UserRoles.EXTERNAL);
    addUser("other", UserRoles.EXTERNAL);
    sharedWith = { shared: PermissionOptions.VIEW };
};
const everyone = async () => ({
    admin: await connectAs("admin"),
    lab: await connectAs("lab"),
    owner: await connectAs("owner"),
    shared: await connectAs("shared"),
    other: await connectAs("other"),
});

test("only an ACTIVE user with a valid token may connect", async () => {
    addUser("a", UserRoles.EXTERNAL);
    addUser("invited", UserRoles.EXTERNAL, UserStatus.INVITED);
    addUser("inactive", UserRoles.EXTERNAL, UserStatus.INACTIVE);
    await open(tokenOf("a"));
    await assert.rejects(open(), /Unauthorized/);
    await assert.rejects(open("garbage"), /Unauthorized/);
    await assert.rejects(open(tokenOf("invited")), /Unauthorized/);
    await assert.rejects(open(tokenOf("inactive")), /Unauthorized/);
    // a token of a user who was deleted meanwhile
    const token = tokenOf("a");
    delete users.a;
    await assert.rejects(open(token), /Unauthorized/);
});

test("a token made before a password change no longer connects", async () => {
    addUser("a", UserRoles.EXTERNAL);
    const token = tokenOf("a");
    users.a!.password = "a-new-hash";
    assert.notEqual(passwordVersion("a-new-hash"), passwordVersion("hash-a"));
    await assert.rejects(open(token), /Unauthorized/);
});

test("failed connection attempts are counted, and an address over the limit is refused even with a valid token", async () => {
    addUser("a", UserRoles.EXTERNAL);
    await assert.rejects(open("garbage"), /Unauthorized/);
    assert.equal(failures, 1);
    await open(tokenOf("a")); // successful connections do not count
    assert.equal(failures, 1);
    failures = 20;
    await assert.rejects(open(tokenOf("a")), /Too many attempts/);
});

test("a failing counter refuses the connection instead of skipping the limit", async () => {
    addUser("a", UserRoles.EXTERNAL);
    counterBroken = true;
    mock.method(console, "error", () => {});
    await assert.rejects(open(tokenOf("a")), /Unavailable/);
});

test("a PUBLIC dataset is announced to every connected user", async () => {
    standardUsers();
    const all = await everyone();
    await emitDatasetCreated(dataset(DatasetVisibility.PUBLIC));
    await settle();
    for (const [who, { events }] of Object.entries(all)) assert.equal(heard(events, SocketEvent.DATASET_CREATED).length, 1, who);
});

test("a PRIVATE dataset is announced to admins, lab members, its owner and the users it is shared with only", async () => {
    standardUsers();
    const all = await everyone();
    await emitDatasetCreated(dataset(DatasetVisibility.PRIVATE));
    await settle();
    const counts = Object.fromEntries(
        Object.entries(all).map(([who, { events }]) => [who, heard(events, SocketEvent.DATASET_CREATED).length])
    );
    assert.deepEqual(counts, { admin: 1, lab: 1, owner: 1, shared: 1, other: 0 });
});

test("making a dataset PRIVATE tells everyone who lost sight of it that it is gone", async () => {
    standardUsers();
    const all = await everyone();
    await emitDatasetUpdated(dataset(DatasetVisibility.PRIVATE), DatasetVisibility.PUBLIC);
    await settle();
    const updated = Object.fromEntries(
        Object.entries(all).map(([who, { events }]) => [who, heard(events, SocketEvent.DATASET_UPDATED).length])
    );
    const deleted = Object.fromEntries(
        Object.entries(all).map(([who, { events }]) => [who, heard(events, SocketEvent.DATASET_DELETED).length])
    );
    assert.deepEqual(updated, { admin: 1, lab: 1, owner: 1, shared: 1, other: 0 });
    assert.deepEqual(deleted, { admin: 0, lab: 0, owner: 0, shared: 0, other: 1 });
});

test("an update that keeps a dataset PUBLIC deletes nothing, and a deletion reaches everybody", async () => {
    standardUsers();
    const { other } = await everyone();
    await emitDatasetUpdated(dataset(DatasetVisibility.PUBLIC), DatasetVisibility.PUBLIC);
    await settle();
    assert.equal(heard(other.events, SocketEvent.DATASET_DELETED).length, 0);
    assert.equal(heard(other.events, SocketEvent.DATASET_UPDATED).length, 1);
    await emitDatasetDeleted("d1");
    await settle();
    assert.deepEqual(heard(other.events, SocketEvent.DATASET_DELETED), [
        { name: SocketEvent.DATASET_DELETED, payload: { id: "d1" } },
    ]);
});

test("a permission change reaches the user, the dataset's owner and admins", async () => {
    standardUsers();
    const all = await everyone();
    await emitPermissionChanged({ user_id: "shared", dataset_id: "d1" }, null, "owner");
    await settle();
    const counts = Object.fromEntries(
        Object.entries(all).map(([who, { events }]) => [who, heard(events, SocketEvent.PERMISSION_CHANGED).length])
    );
    assert.deepEqual(counts, { admin: 1, lab: 0, owner: 1, shared: 1, other: 0 });
    assert.deepEqual(heard(all.shared.events, SocketEvent.PERMISSION_CHANGED)[0]!.payload, {
        user_id: "shared",
        dataset_id: "d1",
        permission: null,
    });
});

test("several permissions at once look up the datasets' owners, and removed rows are sent as null", async () => {
    standardUsers();
    const all = await everyone();
    await emitPermissionsChanged([{ user_id: "shared", dataset_id: "d1" } as never], true);
    await settle();
    assert.equal(heard(all.owner.events, SocketEvent.PERMISSION_CHANGED).length, 1);
    assert.equal(
        (heard(all.shared.events, SocketEvent.PERMISSION_CHANGED)[0]!.payload as { permission: unknown }).permission,
        null
    );
    assert.equal(heard(all.other.events, SocketEvent.PERMISSION_CHANGED).length, 0);
    await emitPermissionsChanged([], false); // nothing to send, nothing to look up
});

test("a user's record goes to admins and the user, lab members get only the summary", async () => {
    standardUsers();
    const all = await everyone();
    const user = { id: "shared", name: "Sam", email: "sam@x.org", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE } as IUser;
    await emitUserChanged(user);
    await settle();
    assert.equal(heard(all.admin.events, SocketEvent.USER_CHANGED).length, 1);
    assert.equal(heard(all.shared.events, SocketEvent.USER_CHANGED).length, 1);
    assert.equal(heard(all.lab.events, SocketEvent.USER_CHANGED).length, 0);
    assert.equal(heard(all.other.events, SocketEvent.USER_CHANGED).length, 0);
    assert.deepEqual(heard(all.lab.events, SocketEvent.USER_NAME_CHANGED)[0]!.payload, {
        user: { id: "shared", name: "Sam", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE },
    });
    await emitUserDeleted("shared");
    await settle();
    assert.equal(heard(all.lab.events, SocketEvent.USER_DELETED).length, 1);
    assert.equal(heard(all.other.events, SocketEvent.USER_DELETED).length, 0);
});

const withVisibility = (visibility: DatasetVisibility) => (datasetVisibility = visibility);
const fileOf = (type: FileTypes) => ({ id: "f1", dataset_id: "d1", type }) as IFile;
const fileCounts = (all: Awaited<ReturnType<typeof everyone>>, name: SocketEvent) =>
    Object.fromEntries(Object.entries(all).map(([who, { events }]) => [who, heard(events, name).length]));

test("a data file's upload and removal reach only those who may download, whether the dataset is private or public", async () => {
    standardUsers();
    sharedWith = { shared: PermissionOptions.DOWNLOAD, other: PermissionOptions.VIEW };
    const all = await everyone();
    for (const visibility of [DatasetVisibility.PRIVATE, DatasetVisibility.PUBLIC]) {
        withVisibility(visibility);
        for (const type of [FileTypes.RDS, FileTypes.TISSUE_PLOT]) {
            for (const events of Object.values(all)) events.events.length = 0;
            await emitFileUploaded(fileOf(type));
            await emitFileRemoved(fileOf(type));
            await settle();
            const expected = { admin: 1, lab: 1, owner: 1, shared: 1, other: 0 };
            assert.deepEqual(fileCounts(all, SocketEvent.FILE_UPLOADED), expected, `${visibility} ${type} uploaded`);
            assert.deepEqual(fileCounts(all, SocketEvent.FILE_REMOVED), expected, `${visibility} ${type} removed`);
        }
    }
});

test("a user holding EDIT hears about data files too", async () => {
    standardUsers();
    sharedWith = { shared: PermissionOptions.EDIT };
    const all = await everyone();
    await emitFileUploaded(fileOf(FileTypes.RDS));
    await settle();
    assert.equal(heard(all.shared.events, SocketEvent.FILE_UPLOADED).length, 1);
    assert.equal(heard(all.other.events, SocketEvent.FILE_UPLOADED).length, 0);
});

test("a cover's upload and removal still reach everyone who may see the dataset", async () => {
    standardUsers();
    const all = await everyone();
    // PRIVATE: the viewers of the dataset (the stub shares it with `shared` at VIEW) but not strangers
    await emitFileUploaded(fileOf(FileTypes.COVER));
    await emitFileRemoved(fileOf(FileTypes.COVER));
    await settle();
    const expected = { admin: 1, lab: 1, owner: 1, shared: 1, other: 0 };
    assert.deepEqual(fileCounts(all, SocketEvent.FILE_UPLOADED), expected);
    assert.deepEqual(fileCounts(all, SocketEvent.FILE_REMOVED), expected);
    // PUBLIC: everyone
    withVisibility(DatasetVisibility.PUBLIC);
    for (const { events } of Object.values(all)) events.length = 0;
    await emitFileUploaded(fileOf(FileTypes.COVER));
    await settle();
    assert.deepEqual(fileCounts(all, SocketEvent.FILE_UPLOADED), { admin: 1, lab: 1, owner: 1, shared: 1, other: 1 });
});

test("the activity log is for admins only", async () => {
    standardUsers();
    const all = await everyone();
    await emitActivity({ id: "act" } as IActivity);
    await settle();
    const counts = Object.fromEntries(
        Object.entries(all).map(([who, { events }]) => [who, heard(events, SocketEvent.ACTIVITY_CREATED).length])
    );
    assert.deepEqual(counts, { admin: 1, lab: 0, owner: 0, shared: 0, other: 0 });
});

test("updateRooms moves open sockets to the rooms of the new role", async () => {
    standardUsers();
    const { other } = await everyone();
    await emitActivity({ id: "before" } as IActivity);
    await settle();
    assert.equal(heard(other.events, SocketEvent.ACTIVITY_CREATED).length, 0);
    await updateRooms("other", UserRoles.ADMIN);
    await emitActivity({ id: "promoted" } as IActivity);
    await settle();
    assert.equal(heard(other.events, SocketEvent.ACTIVITY_CREATED).length, 1);
    await updateRooms("other", UserRoles.EXTERNAL);
    await emitActivity({ id: "demoted" } as IActivity);
    await settle();
    assert.equal(heard(other.events, SocketEvent.ACTIVITY_CREATED).length, 1);
});

test("revokeSession ends every session of the user but the excepted one", async () => {
    standardUsers();
    const first = await connectAs("shared");
    const second = await connectAs("shared");
    const bystander = await connectAs("other");
    await revokeSession("shared", SessionRevokedReason.PASSWORD_CHANGED, first.socket.id);
    await settle();
    assert.equal(heard(second.events, SocketEvent.SESSION_REVOKED).length, 1);
    assert.equal(second.socket.connected, false);
    assert.equal(heard(first.events, SocketEvent.SESSION_REVOKED).length, 0);
    assert.equal(first.socket.connected, true);
    assert.equal(bystander.socket.connected, true);
    await revokeSession("shared", SessionRevokedReason.PASSWORD_CHANGED);
    await settle();
    assert.equal(first.socket.connected, false);
});

test("a socket is ended when the token it connected with expires", async () => {
    addUser("a", UserRoles.EXTERNAL);
    process.env.JWT_EXPIRES_IN = "1s";
    const { socket, events } = await connectAs("a");
    assert.equal(socket.connected, true);
    await sleep(1400);
    assert.deepEqual(heard(events, SocketEvent.SESSION_REVOKED), [
        { name: SocketEvent.SESSION_REVOKED, payload: { reason: SessionRevokedReason.TOKEN_EXPIRED } },
    ]);
    assert.equal(socket.connected, false);
});

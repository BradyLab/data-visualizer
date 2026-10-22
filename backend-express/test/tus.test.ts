// Tests for the tus upload endpoint (services/tus) over real HTTP: who may start, continue and inspect an upload. The database is
// stubbed. Finishing an upload (moving the file and creating its record) needs a database and is covered by the e2e tests
import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetVisibility } from "@commons/dataset.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";

const uploadDir = await mkdtemp(path.join(os.tmpdir(), "tus-test-"));
process.env.UPLOAD_DIR = uploadDir;
process.env.JWT_SECRET = "test-secret";
process.env.FRONTEND_URL = "http://frontend.test";

const { tusServer, TUS_PATH } = await import("@src/services/tus.ts");
const { signToken } = await import("@src/services/auth.ts");
const storage = await import("@src/services/storage.ts");
const { Users } = await import("@src/models/user.ts");
const { Datasets } = await import("@src/models/dataset.ts");
const { Permissions } = await import("@src/models/permission.ts");
const { Files } = await import("@src/models/file.ts");

const users: Record<string, { id: string; role: UserRoles; status: UserStatus; password: string }> = {
    admin: { id: "admin", role: UserRoles.ADMIN, status: UserStatus.ACTIVE, password: "h" },
    editor: { id: "editor", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE, password: "h" },
    viewer: { id: "viewer", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE, password: "h" },
    stranger: { id: "stranger", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE, password: "h" },
};
// The PRIVATE dataset "d1" is owned by the editor; other users hold what `permissions` says (a viewer can view, not edit)
let datasetOwner = "editor";
let datasetVisibility = DatasetVisibility.PRIVATE;
let latestVersion = 0;
let datasetMissing = false;
const permissions: Record<string, PermissionOptions> = { viewer: PermissionOptions.VIEW };

before(async () => {
    await storage.ensureDirs();
});
after(() => rm(uploadDir, { recursive: true, force: true }));

mock.method(Users, "findByPk", async (id: string) => {
    const user = users[id];
    return user ? { ...user, dataValues: { ...user } } : null;
});
mock.method(Datasets, "findByPk", async (id: string) =>
    id === "d1" && !datasetMissing ? { id: "d1", owner: datasetOwner, visibility: datasetVisibility } : null
);
mock.method(Permissions, "findOne", async ({ where }: { where: { user_id: string } }) =>
    permissions[where.user_id] ? { perm: permissions[where.user_id] } : null
);
mock.method(Files, "max", async () => latestVersion || null);
afterEach(() => {
    datasetOwner = "editor";
    datasetVisibility = DatasetVisibility.PRIVATE;
    latestVersion = 0;
    datasetMissing = false;
});

let server: http.Server;
let base: string;
before(async () => {
    server = http.createServer((req, res) => tusServer.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
    server.closeAllConnections();
    server.close();
});

const b64 = (s: string) => Buffer.from(s).toString("base64");
const authHeader = (as?: string) => (as ? { authorization: `Bearer ${signToken(as, users[as]!.password)}` } : {});
const metadata = (fields: Record<string, string>) =>
    Object.entries(fields)
        .map(([k, v]) => `${k} ${b64(v)}`)
        .join(",");

/** Starts an upload of `size` bytes as the user (nobody = no token) and returns the response */
const create = (as: string | undefined, fields: Record<string, string>, size = 5) =>
    fetch(base + TUS_PATH, {
        method: "POST",
        headers: {
            "tus-resumable": "1.0.0",
            "upload-length": String(size),
            "upload-metadata": metadata(fields),
            ...authHeader(as),
        },
    });
const good = { dataset_id: "d1", type: "RDS", filename: "data.rds" };
const locationOf = (res: Response) => new URL(res.headers.get("location")!, base).pathname;
const tmpFiles = () => readdir(storage.TMP_DIR).catch(() => [] as string[]);

test("an editor can start an upload, which is stored in the temporary folder with the user's id", async () => {
    const res = await create("editor", { ...good, user_id: "someone-else" });
    assert.equal(res.status, 201);
    assert.match(locationOf(res), new RegExp(`^${TUS_PATH}/`));
    const info = (await tmpFiles()).find((f) => f.endsWith(".json"))!;
    const stored = JSON.parse(await readFile(path.join(storage.TMP_DIR, info), "utf8"));
    assert.equal(stored.metadata.user_id, "editor", "a user_id sent by the client is replaced");
    assert.equal(stored.metadata.dataset_id, "d1");
});

test("starting an upload needs a valid login", async () => {
    assert.equal((await create(undefined, good)).status, 401);
    const res = await fetch(base + TUS_PATH, {
        method: "POST",
        headers: {
            "tus-resumable": "1.0.0",
            "upload-length": "5",
            "upload-metadata": metadata(good),
            authorization: "Bearer garbage",
        },
    });
    assert.equal(res.status, 401);
});

test("starting an upload needs EDIT access to a dataset the user can see", async () => {
    assert.equal((await create("viewer", good)).status, 403); // can view, not edit
    assert.equal((await create("stranger", good)).status, 404); // cannot see the private dataset, which is not revealed
    assert.equal((await create("editor", { ...good, dataset_id: "missing" })).status, 404);
    assert.equal((await create("admin", good)).status, 201); // admins own everything
    datasetVisibility = DatasetVisibility.PUBLIC;
    assert.equal((await create("stranger", good)).status, 403); // sees it now, but still cannot edit
});

test("invalid metadata is refused before any bytes are accepted", async () => {
    const refused = async (fields: Record<string, string>, size?: number) => {
        const res = await create("editor", fields, size);
        assert.equal(res.status, 400);
        return res.text();
    };
    assert.match(await refused({ type: "RDS", filename: "a.rds" }), /dataset_id is required/);
    assert.match(await refused({ ...good, filename: "a.csv" }), /must have one of these extensions/);
    assert.match(await refused({ ...good, type: "NOPE" }), /type must be one of/);
    assert.match(await refused({ ...good, type: "COVER", filename: "a.png" }, storage.MAX_COVER_BYTES + 1), /at most/);
    assert.match(
        await refused({ ...good, type: "COVER", filename: "a.png", updates: "notes" }),
        /updates are only allowed on RDS files/
    );
});

test("a version that is not newer than the latest is refused up front", async () => {
    latestVersion = 3;
    const res = await create("editor", { ...good, version: "3" });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /version must be higher than the latest version \(3\)/);
    assert.equal((await create("editor", { ...good, version: "4" })).status, 201);
    assert.equal((await create("editor", good)).status, 201);
});

test("an upload can only be inspected and continued by the user who started it, while they can still edit", async () => {
    const location = locationOf(await create("editor", good));
    const head = (as?: string) =>
        fetch(base + location, { method: "HEAD", headers: { "tus-resumable": "1.0.0", ...authHeader(as) } });
    const patch = (as?: string) =>
        fetch(base + location, {
            method: "PATCH",
            headers: {
                "tus-resumable": "1.0.0",
                "upload-offset": "0",
                "content-type": "application/offset+octet-stream",
                ...authHeader(as),
            },
            body: "abc",
        });
    assert.equal((await head("editor")).status, 200);
    assert.equal((await head("editor")).headers.get("upload-offset"), "0");
    assert.equal((await head("admin")).status, 403); // even an admin cannot touch somebody else's upload
    assert.equal((await head("viewer")).status, 403);
    assert.equal((await head()).status, 403);
    assert.equal((await patch("viewer")).status, 403);
    assert.equal((await patch()).status, 403);
    // access lost mid-upload: the private dataset is no longer visible to the user, and then only viewable
    datasetOwner = "someone-else";
    assert.equal((await head("editor")).status, 404);
    assert.equal((await patch("editor")).status, 404);
    permissions.editor = PermissionOptions.VIEW;
    assert.equal((await head("editor")).status, 403);
    assert.equal((await patch("editor")).status, 403);
    delete permissions.editor;
    // the dataset was deleted
    datasetOwner = "editor";
    datasetMissing = true;
    assert.equal((await head("editor")).status, 404);
    // an upload that does not exist is answered by tus itself
    const unknown = await fetch(`${base}${TUS_PATH}/nope`, {
        method: "HEAD",
        headers: { "tus-resumable": "1.0.0", ...authHeader("editor") },
    });
    assert.equal(unknown.status, 404);
});

test("an upload is continued from where it stopped, up to the size announced", async () => {
    const location = locationOf(await create("editor", good, 6));
    const send = (offset: number, body: string) =>
        fetch(base + location, {
            method: "PATCH",
            headers: {
                "tus-resumable": "1.0.0",
                "upload-offset": String(offset),
                "content-type": "application/offset+octet-stream",
                ...authHeader("editor"),
            },
            body,
        });
    const first = await send(0, "abc");
    assert.equal(first.status, 204);
    assert.equal(first.headers.get("upload-offset"), "3");
    assert.equal((await send(0, "abc")).status, 409, "a chunk for the wrong offset is refused");
    const head = await fetch(base + location, { method: "HEAD", headers: { "tus-resumable": "1.0.0", ...authHeader("editor") } });
    assert.equal(head.headers.get("upload-offset"), "3");
});

test("an upload larger than the allowed maximum is refused", async () => {
    const res = await create("editor", good, 40 * 1024 * 1024 * 1024);
    assert.equal(res.status, 413);
});

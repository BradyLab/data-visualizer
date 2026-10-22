// Tests for the dataset, permission and file controllers: who may do what, and the status codes of the refusals.
// The models are stubbed, so no database is needed; the websocket and activity log are inert here (no server is attached)
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetStatus, DatasetVisibility } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { fakeReq, fakeRes } from "./fixtures/http.ts";

process.env.JWT_SECRET = "test-secret";
process.env.UPLOAD_DIR = await mkdtemp(path.join(os.tmpdir(), "controllers-test-"));
const dataset = await import("@src/controllers/dataset.ts");
const permission = await import("@src/controllers/permission.ts");
const file = await import("@src/controllers/file.ts");
const { Datasets } = await import("@src/models/dataset.ts");
const { Permissions } = await import("@src/models/permission.ts");
const { Files } = await import("@src/models/file.ts");
const { Users } = await import("@src/models/user.ts");
const { Activities } = await import("@src/models/activity.ts");
const { signDownloadToken, verifyDownloadToken } = await import("@src/services/auth.ts");

const user = (id: string, role: UserRoles, status = UserStatus.ACTIVE) => ({ id, role, status });
const admin = user("admin", UserRoles.ADMIN);
const owner = user("owner", UserRoles.LAB_MEMBER);
const lab = user("lab", UserRoles.LAB_MEMBER);
const external = user("ext", UserRoles.EXTERNAL);

// Rows the stubs serve; reset before each test
let datasets: Record<string, Record<string, unknown>>;
let permissions: Array<{ user_id: string; dataset_id: string; perm: PermissionOptions }>;
let files: Array<Record<string, unknown>>;
let users: Record<string, ReturnType<typeof user>>;

// A model instance stand-in: its fields plus get()
const row = <T extends Record<string, unknown>>(fields: T) => ({ ...fields, get: () => ({ ...fields }) });

beforeEach(() => {
    datasets = {
        pub: { id: "pub", url: "pub", owner: "owner", visibility: DatasetVisibility.PUBLIC, status: DatasetStatus.READY, plots: [] },
        priv: { id: "priv", url: "priv", owner: "owner", visibility: DatasetVisibility.PRIVATE, status: DatasetStatus.READY, plots: [] },
        busy: { id: "busy", url: "busy", owner: "owner", visibility: DatasetVisibility.PUBLIC, status: DatasetStatus.PROCESSING, plots: [] },
    };
    permissions = [];
    files = [];
    users = { admin, owner, lab, ext: external };
    mock.method(Datasets, "findByPk", async (id: string) => (datasets[id] ? row(datasets[id]) : null));
    mock.method(Datasets, "findOne", async ({ where }: { where: { url: string } }) => {
        const found = Object.values(datasets).find((d) => d.url === where.url);
        return found ? row(found) : null;
    });
    mock.method(Users, "findAll", async () => Object.values(users));
    mock.method(Users, "findByPk", async (id: string) => users[id] ?? null);
    mock.method(Permissions, "findOne", async ({ where }: { where: { user_id: string; dataset_id: string } }) => {
        const found = permissions.find((p) => p.user_id === where.user_id && p.dataset_id === where.dataset_id);
        return found ? row(found) : null;
    });
    mock.method(Files, "findByPk", async (id: string) => files.find((f) => f.id === id) ?? null);
    mock.method(Files, "findAll", async (options?: { where?: { dataset_id?: string } }) =>
        files.filter((f) => !options?.where?.dataset_id || f.dataset_id === options.where.dataset_id)
    );
    mock.method(Files, "findOne", async ({ where }: { where: Record<string, unknown> }) =>
        files.find((f) => Object.entries(where).every(([k, v]) => f[k] === v)) ?? null
    );
    mock.method(Activities, "create", async () => row({}));
    // Quiet output; the controllers log every request
    mock.method(console, "log", () => {});
});
afterEach(() => mock.restoreAll());

const call = async (handler: (req: never, res: never) => unknown, as: ReturnType<typeof user> | null, req: Parameters<typeof fakeReq>[0] = {}) => {
    const res = fakeRes({ user: as });
    await handler(fakeReq(req), res as never);
    return res;
};

// ---- datasets ----

test("get answers 404 for a private dataset the caller cannot see, so its existence is not revealed", async () => {
    assert.equal((await call(dataset.get, null, { params: { id: "priv" } })).statusCode, 404);
    assert.equal((await call(dataset.get, external, { params: { id: "priv" } })).statusCode, 404);
    assert.equal((await call(dataset.get, null, { params: { id: "missing" } })).statusCode, 404);
    assert.equal((await call(dataset.get, null, { params: { id: "pub" } })).statusCode, 200);
    assert.equal((await call(dataset.get, lab, { params: { id: "priv" } })).statusCode, 200);
});

test("getByUrl applies the same visibility rule as get", async () => {
    assert.equal((await call(dataset.getByUrl, null, { params: { url: "priv" } })).statusCode, 404);
    assert.equal((await call(dataset.getByUrl, null, { params: { url: "nope" } })).statusCode, 404);
    assert.equal((await call(dataset.getByUrl, external, { params: { url: "pub" } })).statusCode, 200);
});

test("update needs EDIT, and only an owner may change visibility", async () => {
    const stubUpdate = () => mock.method(Datasets, "findByPk", async (id: string) => (datasets[id] ? { ...row(datasets[id]), update: async (f: object) => row({ ...datasets[id], ...f }) } : null));
    stubUpdate();
    const body = { name: "New name" };
    assert.equal((await call(dataset.update, lab, { params: { id: "pub" }, body })).statusCode, 403);
    permissions.push({ user_id: "lab", dataset_id: "pub", perm: PermissionOptions.EDIT });
    assert.equal((await call(dataset.update, lab, { params: { id: "pub" }, body })).statusCode, 200);
    const hide = { visibility: DatasetVisibility.PRIVATE };
    assert.equal((await call(dataset.update, lab, { params: { id: "pub" }, body: hide })).statusCode, 403);
    assert.equal((await call(dataset.update, owner, { params: { id: "pub" }, body: hide })).statusCode, 200);
    // Sending the visibility it already has is not a change
    assert.equal((await call(dataset.update, lab, { params: { id: "pub" }, body: { visibility: DatasetVisibility.PUBLIC } })).statusCode, 200);
    assert.equal((await call(dataset.update, external, { params: { id: "priv" }, body })).statusCode, 404);
});

test("remove needs OWNER access", async () => {
    permissions.push({ user_id: "lab", dataset_id: "pub", perm: PermissionOptions.EDIT });
    assert.equal((await call(dataset.remove, lab, { params: { id: "pub" } })).statusCode, 403);
    assert.equal((await call(dataset.remove, external, { params: { id: "priv" } })).statusCode, 404);
});

test("create makes the caller the owner, and only an admin may name another owner, who must be an admin or lab member", async () => {
    const created: Array<Record<string, unknown>> = [];
    mock.method(Datasets, "create", async (fields: Record<string, unknown>) => {
        created.push(fields);
        return row({ id: "new", ...fields });
    });
    const body = { name: "N", url: "n", owner: "ext" };
    // A lab member's "owner" is ignored
    assert.equal((await call(dataset.create, lab, { body })).statusCode, 201);
    assert.equal(created.at(-1)!.owner, "lab");
    // An admin naming an external user is refused
    assert.equal((await call(dataset.create, admin, { body })).statusCode, 400);
    assert.equal((await call(dataset.create, admin, { body: { ...body, owner: "ghost" } })).statusCode, 400);
    assert.equal((await call(dataset.create, admin, { body: { ...body, owner: "owner" } })).statusCode, 201);
    assert.equal(created.at(-1)!.owner, "owner");
    // Only whitelisted fields get through
    await call(dataset.create, lab, { body: { name: "N", url: "n", status: DatasetStatus.READY, id: "x" } });
    assert.equal("status" in created.at(-1)!, false);
});

test("the viewer is 503 when not configured, 404 when not visible and 409 until the plot data is ready", async () => {
    Reflect.deleteProperty(process.env, "SHINY_URL");
    Reflect.deleteProperty(process.env, "SHINY_SECRET");
    assert.equal((await call(dataset.viewer, null, { params: { id: "pub" } })).statusCode, 503);
    process.env.SHINY_URL = "http://shiny";
    process.env.SHINY_SECRET = "s";
    try {
        assert.equal((await call(dataset.viewer, null, { params: { id: "priv" } })).statusCode, 404);
        const notReady = await call(dataset.viewer, null, { params: { id: "busy" } });
        assert.equal(notReady.statusCode, 409);
        assert.equal((notReady.body as { status: string }).status, DatasetStatus.PROCESSING);
        const ok = await call(dataset.viewer, null, { params: { id: "pub" } });
        assert.equal(ok.statusCode, 200);
        assert.match((ok.body as { url: string }).url, /^\/shiny\/pub\/\?.+=.+/);
    } finally {
        Reflect.deleteProperty(process.env, "SHINY_URL");
        Reflect.deleteProperty(process.env, "SHINY_SECRET");
    }
});

test("reprocess needs EDIT access and a data file", async () => {
    assert.equal((await call(dataset.reprocess, lab, { params: { id: "pub" } })).statusCode, 403);
    permissions.push({ user_id: "lab", dataset_id: "pub", perm: PermissionOptions.EDIT });
    const none = await call(dataset.reprocess, lab, { params: { id: "pub" } });
    assert.equal(none.statusCode, 409);
    assert.match((none.body as { error: string }).error, /no data file/);
});

// ---- permissions ----

test("creating a permission needs OWNER access to the dataset", async () => {
    const body = { user_id: "ext", dataset_id: "priv", perm: PermissionOptions.VIEW };
    assert.equal((await call(permission.create, external, { body })).statusCode, 404);
    permissions.push({ user_id: "lab", dataset_id: "pub", perm: PermissionOptions.EDIT });
    assert.equal((await call(permission.create, lab, { body: { ...body, dataset_id: "pub" } })).statusCode, 403);
});

test("creating a permission checks the body and that the level suits the user's role", async () => {
    const make = (body: object, as = owner) => call(permission.create, as, { body });
    assert.equal((await make({ dataset_id: "priv" })).statusCode, 400);
    assert.equal((await make({ user_id: "ext" })).statusCode, 400);
    assert.equal((await make({ user_id: "ghost", dataset_id: "priv" })).statusCode, 400);
    assert.match(((await make({ user_id: "owner", dataset_id: "priv" })).body as { error: string }).error, /owner already/);
    assert.match(((await make({ user_id: "ext", dataset_id: "priv", perm: PermissionOptions.EDIT })).body as { error: string }).error, /External users/);
    assert.match(((await make({ user_id: "lab", dataset_id: "priv", perm: PermissionOptions.VIEW })).body as { error: string }).error, /Lab members/);
    assert.match(((await make({ user_id: "admin", dataset_id: "priv", perm: PermissionOptions.VIEW })).body as { error: string }).error, /Admins/);
    assert.match(((await make({ user_id: "ext", dataset_id: "priv", perm: "ROOT" })).body as { error: string }).error, /valid perm/);
});

test("a missing perm defaults to VIEW, and an admin may share any dataset", async () => {
    const created: Array<Record<string, unknown>> = [];
    mock.method(Permissions, "create", async (fields: Record<string, unknown>) => {
        created.push(fields);
        return row({ ...fields });
    });
    const res = await call(permission.create, admin, { body: { user_id: "ext", dataset_id: "priv", extra: "ignored" } });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(created, [{ user_id: "ext", dataset_id: "priv", perm: PermissionOptions.VIEW }]);
});

test("a user may read their own permission, anyone else needs OWNER access", async () => {
    permissions.push({ user_id: "ext", dataset_id: "pub", perm: PermissionOptions.VIEW });
    assert.equal((await call(permission.get, external, { params: { userId: "ext", datasetId: "pub" } })).statusCode, 200);
    assert.equal((await call(permission.get, external, { params: { userId: "ext", datasetId: "missing" } })).statusCode, 404);
    assert.equal((await call(permission.get, lab, { params: { userId: "ext", datasetId: "pub" } })).statusCode, 403);
    assert.equal((await call(permission.get, owner, { params: { userId: "ext", datasetId: "pub" } })).statusCode, 200);
    assert.equal((await call(permission.get, owner, { params: { userId: "ext", datasetId: "priv" } })).statusCode, 404);
});

test("listing the permissions of a dataset, updating and deleting need OWNER access", async () => {
    const params = { userId: "ext", datasetId: "priv" };
    assert.equal((await call(permission.listByDataset, lab, { params: { datasetId: "priv" } })).statusCode, 403);
    assert.equal((await call(permission.listByDataset, external, { params: { datasetId: "priv" } })).statusCode, 404);
    assert.equal((await call(permission.update, lab, { params, body: { perm: PermissionOptions.VIEW } })).statusCode, 403);
    assert.equal((await call(permission.remove, lab, { params })).statusCode, 403);
    // OWNER, but there is no such permission
    assert.equal((await call(permission.remove, owner, { params })).statusCode, 404);
    assert.equal((await call(permission.update, owner, { params, body: { perm: PermissionOptions.EDIT } })).statusCode, 400);
});

test("list filters come only from string query params", async () => {
    const seen: unknown[] = [];
    mock.method(Permissions, "findAll", async (options: { where: object }) => {
        seen.push(options.where);
        return [];
    });
    await call(permission.list, admin, { query: { user_id: "u", dataset_id: ["a", "b"] } });
    await call(permission.listByUser, admin, { params: { userId: "u2" } });
    assert.deepEqual(seen, [{ user_id: "u" }, { user_id: "u2" }]);
});

// ---- files ----

const cover = { id: "f1", dataset_id: "priv", type: FileTypes.COVER, version: 1, ogName: "c.png", isCurrent: true };
const rds = { id: "f2", dataset_id: "priv", type: FileTypes.RDS, version: 1, ogName: "d.rds", isCurrent: true };

test("a file is only visible to those who can see its dataset, and only editors may change it", async () => {
    files.push(cover);
    assert.equal((await call(file.get, external, { params: { id: "f1" } })).statusCode, 404);
    assert.equal((await call(file.get, null, { params: { id: "missing" } })).statusCode, 404);
    assert.equal((await call(file.get, lab, { params: { id: "f1" } })).statusCode, 200);
    assert.equal((await call(file.update, lab, { params: { id: "f1" }, body: { updates: "x" } })).statusCode, 403);
    assert.equal((await call(file.remove, lab, { params: { id: "f1" } })).statusCode, 403);
});

test("update notes can only be set on RDS files, and must be text", async () => {
    files.push(cover, rds);
    assert.match(((await call(file.update, owner, { params: { id: "f1" }, body: { updates: "x" } })).body as { error: string }).error, /only allowed on RDS/);
    assert.equal((await call(file.update, owner, { params: { id: "f2" }, body: { updates: 5 } })).statusCode, 400);
});

test("listing files needs a dataset the caller can view, else an admin", async () => {
    assert.equal((await call(file.list, null, {})).statusCode, 401);
    assert.equal((await call(file.list, lab, {})).statusCode, 403);
    assert.equal((await call(file.list, external, { query: { dataset_id: "priv" } })).statusCode, 404);
    assert.equal((await call(file.listByDataset, external, { params: { datasetId: "priv" } })).statusCode, 404);
});

test("someone who may only view a dataset sees its cover record but nothing about the data files", async () => {
    files.push(cover, rds, { ...rds, id: "f3", type: FileTypes.TISSUE_PLOT });
    permissions.push({ user_id: "ext", dataset_id: "priv", perm: PermissionOptions.VIEW });
    const ids = (res: { body: unknown }) => (res.body as { id: string }[]).map((f) => f.id);
    for (const [name, res] of [
        ["list", await call(file.list, external, { query: { dataset_id: "priv" } })],
        ["listByDataset", await call(file.listByDataset, external, { params: { datasetId: "priv" } })],
    ] as const) {
        assert.equal(res.statusCode, 200, name);
        assert.deepEqual(ids(res), ["f1"], name);
    }
    assert.equal((await call(file.get, external, { params: { id: "f1" } })).statusCode, 200);
    assert.equal((await call(file.get, external, { params: { id: "f2" } })).statusCode, 403);
    assert.equal((await call(file.get, external, { params: { id: "f3" } })).statusCode, 403);
});

test("a guest on a public dataset is held to the same rule, and downloaders see every file", async () => {
    files.push({ ...cover, dataset_id: "pub" }, { ...rds, dataset_id: "pub" });
    const ids = (res: { body: unknown }) => (res.body as { id: string }[]).map((f) => f.id);
    assert.deepEqual(ids(await call(file.listByDataset, null, { params: { datasetId: "pub" } })), ["f1"]);
    assert.equal((await call(file.get, null, { params: { id: "f2" } })).statusCode, 403);
    // lab members, and externals granted DOWNLOAD, see all of them
    assert.deepEqual(ids(await call(file.listByDataset, lab, { params: { datasetId: "pub" } })), ["f1", "f2"]);
    permissions.push({ user_id: "ext", dataset_id: "pub", perm: PermissionOptions.DOWNLOAD });
    assert.deepEqual(ids(await call(file.list, external, { query: { dataset_id: "pub" } })), ["f1", "f2"]);
    assert.equal((await call(file.get, external, { params: { id: "f2" } })).statusCode, 200);
    // an admin listing every file is unaffected
    assert.equal(((await call(file.list, admin, {})).body as unknown[]).length, 2);
});

test("download tokens need DOWNLOAD access, a known type and an existing file", async () => {
    files.push(rds);
    const params = { datasetId: "priv", type: "rds" };
    assert.equal((await call(file.downloadToken, external, { params })).statusCode, 404);
    assert.equal((await call(file.downloadToken, lab, { params: { datasetId: "priv", type: "zip" } })).statusCode, 400);
    assert.equal((await call(file.downloadToken, lab, { params: { datasetId: "priv", type: "cover" } })).statusCode, 404);
    // A guest can see a public dataset but not download from it
    assert.equal((await call(file.downloadToken, null, { params: { datasetId: "pub", type: "rds" } })).statusCode, 403);
    const ok = await call(file.downloadToken, lab, { params });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(verifyDownloadToken((ok.body as { token: string }).token), { file: "f2", user: "lab" });
});

test("the content route refuses bad types, bad or stale tokens, and deactivated token holders", async () => {
    files.push(rds);
    const params = { datasetId: "priv", type: "rds" };
    assert.equal((await call(file.content, lab, { params: { datasetId: "priv", type: "zip" } })).statusCode, 400);
    assert.equal((await call(file.content, lab, { params, query: { token: "garbage" } })).statusCode, 401);
    // A link made for another file
    const other = signDownloadToken("f-other", "lab");
    assert.equal((await call(file.content, null, { params, query: { token: other } })).statusCode, 404);
    // A link whose holder has since been deactivated, or deleted
    const token = signDownloadToken("f2", "lab");
    users.lab = user("lab", UserRoles.LAB_MEMBER, UserStatus.INACTIVE);
    assert.equal((await call(file.content, null, { params, query: { token } })).statusCode, 401);
    delete users.lab;
    assert.equal((await call(file.content, null, { params, query: { token } })).statusCode, 401);
    // Without a token the caller's own access decides: externals cannot see the private dataset, guests cannot download from a public one
    assert.equal((await call(file.content, external, { params })).statusCode, 404);
    assert.equal((await call(file.content, null, { params: { datasetId: "pub", type: "rds" } })).statusCode, 403);
    // A cover on a public dataset needs only VIEW, so a missing file is a 404 from the file lookup
    assert.equal((await call(file.content, null, { params: { datasetId: "pub", type: "cover" } })).statusCode, 404);
});

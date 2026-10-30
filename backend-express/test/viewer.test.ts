// Unit tests for the viewer ticket/session tokens (services/viewer) and the cookie/URL helpers of middleware/shinyProxy
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {
    authorizeViewer,
    signViewerSession,
    signViewerTicket,
    verifyViewerSession,
    verifyViewerTicket,
} from "@src/services/viewer.ts";
import { signToken, signDownloadToken, verifyToken, verifyDownloadToken } from "@src/services/auth.ts";
import { readCookie, slugFromUrl } from "@src/middleware/shinyProxy.ts";
import { Datasets } from "@src/models/dataset.ts";
import { Users } from "@src/models/user.ts";
import { Permissions } from "@src/models/permission.ts";
import { DatasetStatus, DatasetVisibility } from "@commons/dataset.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";

process.env.JWT_SECRET = "test-secret";

afterEach(() => mock.restoreAll());

test("a ticket is not a session, and a session is not a ticket", () => {
    assert.deepEqual(verifyViewerTicket(signViewerTicket("d1", "u1")), { datasetId: "d1", userId: "u1" });
    assert.equal(verifyViewerSession(signViewerTicket("d1", "u1")), null);
    assert.equal(verifyViewerTicket(signViewerSession("d1", "u1")), null);
});

test("a ticket can be exchanged only once", () => {
    const ticket = signViewerTicket("d1", "u1");
    assert.deepEqual(verifyViewerTicket(ticket), { datasetId: "d1", userId: "u1" });
    assert.equal(verifyViewerTicket(ticket), null);
    // a session token can be checked repeatedly
    const session = signViewerSession("d1", "u1");
    assert.notEqual(verifyViewerSession(session), null);
    assert.notEqual(verifyViewerSession(session), null);
});

test("guest tokens keep user_id null", () => {
    assert.deepEqual(verifyViewerSession(signViewerSession("d1", null)), { datasetId: "d1", userId: null });
});

test("viewer tokens are not login or download tokens", () => {
    assert.equal(verifyToken(signViewerSession("d1", "u1")), null);
    assert.equal(verifyDownloadToken(signViewerSession("d1", "u1")), null);
    // and the other way round
    assert.equal(verifyViewerSession(signToken("u1", "hash")), null);
    assert.equal(verifyViewerSession(signDownloadToken("f1", "u1")), null);
});

test("expired, tampered and wrongly signed tokens are rejected", () => {
    const expired = jwt.sign({ typ: "viewer-session", dataset_id: "d1", user_id: null }, "test-secret", { expiresIn: -10 });
    assert.equal(verifyViewerSession(expired), null);
    const forged = jwt.sign({ typ: "viewer-session", dataset_id: "d1", user_id: null }, "other-secret");
    assert.equal(verifyViewerSession(forged), null);
    assert.equal(verifyViewerSession("not-a-token"), null);
});

test("the ticket lifetime comes from VIEWER_TICKET_EXPIRES_IN", () => {
    process.env.VIEWER_TICKET_EXPIRES_IN = "5s";
    const { exp, iat } = jwt.decode(signViewerTicket("d1", null)) as { exp: number; iat: number };
    delete process.env.VIEWER_TICKET_EXPIRES_IN;
    assert.equal(exp - iat, 5);
});

test("readCookie finds one cookie among several", () => {
    assert.equal(readCookie("a=1; viewer=abc.def; b=2", "viewer"), "abc.def");
    assert.equal(readCookie("xviewer=1", "viewer"), null);
    assert.equal(readCookie(undefined, "viewer"), null);
});

test("slugFromUrl reads and decodes the dataset slug", () => {
    assert.equal(slugFromUrl("/shiny/my-data/?t=x"), "my-data");
    assert.equal(slugFromUrl("/shiny/my%20data/websocket/"), "my data");
    assert.equal(slugFromUrl("/shiny/"), null);
    assert.equal(slugFromUrl("/shiny/%E0%A4%A/"), null);
    assert.equal(slugFromUrl("/api/datasets"), null);
});

// authorizeViewer re-checks the database: stub the lookups
const stub = (dataset: object | null, user: object | null, perm: object | null = null) => {
    mock.method(Datasets, "findOne", async () => dataset);
    mock.method(Users, "findByPk", async () => user);
    mock.method(Permissions, "findOne", async () => perm);
};
const dataset = (visibility: DatasetVisibility, status = DatasetStatus.READY) => ({
    id: "d1",
    visibility,
    owner: "someone",
    plots: [],
    status,
});
const active = { id: "u1", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE };

test("authorizeViewer lets a guest into a public dataset only", async () => {
    stub(dataset(DatasetVisibility.PUBLIC), null);
    assert.ok(await authorizeViewer({ datasetId: "d1", userId: null }, "slug"));
    stub(dataset(DatasetVisibility.PRIVATE), null);
    assert.equal(await authorizeViewer({ datasetId: "d1", userId: null }, "slug"), null);
});

test("authorizeViewer rejects a token issued for another dataset, a missing dataset and a null token", async () => {
    stub(dataset(DatasetVisibility.PUBLIC), null);
    assert.equal(await authorizeViewer({ datasetId: "other", userId: null }, "slug"), null);
    assert.equal(await authorizeViewer(null, "slug"), null);
    stub(null, null);
    assert.equal(await authorizeViewer({ datasetId: "d1", userId: null }, "slug"), null);
});

test("authorizeViewer rejects deleted, inactive and invited users", async () => {
    stub(dataset(DatasetVisibility.PUBLIC), null);
    assert.equal(await authorizeViewer({ datasetId: "d1", userId: "u1" }, "slug"), null);
    for (const status of [UserStatus.INACTIVE, UserStatus.INVITED]) {
        stub(dataset(DatasetVisibility.PUBLIC), { ...active, status });
        assert.equal(await authorizeViewer({ datasetId: "d1", userId: "u1" }, "slug"), null);
    }
});

test("authorizeViewer follows permission changes for a private dataset", async () => {
    stub(dataset(DatasetVisibility.PRIVATE), active);
    assert.equal(await authorizeViewer({ datasetId: "d1", userId: "u1" }, "slug"), null);
    stub(dataset(DatasetVisibility.PRIVATE), active, { perm: "VIEW" });
    const ctx = await authorizeViewer({ datasetId: "d1", userId: "u1" }, "slug");
    assert.equal(ctx?.access, "VIEW");
});

test("the ticket parameter does not collide with Shiny's own ?t=<timestamp> requests", async () => {
    const { VIEWER_TICKET_PARAM } = await import("@src/middleware/shinyProxy.ts");
    assert.notEqual(VIEWER_TICKET_PARAM, "t");
});

test("signShinyContext makes a payload.hmac value Shiny can verify, and without SHINY_SECRET nothing is enabled", async () => {
    const { createHmac } = await import("node:crypto");
    const { signShinyContext, viewerEnabled } = await import("@src/services/viewer.ts");
    delete process.env.SHINY_SECRET;
    assert.equal(viewerEnabled(), false);
    process.env.SHINY_SECRET = "shared";
    process.env.SHINY_URL = "http://shiny:3838";
    assert.equal(viewerEnabled(), true);
    const token = signShinyContext({ dataset: { id: "d1", plots: ["UMAP"] } as never, access: PermissionOptions.VIEW });
    const [payload, sig] = token.split(".") as [string, string];
    assert.equal(sig, createHmac("sha256", "shared").update(payload).digest("hex"));
    const body = JSON.parse(Buffer.from(payload, "base64url").toString());
    assert.deepEqual({ ...body, exp: undefined }, { dataset_id: "d1", plots: ["UMAP"], can_download: false, exp: undefined });
    assert.ok(body.exp > Date.now() / 1000);
    // DOWNLOAD and above may save the charts as images; VIEW may not
    for (const [access, expected] of [
        [PermissionOptions.VIEW, false],
        [PermissionOptions.DOWNLOAD, true],
        [PermissionOptions.EDIT, true],
        ["OWNER", true],
    ] as const) {
        const [p] = signShinyContext({ dataset: { id: "d1" } as never, access }).split(".") as [string];
        assert.equal(JSON.parse(Buffer.from(p, "base64url").toString()).can_download, expected, access);
    }
});

test("authorizeViewer refuses a dataset whose plot data is not READY", async () => {
    for (const status of [DatasetStatus.PROCESSING, DatasetStatus.FAILED]) {
        stub(dataset(DatasetVisibility.PUBLIC, status), null);
        assert.equal(await authorizeViewer({ datasetId: "d1", userId: null }, "slug"), null);
    }
});

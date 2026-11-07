// HTTP tests of the large-memory worker's routes (/api/worker): who may call them, and the whole protocol a worker follows. The real router,
// middleware and services run behind a small Express app; the models are stubbed and the files are real, in a temporary folder
import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetStatus } from "@commons/dataset.ts";
import { createFakeDb } from "./fixtures/fakeRemoteDb.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "worker-routes-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
// Imported after UPLOAD_DIR is set: the storage module reads it when it first loads
const { resetLimits, startWorkerApp } = await import("./fixtures/workerApp.ts");
const remote = await import("@src/services/remoteProcessing.ts");
const storage = await import("@src/services/storage.ts");
const { userFromHeader } = await import("@src/middleware/auth.ts");
const { signToken } = await import("@src/services/auth.ts");

const TOKEN = "w".repeat(48);
const db = createFakeDb();
let app: Awaited<ReturnType<typeof startWorkerApp>>;

before(async () => {
    process.env.JWT_SECRET = "j".repeat(48);
    await storage.ensureDirs();
    app = await startWorkerApp();
});
after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
    db.datasets.clear();
    db.rds.clear();
    db.jobs.clear();
    db.install();
    resetLimits();
    process.env.REMOTE_WORKER_TOKEN = TOKEN;
});
afterEach(() => db.restore());

const call = (method: string, route: string, init: RequestInit & { token?: string | null } = {}) => {
    const { token = TOKEN, ...rest } = init;
    return fetch(`${app.base}/api/worker${route}`, {
        method,
        ...rest,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string>) },
    });
};

// A waiting dataset with a stored RDS file, claimed through the API; returns the job id
const claimJob = async (datasetId = "d1", rdsText = "the rds file") => {
    db.addDataset(datasetId, DatasetStatus.WAITING_FOR_LARGE_MEMORY, 1, rdsText.length);
    await writeFile(storage.storedPath({ dataset_id: datasetId, type: "RDS" as never, version: 1, ogName: "data.rds" }), rdsText);
    await remote.enqueue(datasetId, 1);
    const response = await call("POST", "/claim");
    assert.equal(response.status, 200);
    return Object.fromEntries(
        (await response.text())
            .trim()
            .split("\n")
            .map((line) => line.split("="))
    );
};

test("the routes are off (503) while no worker token is configured", async () => {
    delete process.env.REMOTE_WORKER_TOKEN;
    assert.equal((await call("POST", "/claim")).status, 503);
    assert.equal((await call("POST", "/claim", { token: "anything" })).status, 503);
});

test("every route refuses a missing or wrong token (401), including a user's login token", async () => {
    const userToken = signToken("u1", "salt:hash");
    const routes: [string, string][] = [
        ["POST", "/claim"],
        ["GET", "/jobs/x/rds"],
        ["POST", "/jobs/x/heartbeat"],
        ["PUT", "/jobs/x/files/cells.parquet"],
        ["POST", "/jobs/x/complete"],
        ["POST", "/jobs/x/fail"],
    ];
    for (const [method, route] of routes) {
        for (const token of [null, "wrong", "w".repeat(47), TOKEN + "x", userToken]) {
            resetLimits(); // many failures in a row would be answered 429 (tested below)
            assert.equal((await call(method, route, { token })).status, 401, `${method} ${route} with ${token?.slice(0, 8)}`);
        }
    }
});

test("the worker token is not a user login, and a user's login is not the worker token", async () => {
    // The user routes (middleware/auth) read the same Authorization header: the worker's secret is not a token they accept
    assert.equal(await userFromHeader(`Bearer ${TOKEN}`), null);
    // And the worker routes did not accept the user's token above; nothing here reads the token as a JWT
    assert.equal((await call("POST", "/claim", { token: signToken("u1", "salt:hash") })).status, 401);
});

test("repeated wrong tokens are rate limited (429), and a right token still works for the first failures", async () => {
    for (let i = 0; i < 20; i++) assert.equal((await call("POST", "/claim", { token: "wrong" })).status, 401);
    assert.equal((await call("POST", "/claim", { token: "wrong" })).status, 429);
    assert.equal((await call("POST", "/claim")).status, 429, "the limit is per client, whatever the token");
});

test("claim answers 204 with no job, and plain text lines with one", async () => {
    assert.equal((await call("POST", "/claim")).status, 204);
    const job = await claimJob("d1", "abc");
    assert.match(job.id!, /^[0-9a-f-]{36}$/);
    assert.equal(job.dataset_id, "d1");
    assert.equal(job.size_bytes, "3");
    assert.equal(job.timeout_seconds, String(6 * 60 * 60));
    assert.equal((await call("POST", "/claim")).status, 204, "a claimed job is not handed out again");
});

test("the RDS file is downloaded whole or by range, and only for an active job", async () => {
    const job = await claimJob("d1", "0123456789");
    const whole = await call("GET", `/jobs/${job.id}/rds`);
    assert.equal(whole.status, 200);
    assert.equal(await whole.text(), "0123456789");
    const part = await call("GET", `/jobs/${job.id}/rds`, { headers: { Range: "bytes=4-" } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), "456789");
    assert.equal((await call("GET", "/jobs/not-a-job/rds")).status, 410);
});

test("a heartbeat is accepted for an active job and answered 410 for a dropped one", async () => {
    const job = await claimJob();
    assert.equal((await call("POST", `/jobs/${job.id}/heartbeat`)).status, 204);
    await remote.cancel("d1");
    assert.equal((await call("POST", `/jobs/${job.id}/heartbeat`)).status, 410);
});

test("the whole protocol: upload the files, complete, and the dataset is READY with its Parquet published", async () => {
    const job = await claimJob();
    for (const name of storage.REQUIRED_PARQUET_FILES) {
        const response = await call("PUT", `/jobs/${job.id}/files/${name}`, { body: Buffer.from(`content of ${name}`) });
        assert.equal(response.status, 204, name);
    }
    assert.equal((await call("POST", `/jobs/${job.id}/complete`)).status, 204);
    assert.equal(db.datasets.get("d1")!.status, DatasetStatus.READY);
    assert.equal(await readFile(path.join(storage.parquetPath("d1"), "cells.parquet"), "utf8"), "content of cells.parquet");
    assert.equal((await call("POST", `/jobs/${job.id}/complete`)).status, 410, "a second completion finds the job gone");
});

test("complete answers 409 while files are missing, naming the first one", async () => {
    const job = await claimJob();
    await call("PUT", `/jobs/${job.id}/files/cells.parquet`, { body: Buffer.from("x") });
    const response = await call("POST", `/jobs/${job.id}/complete`);
    assert.equal(response.status, 409);
    assert.match(((await response.json()) as { error: string }).error, /Missing genes\.parquet/);
    assert.equal(db.datasets.get("d1")!.status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
});

test("an upload of an unknown file name is refused (400), and one for a dropped job answers 410", async () => {
    const job = await claimJob();
    assert.equal((await call("PUT", `/jobs/${job.id}/files/evil.parquet`, { body: Buffer.from("x") })).status, 400);
    assert.equal((await call("PUT", `/jobs/${job.id}/files/..%2Fcells.parquet`, { body: Buffer.from("x") })).status, 400);
    await remote.cancel("d1");
    assert.equal((await call("PUT", `/jobs/${job.id}/files/cells.parquet`, { body: Buffer.from("x") })).status, 410);
});

test("an upload without a Content-Length is refused (400)", async () => {
    const job = await claimJob();
    const stream = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode("chunked"));
            controller.close();
        },
    });
    const response = await call("PUT", `/jobs/${job.id}/files/cells.parquet`, { body: stream, duplex: "half" } as RequestInit);
    assert.equal(response.status, 400);
});

test("fail records the worker's message on the dataset, and a repeat finds the job gone", async () => {
    const job = await claimJob();
    const send = () =>
        call("POST", `/jobs/${job.id}/fail`, {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "Error in readRDS(/lab/x/data.rds)" }),
        });
    assert.equal((await send()).status, 204);
    assert.equal(db.datasets.get("d1")!.status, DatasetStatus.FAILED);
    assert.equal(db.datasets.get("d1")!.statusMessage, "Error in readRDS(.../data.rds)");
    assert.equal((await send()).status, 410);
});

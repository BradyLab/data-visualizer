// Tests for where a preprocessing job runs (services/processing + routing): on this server, or on the large-memory worker. Runs a fake script with real
// child processes; the database is stubbed (fixtures/fakeRemoteDb.ts)
import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetStatus } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { createFakeDb } from "./fixtures/fakeRemoteDb.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "routing-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
process.env.PREPROCESS_COMMAND = process.execPath;
process.env.PREPROCESS_SCRIPT = path.join(import.meta.dirname, "fixtures", "fake-preprocess.mjs");
const processing = await import("@src/services/processing.ts");
const storage = await import("@src/services/storage.ts");

const GB = 1024 ** 3;
const db = createFakeDb();
const realFetch = globalThis.fetch;
const realNodeEnv = process.env.NODE_ENV;
const SETTINGS = [
    "PREPROCESS_MODE",
    "PREPROCESS_LOCAL_MEMORY",
    "PREPROCESS_MEMORY_RATIO",
    "REMOTE_WORKER_TOKEN",
    "NOTIFY_EMAIL_TO",
    "EMAILJS_SERVICE_ID",
    "EMAILJS_NOTIFY_TEMPLATE_ID",
    "EMAILJS_PUBLIC_KEY",
    "EMAILJS_PRIVATE_KEY",
];

before(() => storage.ensureDirs());
after(() => rm(root, { recursive: true, force: true }));
beforeEach(() => {
    db.datasets.clear();
    db.rds.clear();
    db.jobs.clear();
    db.install();
    for (const name of SETTINGS) delete process.env[name];
    process.env.REMOTE_WORKER_TOKEN = "r".repeat(40);
});
afterEach(() => {
    db.restore();
    globalThis.fetch = realFetch;
    process.env.NODE_ENV = realNodeEnv;
});

// A dataset that was just uploaded: its RDS file holds `mode` (what the fake script does) and claims to be `sizeBytes` big
const upload = async (id: string, mode: string, sizeBytes = 1000, version = 1) => {
    db.addDataset(id, DatasetStatus.PROCESSING, version, sizeBytes);
    await writeFile(storage.storedPath({ dataset_id: id, type: FileTypes.RDS, version, ogName: "data.rds" }), mode);
};

// Resolves when the dataset has left PROCESSING and nothing is running for it
const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
        if (db.datasets.get(id)!.status !== DatasetStatus.PROCESSING && !processing.isBusy(id)) return db.datasets.get(id)!;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timed out waiting for processing");
};

test("in local mode every job runs here, however big the file is", async () => {
    await upload("a1", "ok", 100 * GB);
    await processing.start("a1");
    assert.equal((await settled("a1")).status, DatasetStatus.READY);
    assert.equal(db.jobs.size, 0);
});

test("in remote mode the job is queued for the large-memory worker and nothing runs here", async () => {
    process.env.PREPROCESS_MODE = "remote";
    await upload("b1", "ok", 1000, 3);
    await processing.start("b1");
    const dataset = await settled("b1");
    assert.equal(dataset.status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    assert.equal(dataset.statusMessage, null);
    assert.equal(await storage.hasParquet("b1"), false, "the script must not have run here");
    const jobs = [...db.jobs.values()];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.dataset_id, "b1");
    assert.equal(jobs[0]!.file_version, 3, "the job is for the file that was uploaded");
});

test("in auto mode a file whose estimated memory exceeds the budget goes to the worker, and a smaller one runs here", async () => {
    process.env.PREPROCESS_MODE = "auto";
    process.env.PREPROCESS_LOCAL_MEMORY = "20g";
    process.env.PREPROCESS_MEMORY_RATIO = "4";
    await upload("c1", "ok", 6 * GB); // 24 GB estimated
    await upload("c2", "ok", 5 * GB); // 20 GB: fits
    await processing.start("c1");
    await processing.start("c2");
    assert.equal((await settled("c1")).status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    assert.equal((await settled("c2")).status, DatasetStatus.READY);
    assert.deepEqual(
        [...db.jobs.values()].map((j) => j.dataset_id),
        ["c1"]
    );
});

test("in auto mode a job killed for lack of memory (SIGKILL), or failing with R's allocation error, is sent to the worker", async () => {
    process.env.PREPROCESS_MODE = "auto";
    process.env.PREPROCESS_LOCAL_MEMORY = "200g"; // the size check lets them start
    await upload("d1", "oom");
    await upload("d2", "alloc");
    await processing.start("d1");
    await processing.start("d2");
    assert.equal((await settled("d1")).status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    assert.equal((await settled("d2")).status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    assert.equal(db.jobs.size, 2);
});

test("in auto mode any other failure is still a failure, not a retry on the worker", async () => {
    process.env.PREPROCESS_MODE = "auto";
    process.env.PREPROCESS_LOCAL_MEMORY = "200g";
    await upload("e1", "fail");
    await processing.start("e1");
    const dataset = await settled("e1");
    assert.equal(dataset.status, DatasetStatus.FAILED);
    assert.match(dataset.statusMessage!, /unknown input format/);
    assert.equal(db.jobs.size, 0);
});

test("out of memory is a failure in local mode, and without a worker token nothing is sent away", async () => {
    await upload("f1", "oom");
    await processing.start("f1");
    assert.equal((await settled("f1")).status, DatasetStatus.FAILED);
    // Auto mode, but the worker is not configured: the same, and a huge file is simply tried here
    process.env.PREPROCESS_MODE = "auto";
    delete process.env.REMOTE_WORKER_TOKEN;
    await upload("f2", "oom", 500 * GB);
    await processing.start("f2");
    assert.equal((await settled("f2")).status, DatasetStatus.FAILED);
    assert.equal(db.jobs.size, 0);
});

test("a new upload or a retry replaces the dataset's job; deleting the dataset drops it", async () => {
    process.env.PREPROCESS_MODE = "remote";
    await upload("g1", "ok", 1000, 1);
    await processing.start("g1");
    await settled("g1");
    const first = [...db.jobs.values()][0]!;
    // A re-upload: version 2 is now the current file
    await upload("g1", "ok", 1000, 2);
    await processing.start("g1");
    await settled("g1");
    assert.equal(db.jobs.size, 1);
    const second = [...db.jobs.values()][0]!;
    assert.notEqual(second.id, first.id);
    assert.equal(second.file_version, 2);
    processing.cancel("g1");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(db.jobs.size, 0);
});

test("the lab is emailed when a dataset starts waiting for the worker", async () => {
    process.env.NODE_ENV = "development"; // NODE_ENV=test switches email off
    Object.assign(process.env, {
        PREPROCESS_MODE: "remote",
        NOTIFY_EMAIL_TO: "lab@example.org, boss@example.org",
        EMAILJS_SERVICE_ID: "svc",
        EMAILJS_NOTIFY_TEMPLATE_ID: "notice-template",
        EMAILJS_PUBLIC_KEY: "pub",
        EMAILJS_PRIVATE_KEY: "priv",
    });
    const sent: { template_id: string; template_params: { to_email: string; subject: string; message: string } }[] = [];
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
        sent.push(JSON.parse(init.body));
        return new Response("OK");
    }) as unknown as typeof fetch;
    await upload("h1", "ok", 25 * GB);
    await processing.start("h1");
    await settled("h1");
    await new Promise((r) => setTimeout(r, 100)); // the notice is sent without being awaited
    assert.deepEqual(
        sent.map((m) => m.template_params.to_email),
        ["lab@example.org", "boss@example.org"]
    );
    assert.equal(sent[0]!.template_id, "notice-template");
    assert.match(sent[0]!.template_params.subject, /waiting for the large-memory worker/);
    assert.match(sent[0]!.template_params.message, /Dataset h1/);
    assert.match(sent[0]!.template_params.message, /25\.0 GB/);
});

test("a notice that cannot be sent does not stop the dataset from waiting for the worker", async () => {
    process.env.NODE_ENV = "development";
    Object.assign(process.env, {
        PREPROCESS_MODE: "remote",
        NOTIFY_EMAIL_TO: "lab@example.org",
        EMAILJS_SERVICE_ID: "svc",
        EMAILJS_NOTIFY_TEMPLATE_ID: "notice-template",
        EMAILJS_PUBLIC_KEY: "pub",
        EMAILJS_PRIVATE_KEY: "priv",
    });
    globalThis.fetch = (async () => {
        throw new Error("network down");
    }) as typeof fetch;
    await upload("i1", "ok");
    await processing.start("i1");
    assert.equal((await settled("i1")).status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
});

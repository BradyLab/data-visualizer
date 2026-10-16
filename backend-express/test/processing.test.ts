// Tests for the preprocessing queue (services/processing): runs a fake script with real child processes; database lookups are stubbed
import { test, before, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetStatus, DatasetVisibility } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "processing-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
process.env.PREPROCESS_COMMAND = process.execPath;
process.env.PREPROCESS_SCRIPT = path.join(import.meta.dirname, "fixtures", "fake-preprocess.mjs");
const processing = await import("@src/services/processing.ts");
const storage = await import("@src/services/storage.ts");
const { Datasets } = await import("@src/models/dataset.ts");
const { Files } = await import("@src/models/file.ts");
const { Users } = await import("@src/models/user.ts");

const exists = (p: string) =>
    stat(p).then(
        () => true,
        () => false
    );

// In-memory stand-ins for the database rows: datasets by id, and the current RDS version per dataset
let datasets: Map<
    string,
    { id: string; owner: string; visibility: DatasetVisibility; status: DatasetStatus; statusMessage: string | null }
>;
let rdsVersion: Map<string, number>;

const addDataset = async (id: string, mode: string, version = 1) => {
    datasets.set(id, {
        id,
        owner: "o",
        visibility: DatasetVisibility.PRIVATE,
        status: DatasetStatus.PROCESSING,
        statusMessage: null,
    });
    rdsVersion.set(id, version);
    await writeFile(storage.storedPath({ dataset_id: id, type: FileTypes.RDS, version, ogName: "x.rds" }), mode);
};

// Resolves when the dataset leaves PROCESSING
const settled = async (id: string) => {
    for (let i = 0; i < 200; i++) {
        if (datasets.get(id)!.status !== DatasetStatus.PROCESSING && !processing.isBusy(id)) return datasets.get(id)!;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("timed out waiting for processing");
};

before(async () => {
    await storage.ensureDirs();
});
after(() => rm(root, { recursive: true, force: true }));

beforeEach(() => {
    datasets = new Map();
    rdsVersion = new Map();
    mock.method(Datasets, "findByPk", async (id: string) => {
        const d = datasets.get(id);
        return d && { ...d, update: async (fields: object) => Object.assign(d, fields), get: () => ({ ...d }) };
    });
    mock.method(Datasets, "findAll", async () => [...datasets.values()].filter((d) => d.status === DatasetStatus.PROCESSING));
    mock.method(Users, "findAll", async () => []);
    mock.method(Files, "findOne", async ({ where }: { where: { dataset_id: string } }) => {
        const version = rdsVersion.get(where.dataset_id);
        return version === undefined ? null : { dataset_id: where.dataset_id, type: FileTypes.RDS, version, ogName: "x.rds" };
    });
});
afterEach(() => mock.restoreAll());

test("a successful job publishes the Parquet folder and marks the dataset READY", async () => {
    await addDataset("a1", "ok");
    await processing.start("a1");
    const d = await settled("a1");
    assert.equal(d.status, DatasetStatus.READY);
    assert.equal(d.statusMessage, null);
    assert.equal(await storage.hasParquet("a1"), true);
});

test("a failing job marks the dataset FAILED with the end of the error output and keeps existing Parquet files", async () => {
    await addDataset("b1", "fail");
    const existing = storage.parquetPath("b1");
    await mkdir(existing, { recursive: true });
    await writeFile(path.join(existing, "cells.parquet"), "earlier output");
    await mkdir(`${existing}.tmp`);
    await processing.start("b1");
    const d = await settled("b1");
    assert.equal(d.status, DatasetStatus.FAILED);
    assert.match(d.statusMessage!, /unknown input format/);
    assert.equal(await storage.hasParquet("b1"), true);
    assert.equal(await exists(`${existing}.tmp`), false);
});

test("a missing program is reported on the dataset, not thrown", async () => {
    process.env.PREPROCESS_COMMAND = "definitely-not-installed-rscript";
    try {
        await addDataset("c1", "ok");
        await processing.start("c1");
        const d = await settled("c1");
        assert.equal(d.status, DatasetStatus.FAILED);
        assert.match(d.statusMessage!, /Could not run/);
    } finally {
        process.env.PREPROCESS_COMMAND = process.execPath;
    }
});

test("jobs run one at a time and a dataset is queued only once", async () => {
    await addDataset("d1", "ok");
    await addDataset("d2", "ok");
    processing.enqueue("d1");
    processing.enqueue("d1");
    processing.enqueue("d2");
    assert.equal(processing.isBusy("d1"), true);
    assert.equal((await settled("d1")).status, DatasetStatus.READY);
    assert.equal((await settled("d2")).status, DatasetStatus.READY);
});

test("a re-upload during a running job stops it and the new file is processed", async () => {
    await addDataset("e1", "slow", 1);
    await processing.start("e1");
    await new Promise((r) => setTimeout(r, 300)); // let the slow job start
    await addDataset("e1", "ok", 2);
    await processing.start("e1");
    const d = await settled("e1");
    assert.equal(d.status, DatasetStatus.READY);
});

test("the result of a job for a replaced RDS is discarded", async () => {
    await addDataset("f1", "ok", 1);
    processing.enqueue("f1");
    rdsVersion.set("f1", 2); // replaced before the job finished, and nobody queued the new one
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(datasets.get("f1")!.status, DatasetStatus.PROCESSING);
});

test("cancel drops a queued job and a deleted dataset's output is removed", async () => {
    await addDataset("g1", "slow");
    await addDataset("g2", "ok");
    processing.enqueue("g1");
    processing.enqueue("g2");
    processing.cancel("g2");
    processing.cancel("g1"); // running, so it is killed
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(processing.isBusy("g1"), false);
    assert.equal(processing.isBusy("g2"), false);
    assert.equal(datasets.get("g2")!.status, DatasetStatus.PROCESSING);
});

test("resume queues PROCESSING datasets that have a data file", async () => {
    await addDataset("h1", "ok");
    datasets.set("h2", {
        id: "h2",
        owner: "o",
        visibility: DatasetVisibility.PRIVATE,
        status: DatasetStatus.PROCESSING,
        statusMessage: null,
    }); // no file yet
    await processing.resume();
    assert.equal((await settled("h1")).status, DatasetStatus.READY);
    assert.equal(datasets.get("h2")!.status, DatasetStatus.PROCESSING);
    assert.equal(await storage.hasParquet("h1"), true);
    assert.equal(await storage.hasParquet("h2"), false);
});

// ---- spool mode: the backend hands jobs to shiny/preprocess/worker.sh through a shared folder ----

const workerScript = path.resolve(import.meta.dirname, "../../shiny/preprocess/worker.sh");
const spool = path.join(root, "jobs");
let worker: ReturnType<typeof spawn> | null = null;

const startWorker = () => {
    worker = spawn("sh", [workerScript], {
        env: {
            PATH: process.env.PATH,
            SPOOL_DIR: spool,
            RSCRIPT: process.execPath,
            PREPROCESS_SCRIPT: process.env.PREPROCESS_SCRIPT,
            UPLOAD_DIR: storage.UPLOAD_DIR,
            PARQUET_DIR: storage.PARQUET_DIR,
        } as unknown as NodeJS.ProcessEnv,
        stdio: "ignore",
    });
};
const stopWorker = () => {
    worker?.kill("SIGKILL");
    worker = null;
};

test("spool mode: a worker runs the job and the dataset becomes READY", async () => {
    process.env.PREPROCESS_SPOOL_DIR = spool;
    process.env.PREPROCESS_POLL_MS = "50";
    startWorker();
    try {
        await addDataset("s1", "ok");
        await processing.start("s1");
        assert.equal((await settled("s1")).status, DatasetStatus.READY);
        assert.equal(await storage.hasParquet("s1"), true);
        await addDataset("s2", "fail");
        await processing.start("s2");
        const failed = await settled("s2");
        assert.equal(failed.status, DatasetStatus.FAILED);
        assert.match(failed.statusMessage!, /unknown input format/);
    } finally {
        stopWorker();
        delete process.env.PREPROCESS_SPOOL_DIR;
    }
});

test("spool mode: without a worker the dataset fails with a hint instead of waiting forever", async () => {
    process.env.PREPROCESS_SPOOL_DIR = spool;
    process.env.PREPROCESS_PICKUP_TIMEOUT_MS = "300";
    try {
        await addDataset("s3", "ok");
        await processing.start("s3");
        const d = await settled("s3");
        assert.equal(d.status, DatasetStatus.FAILED);
        assert.match(d.statusMessage!, /No preprocessing worker/);
        assert.deepEqual(await readdir(path.join(spool, "pending")), []); // the withdrawn job must not run later
    } finally {
        delete process.env.PREPROCESS_SPOOL_DIR;
        delete process.env.PREPROCESS_PICKUP_TIMEOUT_MS;
    }
});

test("spool mode: a re-upload cancels the running job on the worker", async () => {
    process.env.PREPROCESS_SPOOL_DIR = spool;
    startWorker();
    try {
        await addDataset("s4", "slow", 1);
        await processing.start("s4");
        await new Promise((r) => setTimeout(r, 2500)); // let the worker start the slow job
        await addDataset("s4", "ok", 2);
        await processing.start("s4");
        assert.equal((await settled("s4")).status, DatasetStatus.READY);
    } finally {
        stopWorker();
        delete process.env.PREPROCESS_SPOOL_DIR;
    }
});

test("worker.sh refuses paths outside the upload and parquet folders", async () => {
    process.env.PREPROCESS_SPOOL_DIR = spool;
    startWorker();
    try {
        const { runSpooled } = await import("@src/services/processingSpool.ts");
        const result = await runSpooled(spool, { stopped: false }, "/etc/passwd", path.join(storage.PARQUET_DIR, "x"), 60000);
        assert.equal(result.ok, false);
        assert.match(result.message, /Rejected input path/);
        const traversal = await runSpooled(
            spool,
            { stopped: false },
            `${storage.UPLOAD_DIR}/rds/../../x.rds`,
            path.join(storage.PARQUET_DIR, "x"),
            60000
        );
        assert.match(traversal.message, /Rejected input path/);
        const nested = await runSpooled(
            spool,
            { stopped: false },
            `${storage.UPLOAD_DIR}/rds/a.rds`,
            path.join(storage.PARQUET_DIR, "x", "y"),
            60000
        );
        assert.match(nested.message, /Rejected output path/);
    } finally {
        stopWorker();
        delete process.env.PREPROCESS_SPOOL_DIR;
    }
});

test("redactPaths cuts absolute paths down to their last part and leaves the rest of the message", () => {
    assert.equal(
        processing.redactPaths("Error: cannot open '/data/uploads/rds/abc_RDS_v1.rds': No such file (also /data/parquet/abc.tmp)"),
        "Error: cannot open '.../abc_RDS_v1.rds': No such file (also .../abc.tmp)"
    );
    assert.equal(processing.redactPaths("took 3/4 of the time, see /tmp"), "took 3/4 of the time, see /tmp");
});

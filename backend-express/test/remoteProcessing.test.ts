// Tests for services/remoteProcessing: the queue of datasets waiting for the large-memory worker, claims and leases, and receiving the
// worker's Parquet files. The database is stubbed (fixtures/fakeRemoteDb.ts); the files are real, in a temporary folder
import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { DatasetStatus } from "@commons/dataset.ts";
import { createFakeDb } from "./fixtures/fakeRemoteDb.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "remote-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
const remote = await import("@src/services/remoteProcessing.ts");
const storage = await import("@src/services/storage.ts");

const exists = (p: string) =>
    stat(p).then(
        () => true,
        () => false
    );
const db = createFakeDb();

before(() => storage.ensureDirs());
after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
    // Every test starts with no published or half-built Parquet
    await rm(storage.PARQUET_DIR, { recursive: true, force: true });
    await storage.ensureDirs();
    db.datasets.clear();
    db.rds.clear();
    db.jobs.clear();
    db.install();
    process.env.REMOTE_WORKER_TOKEN = "t".repeat(40);
    delete process.env.REMOTE_LEASE_MS;
    delete process.env.REMOTE_UPLOAD_MAX_BYTES;
});
afterEach(() => db.restore());

// A claimed job for a new dataset, ready for uploads
const claimed = async (id = "d1") => {
    db.addDataset(id);
    await remote.enqueue(id, 1);
    const claim = await remote.claimNext();
    assert.ok(claim, "nothing to claim");
    return claim;
};
const body = (text: string) => Readable.from([Buffer.from(text)]);

test("enabled follows REMOTE_WORKER_TOKEN", () => {
    assert.equal(remote.enabled(), true);
    delete process.env.REMOTE_WORKER_TOKEN;
    assert.equal(remote.enabled(), false);
    process.env.REMOTE_WORKER_TOKEN = "";
    assert.equal(remote.enabled(), false);
});

test("enqueue replaces an earlier job of the same dataset and clears half-built output", async () => {
    db.addDataset("a1");
    await remote.enqueue("a1", 1);
    await mkdir(storage.parquetTmpPath("a1"), { recursive: true });
    await remote.enqueue("a1", 2);
    assert.equal(db.jobs.size, 1);
    assert.equal([...db.jobs.values()][0]!.file_version, 2);
    assert.equal(await exists(storage.parquetTmpPath("a1")), false);
    assert.equal(await remote.hasJob("a1"), true);
});

test("claimNext hands out the oldest waiting job once, under a new id, and answers null when there is none", async () => {
    db.addDataset("a1");
    db.addDataset("a2");
    const older = db.addJob("a1", 1, new Date(Date.now() - 5000));
    const originalId = older.id; // the stub changes the job in place when it is claimed
    db.addJob("a2", 1, new Date());
    const first = await remote.claimNext();
    assert.equal(first?.datasetId, "a1");
    assert.notEqual(first?.id, originalId, "the claim must get a fresh id");
    assert.equal(first?.sizeBytes, 1000);
    const second = await remote.claimNext();
    assert.equal(second?.datasetId, "a2");
    assert.equal(await remote.claimNext(), null);
});

test("claimNext drops jobs whose dataset changed and moves on to the next", async () => {
    db.addDataset("gone", DatasetStatus.PROCESSING); // no longer waiting (e.g. retried locally)
    db.addJob("gone", 1, new Date(Date.now() - 9000));
    db.addDataset("old", DatasetStatus.WAITING_FOR_LARGE_MEMORY, 2); // re-uploaded: the job is for version 1
    db.addJob("old", 1, new Date(Date.now() - 8000));
    db.addDataset("good");
    db.addJob("good", 1, new Date());
    const claim = await remote.claimNext();
    assert.equal(claim?.datasetId, "good");
    assert.equal(db.jobs.size, 1, "the two stale jobs are removed");
});

test("a claim whose heartbeat is older than the lease can be claimed again, and the first worker is told the job is gone", async () => {
    process.env.REMOTE_LEASE_MS = "1000";
    const first = await claimed("a1");
    const job = [...db.jobs.values()][0]!;
    job.heartbeatAt = new Date(Date.now() - 5000);
    assert.equal(await remote.claimNext().then((c) => c?.id === first.id), false, "claimed again, under a new id");
    assert.equal(await remote.heartbeat(first.id), false, "the old claim is gone");
});

test("a fresh heartbeat keeps the claim", async () => {
    process.env.REMOTE_LEASE_MS = "1000";
    const claim = await claimed("a1");
    assert.equal(await remote.heartbeat(claim.id), true);
    assert.equal(await remote.claimNext(), null);
});

test("find, heartbeat and the rest refuse unknown ids, unclaimed jobs, and jobs whose dataset changed", async () => {
    assert.equal(await remote.find("nope"), null);
    const claim = await claimed("b1");
    db.addDataset("a1");
    const unclaimed = db.addJob("a1", 1);
    assert.equal(await remote.find(unclaimed.id), null, "not claimed yet");
    assert.ok(await remote.find(claim.id));
    db.rds.set("b1", { version: 2, sizeBytes: 1, ogName: "x.rds" }); // a newer upload replaced the file
    assert.equal(await remote.find(claim.id), null);
    assert.equal(db.jobs.has(claim.id), false, "an out-of-date job is removed when found out");
});

test("cancel drops the job and what was uploaded; with no worker configured it does nothing", async () => {
    const claim = await claimed("a1");
    await mkdir(storage.parquetTmpPath("a1"), { recursive: true });
    await remote.cancel("a1");
    assert.equal(await remote.find(claim.id), null);
    assert.equal(await exists(storage.parquetTmpPath("a1")), false);
    db.addDataset("a2");
    db.addJob("a2");
    delete process.env.REMOTE_WORKER_TOKEN;
    await remote.cancel("a2");
    assert.equal(await remote.hasJob("a2"), true);
});

test("receiveFile stores a whole file under its name and nothing partial is left", async () => {
    const claim = await claimed("a1");
    assert.equal(await remote.receiveFile(claim.id, "cells.parquet", body("hello"), 5), 5);
    const dir = storage.parquetTmpPath("a1");
    assert.equal(await readFile(path.join(dir, "cells.parquet"), "utf8"), "hello");
    assert.deepEqual(await readdir(dir), ["cells.parquet"]);
    // Sending it again replaces it
    await remote.receiveFile(claim.id, "cells.parquet", body("hello!"), 6);
    assert.equal(await readFile(path.join(dir, "cells.parquet"), "utf8"), "hello!");
});

test("receiveFile refuses names that are not Parquet files of a dataset, so a name can never be a path", async () => {
    const claim = await claimed("a1");
    for (const name of ["../x.parquet", "x.parquet", "cells.parquet.part", "cells", "..", "a/b", "cells.parquet/../../x", ""])
        await assert.rejects(
            remote.receiveFile(claim.id, name, body("x"), 1),
            (e: InstanceType<typeof remote.UploadError>) => e.status === 400
        );
    assert.equal(await exists(storage.parquetTmpPath("a1")), false, "nothing was written");
});

test("receiveFile checks the announced size: a missing or invalid length, a too long or too short body, and a file over the limit", async () => {
    const claim = await claimed("a1");
    const status = (promise: Promise<unknown>) =>
        promise.then(
            () => 0,
            (e: InstanceType<typeof remote.UploadError>) => e.status
        );
    assert.equal(await status(remote.receiveFile(claim.id, "cells.parquet", body("x"), NaN)), 400);
    assert.equal(await status(remote.receiveFile(claim.id, "cells.parquet", body("x"), -1)), 400);
    assert.equal(await status(remote.receiveFile(claim.id, "cells.parquet", body("12345"), 3)), 400, "longer than announced");
    assert.equal(await status(remote.receiveFile(claim.id, "cells.parquet", body("12"), 5)), 400, "ended early");
    process.env.REMOTE_UPLOAD_MAX_BYTES = "10";
    assert.equal(await status(remote.receiveFile(claim.id, "cells.parquet", body("x"), 11)), 413);
    const dir = storage.parquetTmpPath("a1");
    assert.deepEqual(await readdir(dir).catch(() => []), [], "no partial file is left behind");
});

test("receiveFile refuses a job that is gone", async () => {
    await assert.rejects(
        remote.receiveFile("nope", "cells.parquet", body("x"), 1),
        (e: InstanceType<typeof remote.UploadError>) => e.status === 410
    );
});

const uploadAll = async (id: string, names: readonly string[]) => {
    for (const name of names) await remote.receiveFile(id, name, body(`data of ${name}`), `data of ${name}`.length);
};

test("complete refuses while a required file is missing, then publishes the folder and marks the dataset READY", async () => {
    const claim = await claimed("a1");
    await uploadAll(claim.id, ["cells.parquet", "genes.parquet", "expression.parquet"]);
    assert.equal(await remote.complete(claim.id), "Missing column_levels.parquet");
    assert.equal(db.datasets.get("a1")!.status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    await uploadAll(claim.id, ["column_levels.parquet"]);
    assert.equal(await remote.complete(claim.id), null);
    assert.equal(db.datasets.get("a1")!.status, DatasetStatus.READY);
    assert.equal(await storage.hasParquet("a1"), true);
    assert.equal(await exists(storage.parquetTmpPath("a1")), false);
    assert.equal(await readFile(path.join(storage.parquetPath("a1"), "genes.parquet"), "utf8"), "data of genes.parquet");
    assert.equal(db.jobs.size, 0);
});

test("complete replaces an earlier published folder as a whole, leaving nothing of the old one", async () => {
    const claim = await claimed("a1");
    await mkdir(storage.parquetPath("a1"), { recursive: true });
    await writeFile(path.join(storage.parquetPath("a1"), "scale_data.parquet"), "from the earlier run");
    await uploadAll(claim.id, storage.REQUIRED_PARQUET_FILES);
    assert.equal(await remote.complete(claim.id), null);
    assert.deepEqual((await readdir(storage.parquetPath("a1"))).sort(), [...storage.REQUIRED_PARQUET_FILES].sort());
    assert.equal(await exists(`${storage.parquetPath("a1")}.old`), false);
});

test("complete answers gone when the job was dropped meanwhile, and publishes nothing", async () => {
    const claim = await claimed("a1");
    await uploadAll(claim.id, storage.REQUIRED_PARQUET_FILES);
    await remote.cancel("a1");
    assert.equal(await remote.complete(claim.id), "gone");
    assert.equal(await storage.hasParquet("a1"), false);
});

test("fail marks the dataset FAILED with the message, paths cut down and the length capped, and drops the job", async () => {
    const claim = await claimed("a1");
    await mkdir(storage.parquetTmpPath("a1"), { recursive: true });
    assert.equal(await remote.fail(claim.id, `Error reading /home/lab/secret/data.rds: ${"x".repeat(600)}`), true);
    const d = db.datasets.get("a1")!;
    assert.equal(d.status, DatasetStatus.FAILED);
    assert.match(d.statusMessage!, /^Error reading \.\.\.\/data\.rds: x+$/);
    assert.ok(d.statusMessage!.length <= 500);
    assert.equal(db.jobs.size, 0);
    assert.equal(await exists(storage.parquetTmpPath("a1")), false);
    assert.equal(await remote.fail(claim.id, "again"), false, "a second report finds the job gone");
});

test("fail with an empty message still gives the dataset a reason", async () => {
    const claim = await claimed("a1");
    await remote.fail(claim.id, "");
    assert.match(db.datasets.get("a1")!.statusMessage!, /large-memory worker/);
});

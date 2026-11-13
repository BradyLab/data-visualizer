// Runs the real shiny/preprocess/cluster/cluster-worker.sh (bash and curl) against the real /api/worker routes, with a fake Apptainer in place of the
// preprocess container. Checks the protocol from the worker's side: claim, download, process, upload, complete or fail, and stopping when the
// app drops the job. Needs bash, curl and timeout, as the worker itself does
import { test, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatasetStatus } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { createFakeDb } from "./fixtures/fakeRemoteDb.ts";

const root = await mkdtemp(path.join(os.tmpdir(), "cluster-worker-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
// Imported after UPLOAD_DIR is set: the storage module reads it when it first loads
const { resetLimits, startWorkerApp } = await import("./fixtures/workerApp.ts");
const remote = await import("@src/services/remoteProcessing.ts");
const storage = await import("@src/services/storage.ts");

const script = path.resolve(import.meta.dirname, "../../shiny/preprocess/cluster/cluster-worker.sh");
const fakeApptainer = path.resolve(import.meta.dirname, "fixtures/fake-apptainer.mjs");
const TOKEN = "c".repeat(48);
const db = createFakeDb();
let app: Awaited<ReturnType<typeof startWorkerApp>>;
let tokenFile: string;
let workDir: string;

before(async () => {
    await storage.ensureDirs();
    app = await startWorkerApp();
    tokenFile = path.join(root, "token");
    await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
});
after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
    db.datasets.clear();
    db.rds.clear();
    db.jobs.clear();
    db.install();
    resetLimits();
    process.env.REMOTE_WORKER_TOKEN = TOKEN;
    workDir = path.join(root, `work-${Math.random().toString(36).slice(2)}`);
});
afterEach(() => db.restore());

// A dataset waiting for the worker whose RDS file contains `mode` (what the fake Apptainer does with it)
const waitingDataset = async (id: string, mode: string) => {
    db.addDataset(id, DatasetStatus.WAITING_FOR_LARGE_MEMORY, 1, mode.length);
    await writeFile(storage.storedPath({ dataset_id: id, type: FileTypes.RDS, version: 1, ogName: "data.rds" }), mode);
    await remote.enqueue(id, 1);
};

// Runs the worker script until it exits; resolves with its exit code and output
const runWorker = (extra: Record<string, string> = {}, whileRunning?: () => Promise<void>) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn("bash", [script], {
            env: {
                PATH: process.env.PATH,
                APP_URL: app.base,
                WORKER_TOKEN_FILE: tokenFile,
                PREPROCESS_IMAGE: "fake.sif",
                APPTAINER: fakeApptainer,
                WORK_DIR: workDir,
                IDLE_EXIT_SECONDS: "0",
                POLL_SECONDS: "1",
                HEARTBEAT_SECONDS: "1",
                ...extra,
            } as unknown as NodeJS.ProcessEnv,
        });
        let output = "";
        child.stdout.on("data", (d) => (output += d));
        child.stderr.on("data", (d) => (output += d));
        const killer = setTimeout(() => child.kill("SIGKILL"), 60_000);
        child.on("error", reject);
        child.on("close", (code) => {
            clearTimeout(killer);
            resolve({ code, output });
        });
        whileRunning?.().catch(reject);
    });

// Dataset ids are UUIDs, and the worker refuses anything else (the id becomes part of a path)
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [D1, A1, A2, F1, O1, W1, S1, G1] = [1, 2, 3, 4, 5, 6, 7, 8].map(uuid) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
];

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the worker processes a waiting dataset: the dataset is READY, its Parquet is published, and the scratch folder is cleaned up", async () => {
    await waitingDataset(D1, "ok");
    const { code, output } = await runWorker();
    assert.equal(code, 0, output);
    assert.equal(db.datasets.get(D1)!.status, DatasetStatus.READY, output);
    for (const name of storage.PARQUET_FILES)
        assert.equal(
            await readFile(path.join(storage.parquetPath(D1), name), "utf8"),
            `${name.replace(".parquet", "")} made from ok`
        );
    assert.equal(db.jobs.size, 0);
    assert.deepEqual(await readdir(workDir), [], "nothing is left in the worker's scratch folder");
    assert.match(output, new RegExp(`Dataset ${D1} is ready`));
});

test("the worker takes the waiting datasets one after another and stops when there is no more", async () => {
    await waitingDataset(A1, "ok");
    await waitingDataset(A2, "ok");
    const { code, output } = await runWorker();
    assert.equal(code, 0, output);
    assert.equal(db.datasets.get(A1)!.status, DatasetStatus.READY);
    assert.equal(db.datasets.get(A2)!.status, DatasetStatus.READY);
});

test("with nothing to do the worker stops at once (IDLE_EXIT_SECONDS=0)", async () => {
    const { code, output } = await runWorker();
    assert.equal(code, 0, output);
    assert.match(output, /Nothing to do/);
});

test("a failing job is reported: the dataset is FAILED with the end of R's output", async () => {
    await waitingDataset(F1, "fail");
    const { code, output } = await runWorker();
    assert.equal(code, 0, output);
    const dataset = db.datasets.get(F1)!;
    assert.equal(dataset.status, DatasetStatus.FAILED);
    assert.match(dataset.statusMessage!, /unknown input format/);
    assert.equal(db.jobs.size, 0);
});

test("a job that ran out of memory on the worker is reported as such", async () => {
    await waitingDataset(O1, "oom");
    await runWorker();
    const dataset = db.datasets.get(O1)!;
    assert.equal(dataset.status, DatasetStatus.FAILED);
    assert.match(dataset.statusMessage!, /ran out of memory on the large-memory worker/);
});

test("a wrong token ends the worker with an error and processes nothing", async () => {
    await waitingDataset(W1, "ok");
    await writeFile(tokenFile, "x".repeat(48));
    try {
        const { code, output } = await runWorker();
        assert.equal(code, 2, output);
        assert.match(output, /refused the worker token/);
        assert.equal(db.datasets.get(W1)!.status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    } finally {
        await writeFile(tokenFile, `${TOKEN}\n`);
    }
});

test("the token is not on the command line, where other users could read it", async () => {
    await waitingDataset(S1, "slow");
    let commandLine = "";
    const { code } = await runWorker({ HEARTBEAT_SECONDS: "1" }, async () => {
        await pause(2500);
        commandLine = await new Promise<string>((resolve) => {
            const ps = spawn("ps", ["-eo", "args"]);
            let out = "";
            ps.stdout.on("data", (d) => (out += d));
            ps.on("close", () => resolve(out));
        });
        await remote.cancel(S1); // lets the slow job end
    });
    assert.equal(code, 0);
    assert.equal(commandLine.includes(TOKEN), false);
    assert.match(commandLine, /cluster-worker\.sh/);
});

test("a job the app drops while it runs is abandoned at the next heartbeat: nothing is reported or published", async () => {
    await waitingDataset(G1, "slow");
    const started = Date.now();
    const { code, output } = await runWorker({}, async () => {
        await pause(2000); // the worker has claimed the job and started the slow process
        await remote.cancel(G1);
    });
    assert.equal(code, 0, output);
    assert.ok(Date.now() - started < 30_000, "the slow process was stopped, not waited for");
    assert.match(output, /dropped by the app/);
    assert.equal(db.datasets.get(G1)!.status, DatasetStatus.WAITING_FOR_LARGE_MEMORY);
    assert.equal(await storage.hasParquet(G1), false);
    assert.deepEqual(await readdir(workDir), []);
});

test("missing settings are named and nothing is attempted", async () => {
    const missing = await runWorker({ APP_URL: "" });
    assert.equal(missing.code, 2);
    assert.match(missing.output, /APP_URL is not set/);
    const noImage = await runWorker({ PREPROCESS_IMAGE: "" });
    assert.equal(noImage.code, 2);
    assert.match(noImage.output, /PREPROCESS_IMAGE is not set/);
    await mkdir(workDir, { recursive: true });
});

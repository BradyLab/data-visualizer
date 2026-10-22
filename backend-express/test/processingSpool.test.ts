// Tests for the job spool shared with the preprocess worker (services/processingSpool): a fake worker in this process plays the part of
// shiny/preprocess/worker.sh, moving jobs from pending/ to running/ and reporting through done/
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Read when the module loads, so they are set first: fast polling, and a short wait for a worker to pick a job up
process.env.PREPROCESS_POLL_MS = "10";
process.env.PREPROCESS_PICKUP_TIMEOUT_MS = "300";
const { runSpooled } = await import("@src/services/processingSpool.ts");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const root = await mkdtemp(path.join(os.tmpdir(), "spool-test-"));
after(() => rm(root, { recursive: true, force: true }));

let counter = 0;
const newSpool = async () => path.join(root, `spool-${counter++}`);
const exists = (file: string) =>
    readFile(file).then(
        () => true,
        () => false
    );
const names = (spool: string, dir: string) => readdir(path.join(spool, dir)).catch(() => [] as string[]);

/** Waits (up to 5 s) until the file exists */
const waitFor = async (file: string) => {
    for (let i = 0; i < 500 && !(await exists(file)); i++) await sleep(10);
    assert.ok(await exists(file), `${file} never appeared`);
};

interface Job {
    id: string;
    input: string;
    output: string;
}

/**
 * Starts a worker for the spool: takes pending jobs one at a time (a rename into running/, like the real one) and calls `handle`.
 * `handle` must write done/<id>.status (and optionally .log) itself, or leave the job running. Returns a function that stops the worker
 */
const startWorker = (spool: string, handle: (job: Job) => Promise<void>) => {
    let stopped = false;
    const loop = (async () => {
        while (!stopped) {
            for (const file of (await names(spool, "pending")).filter((f) => f.endsWith(".job"))) {
                const id = file.slice(0, -".job".length);
                try {
                    await rename(path.join(spool, "pending", file), path.join(spool, "running", file));
                } catch {
                    continue; // withdrawn by the backend
                }
                const [input = "", output = ""] = (await readFile(path.join(spool, "running", file), "utf8")).split("\n");
                await handle({ id, input, output });
                await rm(path.join(spool, "running", file), { force: true });
            }
            await sleep(5);
        }
    })();
    return async () => {
        stopped = true;
        await loop;
    };
};

const finish = (spool: string, id: string, status: string, log = "") =>
    writeFile(path.join(spool, "done", `${id}.log`), log).then(() =>
        writeFile(path.join(spool, "done", `${id}.status`), `${status}\n`)
    );

/** Nothing of the job is left in the shared folder */
const assertClean = async (spool: string) => {
    for (const dir of ["pending", "done", "cancel"]) assert.deepEqual(await names(spool, dir), [], `${dir}/ is not empty`);
};

test("a job is handed to the worker with its paths, and a status of ok is a success", async () => {
    const spool = await newSpool();
    let seen: Job | undefined;
    const stop = await startWorker(spool, async (job) => {
        seen = job;
        await finish(spool, job.id, "ok", "all good");
    });
    try {
        assert.deepEqual(await runSpooled(spool, { stopped: false }, "/in/a.rds", "/out/a", 5000), { ok: true, message: "" });
        assert.deepEqual([seen?.input, seen?.output], ["/in/a.rds", "/out/a"]);
        await assertClean(spool);
    } finally {
        await stop();
    }
});

test("a failed job reports the last lines of the worker's log", async () => {
    const spool = await newSpool();
    const stop = startWorker(spool, (job) => finish(spool, job.id, "fail", "line 1\n\nline 2\nline 3\n  Error: boom  \n"));
    try {
        const result = await runSpooled(spool, { stopped: false }, "in", "out", 5000);
        assert.deepEqual(result, { ok: false, message: "line 2 line 3 Error: boom" });
        await assertClean(spool);
    } finally {
        await stop();
    }
});

test("a failed job without output still says that it failed", async () => {
    const spool = await newSpool();
    const stop = startWorker(spool, (job) => finish(spool, job.id, "fail"));
    try {
        assert.deepEqual(await runSpooled(spool, { stopped: false }, "in", "out", 5000), {
            ok: false,
            message: "Processing failed",
        });
    } finally {
        await stop();
    }
});

test("without a worker the job is reported as not picked up and withdrawn", async () => {
    const spool = await newSpool();
    const result = await runSpooled(spool, { stopped: false }, "in", "out", 5000);
    assert.equal(result.ok, false);
    assert.match(result.message, /No preprocessing worker picked up the job/);
    await assertClean(spool);
});

test("stopping a job nobody started withdraws it", async () => {
    const spool = await newSpool();
    const job = { stopped: false };
    setTimeout(() => (job.stopped = true), 50);
    assert.deepEqual(await runSpooled(spool, job, "in", "out", 5000), { ok: false, message: "Processing was stopped" });
    await assertClean(spool);
});

test("stopping a running job asks the worker to cancel and reports it as stopped", async () => {
    const spool = await newSpool();
    const job = { stopped: false };
    const stop = startWorker(spool, async ({ id }) => {
        setTimeout(() => (job.stopped = true), 30);
        await waitFor(path.join(spool, "cancel", id)); // the backend asked
        await finish(spool, id, "fail", "killed");
    });
    try {
        assert.deepEqual(await runSpooled(spool, job, "in", "out", 5000), { ok: false, message: "Processing was stopped" });
        await assertClean(spool);
    } finally {
        await stop();
    }
});

test("a job that runs past the limit is cancelled and reported as too slow", async () => {
    const spool = await newSpool();
    const stop = startWorker(spool, async ({ id }) => {
        await waitFor(path.join(spool, "cancel", id));
        await finish(spool, id, "fail", "killed");
    });
    try {
        const result = await runSpooled(spool, { stopped: false }, "in", "out", 100);
        assert.equal(result.ok, false);
        assert.match(result.message, /Processing took longer than \d+ minutes and was stopped/);
        await assertClean(spool);
    } finally {
        await stop();
    }
});

test("a worker that finishes a job after it was stopped does not turn it into a success", async () => {
    const spool = await newSpool();
    const job = { stopped: false };
    const stop = startWorker(spool, async ({ id }) => {
        job.stopped = true;
        await sleep(50);
        await finish(spool, id, "ok");
    });
    try {
        assert.deepEqual(await runSpooled(spool, job, "in", "out", 5000), { ok: false, message: "Processing was stopped" });
    } finally {
        await stop();
    }
});

test("a spool folder that cannot be written is reported instead of thrown", async () => {
    const file = path.join(root, "a-file");
    await writeFile(file, "");
    const result = await runSpooled(path.join(file, "spool"), { stopped: false }, "in", "out", 5000);
    assert.equal(result.ok, false);
    assert.match(result.message, /Could not hand the job to the worker/);
});

test("jobs run one after the other through the same worker", async () => {
    const spool = await newSpool();
    const order: string[] = [];
    const stop = startWorker(spool, async (job) => {
        order.push(job.input);
        await finish(spool, job.id, "ok");
    });
    try {
        const first = await runSpooled(spool, { stopped: false }, "one", "out", 5000);
        const second = await runSpooled(spool, { stopped: false }, "two", "out", 5000);
        assert.deepEqual([first.ok, second.ok, order], [true, true, ["one", "two"]]);
        await assertClean(spool);
    } finally {
        await stop();
    }
});

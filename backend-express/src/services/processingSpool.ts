// Hands a preprocessing job to a worker container instead of running R in this process (PREPROCESS_SPOOL_DIR is set).
// The two sides share a folder (data/jobs) and talk through files, so no network or Docker access is needed:
//
//   backend: pending/<id>.job (2 lines: input path, output path)  ->  worker (shiny/preprocess/worker.sh) moves it to running/
//   worker:  runs preprocess.R, then writes done/<id>.log (end of the output) and last done/<id>.status ("ok" or "fail")
//   backend: cancel/<id> asks the worker to stop a running job
//
// The worker handles one job at a time, and so does the backend, so a job that is still pending after a short while means that
// no worker is running.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface JobResult {
    ok: boolean;
    message: string;
}

// How the caller can tell the job to stop (set when a re-upload or a delete makes its result worthless)
export interface Stoppable {
    stopped: boolean;
}

const POLL_MS = Number(process.env.PREPROCESS_POLL_MS) || 1000;
// A job nobody picked up after this long means there is no worker (default 1 minute)
const pickupMs = () => Number(process.env.PREPROCESS_PICKUP_TIMEOUT_MS) || 60 * 1000;
// After asking the worker to cancel, how long to wait for it to confirm before giving up on it
const CANCEL_GRACE_MS = 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const read = (file: string) => readFile(file, "utf8").catch(() => null);

// The last few lines of the job's output: that is where R reports its error
const lastLines = (log: string) =>
    log
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-3)
        .join(" ");

// Jobs the backend stopped waiting for while the worker had not confirmed the cancel (job id -> spool folder). The worker may still be
// running them, so the next job must not be submitted until they are gone: it would otherwise sit in pending past the pickup timeout
// (reported as "no worker") and two runs could write the same output folder
const abandoned = new Map<string, string>();

// Waits (at most limitMs, in case the worker died with the job) until the worker has finished every abandoned job of this spool folder,
// then removes the files the worker left for them
const waitForAbandoned = async (spool: string, job: Stoppable, limitMs: number) => {
    const deadline = Date.now() + limitMs;
    for (;;) {
        for (const [id, folder] of abandoned) {
            if (folder !== spool || (await read(path.join(spool, "running", `${id}.job`))) !== null) continue;
            abandoned.delete(id);
            await Promise.all(
                [
                    path.join(spool, "done", `${id}.status`),
                    path.join(spool, "done", `${id}.log`),
                    path.join(spool, "cancel", id),
                ].map((f) => rm(f, { force: true }))
            );
        }
        if (![...abandoned.values()].includes(spool) || job.stopped || Date.now() > deadline) return;
        await sleep(POLL_MS);
    }
};

/** Submits a job and waits for the worker's verdict. Never rejects; limitMs is the time allowed once the worker has started it */
export const runSpooled = async (
    spool: string,
    job: Stoppable,
    input: string,
    output: string,
    limitMs: number
): Promise<JobResult> => {
    await waitForAbandoned(spool, job, limitMs);
    const id = randomUUID();
    const file = (dir: string, name: string) => path.join(spool, dir, name);
    try {
        await Promise.all(["pending", "running", "cancel", "done"].map((d) => mkdir(path.join(spool, d), { recursive: true })));
        // Written under another name and renamed, so the worker never sees half a file
        await writeFile(file("pending", `${id}.tmp`), `${input}\n${output}\n`);
        await rename(file("pending", `${id}.tmp`), file("pending", `${id}.job`));
    } catch (err) {
        return { ok: false, message: `Could not hand the job to the worker: ${(err as Error).message}` };
    }

    const submitted = Date.now();
    let startedAt: number | null = null; // when the worker was first seen running it
    let cancelAskedAt: number | null = null;
    let timedOut = false;
    let gaveUp = false; // stopped waiting for a worker that had not confirmed the cancel
    const stoppedMessage = "Processing was stopped";
    try {
        for (;;) {
            const status = (await read(file("done", `${id}.status`)))?.trim();
            if (status) {
                const log = (await read(file("done", `${id}.log`))) ?? "";
                if (timedOut)
                    return {
                        ok: false,
                        message: `Processing took longer than ${Math.round(limitMs / 60000)} minutes and was stopped`,
                    };
                if (job.stopped) return { ok: false, message: stoppedMessage };
                return status === "ok"
                    ? { ok: true, message: "" }
                    : { ok: false, message: lastLines(log) || "Processing failed" };
            }
            // The worker moves pending -> running in one rename and writes done before it drops running, so a job is always in one of them
            if (startedAt === null && (await read(file("running", `${id}.job`))) !== null) startedAt = Date.now();

            if (startedAt === null) {
                // Not started: stopping is just withdrawing it (the finally below removes the file); a missing worker is reported
                if (job.stopped) return { ok: false, message: stoppedMessage };
                if (Date.now() - submitted > pickupMs())
                    return {
                        ok: false,
                        message: "No preprocessing worker picked up the job. Is the preprocess service running?",
                    };
            } else {
                if (cancelAskedAt === null && (job.stopped || Date.now() - startedAt > limitMs)) {
                    timedOut = !job.stopped;
                    cancelAskedAt = Date.now();
                    await writeFile(file("cancel", id), "").catch(() => {});
                }
                // The worker did not confirm the cancel: stop waiting for it
                // (the job is remembered in `abandoned`, see above, since the worker may still be running it)
                if (cancelAskedAt !== null && Date.now() - cancelAskedAt > CANCEL_GRACE_MS) {
                    gaveUp = true;
                    abandoned.set(id, spool);
                    return {
                        ok: false,
                        message: timedOut
                            ? `Processing took longer than ${Math.round(limitMs / 60000)} minutes and was stopped`
                            : stoppedMessage,
                    };
                }
            }
            await sleep(POLL_MS);
        }
    } finally {
        // Whatever happened, leave no trace in the shared folder (a job nobody picked up must not run later either).
        // A job the worker may still be running keeps its cancel marker and result files; waitForAbandoned removes them once it is gone
        const files = [file("pending", `${id}.job`), file("pending", `${id}.tmp`)];
        if (!gaveUp) files.push(file("done", `${id}.status`), file("done", `${id}.log`), file("cancel", id));
        await Promise.all(files.map((f) => rm(f, { force: true })));
    }
};

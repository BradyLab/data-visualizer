// Turns an uploaded RDS into the Parquet files the Shiny viewer reads, by running shiny/preprocess/preprocess.R on this machine ("local mode").
//
// Upload finishes -> start(): dataset status PROCESSING -> queue -> Rscript preprocess.R <rds> <PARQUET_DIR>/<dataset id> -> READY or FAILED
//
// - One job at a time (a 15-25 GB object needs tens of GB of RAM). Jobs wait in a queue and a dataset is queued at most once.
// - A re-upload while the dataset is processing kills the running job and queues a new one; a job whose RDS is no longer the current
//   one never touches the status.
// - The job runs either here (R with Seurat, arrow and Matrix must be installed; a missing Rscript shows up as a FAILED dataset) or,
//   when PREPROCESS_SPOOL_DIR is set, in a worker container that picks jobs up from that shared folder (processingSpool.ts).
// - Jobs left PROCESSING by a restart are queued again at startup (resume).
// - Datasets too big for this server go to the large-memory worker instead (PREPROCESS_MODE, see routing.ts and remoteProcessing.ts): their
//   status is WAITING_FOR_LARGE_MEMORY until the worker reports back. In "auto" mode a job that runs out of memory here is sent there too.
import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { DatasetStatus } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { Datasets } from "@src/models/dataset.ts";
import * as fileService from "@src/services/file.ts";
import * as storage from "@src/services/storage.ts";
import { runSpooled, type JobResult } from "@src/services/processingSpool.ts";
import { MAX_MESSAGE, redactPaths, setStatus } from "@src/services/datasetStatus.ts";
import * as remote from "@src/services/remoteProcessing.ts";
import { isOutOfMemory, needsLargeMemory, retryRemotelyOnOutOfMemory } from "@src/services/routing.ts";
import { sendNotice } from "@src/services/email.ts";

export { redactPaths };

// Program and script that do the conversion (see shiny/README); the defaults suit a checkout of this repository
const command = () => process.env.PREPROCESS_COMMAND || "Rscript";
const script = () => process.env.PREPROCESS_SCRIPT || path.resolve(import.meta.dirname, "../../../shiny/preprocess/preprocess.R");
// A job that runs longer than this is killed and the dataset marked FAILED (default 6 hours)
const timeoutMs = () => Number(process.env.PREPROCESS_TIMEOUT_MS) || 6 * 60 * 60 * 1000;

// The job gets a small environment instead of the server's: no database password, JWT secret or the like
const ENV_KEYS = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "R_HOME", "R_LIBS", "R_LIBS_USER", "R_LIBS_SITE"];
const jobEnv = () =>
    Object.fromEntries(ENV_KEYS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]])) as NodeJS.ProcessEnv;

// Asks a job to stop (SIGTERM), and kills it if it has not stopped after 10 seconds
const terminate = (child: ChildProcess | null) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
};

// The job currently being worked on
interface Running {
    datasetId: string;
    child: ChildProcess | null;
    // Set when the job's result must be thrown away (re-upload, delete)
    stopped: boolean;
}

// Dataset ids waiting for their turn, and the one job running now (at most one)
const queue: string[] = [];
let running: Running | null = null;

/** True while a dataset's job is queued or running */
export const isBusy = (datasetId: string) => running?.datasetId === datasetId || queue.includes(datasetId);

// With a spool folder the job goes to a worker container (see processingSpool.ts); otherwise R is run here
const execute = (job: Running, input: string, output: string): Promise<JobResult> =>
    process.env.PREPROCESS_SPOOL_DIR
        ? runSpooled(process.env.PREPROCESS_SPOOL_DIR, job, input, output, timeoutMs())
        : executeLocally(job, input, output);

// Runs the script as a child process; resolves with how it ended and the tail of its output. Never rejects
const executeLocally = (job: Running, input: string, output: string) =>
    new Promise<JobResult>((resolve) => {
        // Stopped (re-upload, delete) before it even started
        if (job.stopped) return resolve({ ok: false, message: "Processing was stopped" });
        let tail = "";
        const keep = (chunk: Buffer) => (tail = (tail + chunk.toString()).slice(-4000));
        let timedOut = false;
        let child: ChildProcess;
        try {
            child = spawn(command(), [script(), input, output], { env: jobEnv(), stdio: ["ignore", "pipe", "pipe"] });
        } catch (err) {
            return resolve({ ok: false, message: `Could not start ${command()}: ${(err as Error).message}` });
        }
        job.child = child;
        const timer = setTimeout(() => {
            timedOut = true;
            terminate(child);
        }, timeoutMs());
        child.stdout?.on("data", keep);
        child.stderr?.on("data", keep);
        // Missing program (ENOENT), no permission, ...
        child.on("error", (err) => {
            clearTimeout(timer);
            resolve({ ok: false, message: `Could not run ${command()}: ${err.message}` });
        });
        child.on("close", (code, signal) => {
            clearTimeout(timer);
            if (timedOut)
                return resolve({
                    ok: false,
                    message: `Processing took longer than ${Math.round(timeoutMs() / 60000)} minutes and was stopped`,
                });
            if (code === 0) return resolve({ ok: true, message: "" });
            // The R error is the last thing printed; show that rather than the start of the log
            const lines = tail
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);
            resolve({
                ok: false,
                message: lines.slice(-3).join(" ") || `Processing stopped (${signal ?? `exit code ${code}`})`,
                ...(isOutOfMemory({ code, signal, text: tail }) ? { outOfMemory: true } : {}),
            });
        });
    });

// Gives the dataset to the large-memory worker: status first (a worker only takes jobs of datasets that wait), then the job; tells the lab
const handOff = async (job: Running, fileVersion: number, sizeBytes: number) => {
    const { datasetId } = job;
    try {
        if (!(await setStatus(datasetId, DatasetStatus.WAITING_FOR_LARGE_MEMORY, null))) return;
        await remote.enqueue(datasetId, fileVersion);
    } catch (err) {
        console.error("[PROCESSING] Could not queue the dataset for the large-memory worker:", err);
        await setStatus(datasetId, DatasetStatus.FAILED, "Could not queue the dataset for large-memory processing").catch(
            () => {}
        );
        return;
    }
    const dataset = await Datasets.findByPk(datasetId);
    const gigabytes = (sizeBytes / 1024 ** 3).toFixed(1);
    void sendNotice(
        "A dataset is waiting for the large-memory worker",
        `The dataset "${dataset?.name ?? datasetId}" (data file ${gigabytes} GB) is too large to process on the server. ` +
            "Start the large-memory worker on the cluster (shiny/preprocess/cluster/cluster-worker.sh) to process it; the dataset page shows its status."
    );
};

// One job from start to finish
const runJob = async (job: Running) => {
    const { datasetId } = job;
    const rds = await fileService.getCurrent(datasetId, FileTypes.RDS);
    if (!rds) {
        await setStatus(datasetId, DatasetStatus.FAILED, "There is no data file to process");
        return;
    }
    // Too big for this server: no point in trying here (a worker with enough memory takes it)
    if (remote.enabled() && needsLargeMemory(rds.sizeBytes)) {
        console.log(`[PROCESSING] Dataset ${datasetId} is too large for this server, sending it to the large-memory worker`);
        await handOff(job, rds.version, rds.sizeBytes);
        return;
    }
    const output = storage.parquetPath(datasetId);
    let result: JobResult;
    try {
        // With a worker the script lives in its container, not here
        if (!process.env.PREPROCESS_SPOOL_DIR) await access(script());
        result = await execute(job, storage.storedPath(rds), output);
    } catch (err) {
        result = {
            ok: false,
            message:
                err instanceof Error && "code" in err && err.code === "ENOENT"
                    ? `Preprocess script not found at ${script()}`
                    : String(err),
        };
    }
    // The script publishes <output> by renaming <output>.tmp at the very end, so a failed run leaves the .tmp folder behind and any
    // earlier output untouched. Only the .tmp folder is removed: Parquet that is already there (from an earlier upload, or made by hand
    // with the preprocess image) must survive a failed retry
    if (!result.ok) await storage.removeParquetTmp(datasetId).catch(() => {});
    // Throw the result away if the dataset was deleted, or the RDS was replaced meanwhile (the newer upload has its own job queued)
    const current = await fileService.getCurrent(datasetId, FileTypes.RDS);
    if (job.stopped || !current || current.version !== rds.version) {
        console.log("[PROCESSING] Result is out of date, discarding it");
        if (!(await Datasets.findByPk(datasetId))) await storage.removeParquet(datasetId).catch(() => {});
        return;
    }
    // Ran out of memory here: the worker has more, so try there rather than give up
    if (!result.ok && result.outOfMemory && remote.enabled() && retryRemotelyOnOutOfMemory()) {
        console.log(`[PROCESSING] Dataset ${datasetId} ran out of memory on this server, sending it to the large-memory worker`);
        await handOff(job, rds.version, rds.sizeBytes);
        return;
    }
    if (result.ok && !(await storage.hasParquet(datasetId)))
        result = { ok: false, message: "Processing finished but produced no data" };
    console.log(`[PROCESSING] Dataset ${datasetId} ${result.ok ? "is ready" : `failed: ${result.message}`}`);
    await setStatus(
        datasetId,
        result.ok ? DatasetStatus.READY : DatasetStatus.FAILED,
        result.ok ? null : redactPaths(result.message).slice(0, MAX_MESSAGE)
    );
};

// Runs queued jobs one after another until the queue is empty
const pump = async () => {
    if (running) return;
    const datasetId = queue.shift();
    if (!datasetId) return;
    running = { datasetId, child: null, stopped: false };
    try {
        await runJob(running);
    } catch (err) {
        console.error("[PROCESSING] Job crashed:", err);
        if (!running.stopped) await setStatus(datasetId, DatasetStatus.FAILED, "Processing failed unexpectedly").catch(() => {});
    } finally {
        running = null;
        void pump();
    }
};

/** Puts a dataset's job in the queue (once) without touching its status */
export const enqueue = (datasetId: string) => {
    // Already running on the current file: nothing more to do (start() stops a job on an outdated file before queueing again)
    if (running?.datasetId === datasetId && !running.stopped) return;
    if (!queue.includes(datasetId)) queue.push(datasetId);
    void pump();
};

/**
 * Marks the dataset PROCESSING and queues its job. Call it when a new RDS file has been stored, or to retry a failed one.
 * A job already running for the dataset is stopped, since it works on an older file
 */
export const start = async (datasetId: string) => {
    // An earlier job on the large-memory worker works on an older file (or is being retried): the worker is told it is gone
    await remote.cancel(datasetId).catch((err) => console.error("[PROCESSING] Could not drop the remote job:", err));
    if (running?.datasetId === datasetId) {
        running.stopped = true;
        terminate(running.child);
    }
    if (await setStatus(datasetId, DatasetStatus.PROCESSING, null)) enqueue(datasetId);
};

/** Forgets a deleted dataset's job: dequeues it and stops it if it is running */
export const cancel = (datasetId: string) => {
    void remote.cancel(datasetId).catch((err) => console.error("[PROCESSING] Could not drop the remote job:", err));
    const i = queue.indexOf(datasetId);
    if (i !== -1) queue.splice(i, 1);
    if (running?.datasetId === datasetId) {
        running.stopped = true;
        terminate(running.child);
    }
};

/**
 * Returns a dataset to the "waiting for its data file" state after its current RDS was deleted: stops any job, removes the Parquet built
 * from that RDS (the viewer would otherwise keep serving it) and sets PROCESSING, as for a new dataset; a later upload starts a new job
 */
export const reset = async (datasetId: string) => {
    cancel(datasetId);
    await storage.removeParquet(datasetId);
    await setStatus(datasetId, DatasetStatus.PROCESSING, null);
};

/** Queues again the datasets a restart left PROCESSING (only those that have a data file; a new dataset waits for its upload) */
export const resume = async () => {
    const pending = await Datasets.findAll({ where: { status: DatasetStatus.PROCESSING }, attributes: ["id"] });
    for (const { id } of pending) if (await fileService.getCurrent(id, FileTypes.RDS)) enqueue(id);
    if (queue.length) console.log(`[PROCESSING] Resuming ${queue.length} unfinished job(s)`);
};

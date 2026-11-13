// Processing on the large-memory worker: datasets too big for this server's memory wait here, and a worker running elsewhere (the school's
// cluster, see shiny/preprocess/cluster/cluster-worker.sh) fetches the RDS file over HTTP, runs preprocess.R, and sends the Parquet files back.
// The worker never touches the database or the disk of this server; it only calls the /api/worker routes (routers/worker.ts), which use
// the functions below.
//
//   processing.ts hands a dataset over -> enqueue(): status WAITING_FOR_LARGE_MEMORY + a RemoteJobs row
//   worker: claimNext() -> download the RDS -> process -> receiveFile() for each Parquet file -> complete() (READY) or fail() (FAILED)
//
// A job is claimed under a fresh id, so a worker that lost its claim (it stalled and the job was given to another) is told the job is
// gone the next time it calls. A claim whose heartbeat is older than the lease (REMOTE_LEASE_MS, default 15 minutes) is given up and the job
// can be claimed again. A job whose dataset was deleted, re-uploaded or reprocessed meanwhile is gone too.
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Op } from "sequelize";
import { DatasetStatus } from "@commons/dataset.ts";
import { FileTypes } from "@commons/file.ts";
import { Datasets } from "@src/models/dataset.ts";
import { RemoteJobs } from "@src/models/remoteJob.ts";
import * as fileService from "@src/services/file.ts";
import * as storage from "@src/services/storage.ts";
import { MAX_MESSAGE, redactPaths, setStatus } from "@src/services/datasetStatus.ts";

// How long a claim lasts without a heartbeat
const leaseMs = () => Number(process.env.REMOTE_LEASE_MS) || 15 * 60 * 1000;
// Largest Parquet file accepted from the worker (64 GiB unless REMOTE_UPLOAD_MAX_BYTES is set)
export const maxUploadBytes = () => Number(process.env.REMOTE_UPLOAD_MAX_BYTES) || 64 * 1024 * 1024 * 1024;

/** True when a worker token is configured, i.e. datasets can be sent to the large-memory worker */
export const enabled = () => !!process.env.REMOTE_WORKER_TOKEN;

/** Queues a dataset for the worker, replacing an earlier job of the same dataset (made for an older file) */
export const enqueue = async (datasetId: string, fileVersion: number) => {
    await RemoteJobs.destroy({ where: { dataset_id: datasetId } });
    await storage.removeParquetTmp(datasetId).catch(() => {});
    await RemoteJobs.create({ id: randomUUID(), dataset_id: datasetId, file_version: fileVersion });
};

/** Drops a dataset's job (deleted, re-uploaded, retried locally): the worker finds out at its next call. Also removes what it had uploaded */
export const cancel = async (datasetId: string) => {
    // Nothing can be waiting for a worker that is not configured (and local-only setups never touch the table)
    if (!enabled()) return;
    await RemoteJobs.destroy({ where: { dataset_id: datasetId } });
    await storage.removeParquetTmp(datasetId).catch(() => {});
};

/** True if the dataset has a job waiting for or being worked on by the worker */
export const hasJob = async (datasetId: string) => (await RemoteJobs.count({ where: { dataset_id: datasetId } })) > 0;

// What a job needs to be valid: the dataset still waits for the worker, and the file it was made for is still the current one
interface ActiveJob {
    job: RemoteJobs;
    datasetId: string;
    // The RDS file on this server (for the download)
    rdsPath: string;
    rdsSize: number;
    rdsName: string;
}

const activeFor = async (job: RemoteJobs): Promise<ActiveJob | null> => {
    const dataset = await Datasets.findByPk(job.dataset_id);
    if (!dataset || dataset.status !== DatasetStatus.WAITING_FOR_LARGE_MEMORY) return null;
    const rds = await fileService.getCurrent(job.dataset_id, FileTypes.RDS);
    if (!rds || rds.version !== job.file_version) return null;
    return { job, datasetId: job.dataset_id, rdsPath: storage.storedPath(rds), rdsSize: rds.sizeBytes, rdsName: rds.ogName };
};

/**
 * The job with this id if it is claimed and still valid, else null (the worker must stop: unknown id, given to another worker, or the
 * dataset changed). A job found to be out of date is removed
 */
export const find = async (id: string) => {
    const job = await RemoteJobs.findByPk(id);
    if (!job || !job.claimedAt) return null;
    const active = await activeFor(job);
    if (!active) await RemoteJobs.destroy({ where: { id: job.id } });
    return active;
};

/** A worker's claim on a job: what it needs to fetch and process the dataset */
export interface Claim {
    id: string;
    datasetId: string;
    sizeBytes: number;
    // How long the worker may take; it should give up after this (the same limit as local processing)
    timeoutMs: number;
}

/**
 * How many jobs a worker could claim right now (the same ones claimNext looks at), without claiming or changing anything: for a small
 * scheduled check that starts the big worker only when there is something to do. Jobs that are out of date are not counted (nor removed;
 * claimNext does that)
 */
export const countWaiting = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - leaseMs());
    const jobs = await RemoteJobs.findAll({ where: { [Op.or]: [{ claimedAt: null }, { heartbeatAt: { [Op.lt]: cutoff } }] } });
    let waiting = 0;
    for (const job of jobs) if (await activeFor(job)) waiting++;
    return waiting;
};

/**
 * Gives the oldest waiting job (never claimed, or claimed with a heartbeat older than the lease) to a worker, under a new id, or returns
 * null when there is none. Jobs that are out of date are dropped on the way
 */
export const claimNext = async (): Promise<Claim | null> => {
    for (;;) {
        const claimed = await RemoteJobs.sequelize!.transaction(async (transaction) => {
            const cutoff = new Date(Date.now() - leaseMs());
            // FOR UPDATE SKIP LOCKED: two workers asking at once get different jobs, never the same one
            const job = await RemoteJobs.findOne({
                where: { [Op.or]: [{ claimedAt: null }, { heartbeatAt: { [Op.lt]: cutoff } }] },
                order: [["createdAt", "ASC"]],
                lock: transaction.LOCK.UPDATE,
                skipLocked: true,
                transaction,
            });
            if (!job) return "none" as const;
            const active = await activeFor(job);
            if (!active) {
                await RemoteJobs.destroy({ where: { id: job.id }, transaction });
                return "stale" as const;
            }
            const now = new Date();
            const id = randomUUID();
            await RemoteJobs.update({ id, claimedAt: now, heartbeatAt: now }, { where: { id: job.id }, transaction });
            // A fresh start: whatever an earlier worker left half uploaded is not trusted
            await storage.removeParquetTmp(active.datasetId).catch(() => {});
            return {
                id,
                datasetId: active.datasetId,
                sizeBytes: active.rdsSize,
                timeoutMs: Number(process.env.PREPROCESS_TIMEOUT_MS) || 6 * 60 * 60 * 1000,
            } satisfies Claim;
        });
        if (claimed === "none") return null;
        if (claimed !== "stale") return claimed;
    }
};

/** Marks the worker as alive. Returns false when the job is gone and the worker should stop */
export const heartbeat = async (id: string) => {
    const active = await find(id);
    if (!active) return false;
    await active.job.update({ heartbeatAt: new Date() });
    return true;
};

// Counts the bytes that pass and fails when there are more than allowed
const limit = (max: number) => {
    const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
            meter.bytes += chunk.length;
            if (meter.bytes > max) return callback(new Error("The file is larger than announced"));
            callback(null, chunk);
        },
    }) as Transform & { bytes: number };
    meter.bytes = 0;
    return meter;
};

/** Why a Parquet upload was refused (for the router to turn into a status code) */
export class UploadError extends Error {
    constructor(
        readonly status: 400 | 410 | 413,
        message: string
    ) {
        super(message);
    }
}

/**
 * Stores one Parquet file of the job in the dataset's .tmp folder (not published until complete()). The name must be one of
 * storage.PARQUET_FILES, the exact size must be announced up front, and the body must match it: a file that is cut short or too long is discarded.
 * Uploading a file again replaces it, so the worker can simply retry
 */
export const receiveFile = async (id: string, name: string, body: Readable, announcedBytes: number) => {
    if (!(storage.PARQUET_FILES as readonly string[]).includes(name)) throw new UploadError(400, `Unknown file ${name}`);
    if (!Number.isSafeInteger(announcedBytes) || announcedBytes < 0)
        throw new UploadError(400, "The file size must be announced (Content-Length)");
    if (announcedBytes > maxUploadBytes()) throw new UploadError(413, "The file is too large");
    const active = await find(id);
    if (!active) throw new UploadError(410, "This job is no longer active");
    const dir = storage.parquetTmpPath(active.datasetId);
    await mkdir(dir, { recursive: true });
    const part = `${dir}/${name}.part`;
    const meter = limit(announcedBytes);
    try {
        await pipeline(body, meter, createWriteStream(part));
        if (meter.bytes !== announcedBytes) throw new UploadError(400, "The upload ended before all of the file arrived");
        // Renamed only when whole, so a half-received file can never be mistaken for a finished one
        await rename(part, `${dir}/${name}`);
    } catch (err) {
        await rm(part, { force: true });
        if (err instanceof UploadError) throw err;
        throw new UploadError(400, err instanceof Error ? err.message : "The upload failed");
    }
    await active.job.update({ heartbeatAt: new Date() }).catch(() => {});
    return meter.bytes;
};

/**
 * The worker is done: checks that the files every dataset has are there, publishes the Parquet folder and marks the dataset READY.
 * Returns a message when it cannot (the job is gone, or files are missing), or null on success
 */
export const complete = async (id: string) => {
    const active = await find(id);
    if (!active) return "gone" as const;
    const dir = storage.parquetTmpPath(active.datasetId);
    for (const name of storage.REQUIRED_PARQUET_FILES) {
        if (!(await storage.sizeOf(`${dir}/${name}`))) return `Missing ${name}`;
    }
    await storage.publishParquet(active.datasetId);
    await RemoteJobs.destroy({ where: { id: active.job.id } });
    console.log(`[REMOTE PROCESSING] Dataset ${active.datasetId} is ready`);
    await setStatus(active.datasetId, DatasetStatus.READY, null);
    return null;
};

/** The worker could not process the dataset: records the failure (its message, with paths cut down) and drops the job. False if the job is gone */
export const fail = async (id: string, message: string) => {
    const active = await find(id);
    if (!active) return false;
    console.log(`[REMOTE PROCESSING] Dataset ${active.datasetId} failed: ${message}`);
    await storage.removeParquetTmp(active.datasetId).catch(() => {});
    await RemoteJobs.destroy({ where: { id: active.job.id } });
    await setStatus(
        active.datasetId,
        DatasetStatus.FAILED,
        redactPaths(message).slice(0, MAX_MESSAGE) || "Processing failed on the large-memory worker"
    );
    return true;
};

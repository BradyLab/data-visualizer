// Where a preprocessing job runs: on this server, or on the large-memory worker (see remoteProcessing.ts). Pure functions of the environment, so
// they are easy to test; processing.ts applies them.
//
// PREPROCESS_MODE:
//   local   (default) every job runs on this server
//   auto    jobs whose estimated memory does not fit this server run on the worker, and so does a job this server runs out of memory on
//   remote  every job runs on the worker
// Anything but "local" needs REMOTE_WORKER_TOKEN; without it jobs stay local.
import os from "node:os";

export type ProcessingMode = "local" | "auto" | "remote";

type Env = Record<string, string | undefined>;

const UNITS: Record<string, number> = { "": 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };

/** Bytes in a size such as "24g", "24GB", "1500MB", "1.5 GiB" or "123456" (powers of 1024), or null if it is not one */
export const parseSize = (value: string | undefined) => {
    const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)(?:i?b)?$/i.exec((value ?? "").trim());
    return match ? Math.floor(Number(match[1]) * UNITS[match[2]!.toLowerCase()]!) : null;
};

/** The mode from PREPROCESS_MODE ("local" when unset or not a mode: preprocessConfigProblems reports the latter at startup) */
export const processingMode = (env: Env = process.env): ProcessingMode => {
    const mode = (env.PREPROCESS_MODE ?? "").trim().toLowerCase();
    return mode === "auto" || mode === "remote" ? mode : "local";
};

// Peak memory of the job as a multiple of the RDS file's size; the docs say 2-5x, so assume the worst until a real run says otherwise
const memoryRatio = (env: Env) => {
    const ratio = Number(env.PREPROCESS_MEMORY_RATIO);
    return ratio > 0 ? ratio : 5;
};

/**
 * Memory a job may use on this server: PREPROCESS_LOCAL_MEMORY (a size; in docker-compose.prod.yml the memory limit of the preprocess
 * container), else this machine's RAM minus PREPROCESS_MEMORY_RESERVE (default 8g) for the web app, the database and the viewer
 */
export const localMemoryBudget = (env: Env = process.env, totalBytes = os.totalmem()) => {
    const set = parseSize(env.PREPROCESS_LOCAL_MEMORY);
    if (set !== null) return set;
    return Math.max(0, totalBytes - (parseSize(env.PREPROCESS_MEMORY_RESERVE) ?? 8 * 1024 ** 3));
};

/** True if a job on an RDS file this big should go to the large-memory worker rather than start here (before any attempt) */
export const needsLargeMemory = (sizeBytes: number, env: Env = process.env, totalBytes = os.totalmem()) => {
    const mode = processingMode(env);
    if (mode === "remote") return true;
    if (mode === "auto") return sizeBytes * memoryRatio(env) > localMemoryBudget(env, totalBytes);
    return false;
};

/** True if a failed local job should be sent to the worker instead of being marked FAILED (only in auto mode, and only for memory failures) */
export const retryRemotelyOnOutOfMemory = (env: Env = process.env) => processingMode(env) === "auto";

/**
 * True if how a job ended says it ran out of memory: killed by SIGKILL (exit code 137, which is what the kernel's or Docker's memory limit
 * does to the R process), or R's own "cannot allocate" error, which it exits with when malloc fails
 */
export const isOutOfMemory = (ended: { code: number | null; signal: string | null; text: string }) =>
    ended.signal === "SIGKILL" ||
    ended.code === 137 ||
    /cannot allocate (?:vector|memory)|std::bad_alloc|out of memory/i.test(ended.text);

/** What is wrong with the routing settings (empty when they are fine); the server refuses to start in production with problems */
export const preprocessConfigProblems = (env: Env = process.env) => {
    const problems: string[] = [];
    const mode = (env.PREPROCESS_MODE ?? "").trim().toLowerCase();
    if (mode && !["local", "auto", "remote"].includes(mode))
        problems.push(`PREPROCESS_MODE must be local, auto or remote, not "${env.PREPROCESS_MODE}"`);
    if (processingMode(env) !== "local" && !env.REMOTE_WORKER_TOKEN)
        problems.push(
            `PREPROCESS_MODE=${processingMode(env)} needs REMOTE_WORKER_TOKEN (the secret of the large-memory worker); jobs would all run here`
        );
    for (const name of ["PREPROCESS_LOCAL_MEMORY", "PREPROCESS_MEMORY_RESERVE"])
        if (env[name] && parseSize(env[name]) === null)
            problems.push(`${name} must be a size such as 24g or 1500MB, not "${env[name]}"`);
    if (env.PREPROCESS_MEMORY_RATIO && !(Number(env.PREPROCESS_MEMORY_RATIO) > 0))
        problems.push("PREPROCESS_MEMORY_RATIO must be a positive number");
    return problems;
};

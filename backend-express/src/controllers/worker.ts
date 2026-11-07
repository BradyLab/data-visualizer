// Handlers for the large-memory worker's routes (mounted at /api/worker, see routers/worker.ts); the logic is in services/remoteProcessing.ts.
// Answers are plain text lines (key=value) where the worker has to read them, so the worker script needs nothing but curl and a shell.
// 410 Gone means "stop working on this job": it was given to another worker, or the dataset changed or was deleted
import type { Request, Response } from "express";
import * as service from "@src/services/remoteProcessing.ts";

const GONE = { error: "This job is no longer active" };

/** POST /claim : gives the worker the oldest waiting job (200, text lines id, dataset_id, size_bytes, timeout_seconds), or 204 when there is none */
export const claim = async (req: Request, res: Response) => {
    const job = await service.claimNext();
    if (!job) return res.status(204).end();
    console.log(`[WORKER CONTROLLER] Job ${job.id} for dataset ${job.datasetId} claimed`);
    res.type("text/plain").send(
        `id=${job.id}\ndataset_id=${job.datasetId}\nsize_bytes=${job.sizeBytes}\ntimeout_seconds=${Math.round(job.timeoutMs / 1000)}\n`
    );
};

/** GET /jobs/:id/rds : sends the dataset's RDS file, with Range support so an interrupted download can resume */
export const rds = async (req: Request, res: Response) => {
    const active = await service.find(req.params.id as string);
    if (!active) return res.status(410).json(GONE);
    res.sendFile(
        active.rdsPath,
        { dotfiles: "allow", headers: { "Content-Type": "application/octet-stream" } },
        (err?: Error) => {
            // The record exists but the file is gone from disk (a client that hung up needs no answer)
            if (err && !res.headersSent) res.status(404).json({ error: "File not found" });
        }
    );
};

/** POST /jobs/:id/heartbeat : the worker is still alive (204), or the job is gone (410) */
export const heartbeat = async (req: Request, res: Response) => {
    if (!(await service.heartbeat(req.params.id as string))) return res.status(410).json(GONE);
    res.status(204).end();
};

/** PUT /jobs/:id/files/:name : receives one Parquet file as the raw request body, whose Content-Length must be sent (204) */
export const uploadFile = async (req: Request, res: Response) => {
    try {
        await service.receiveFile(
            req.params.id as string,
            req.params.name as string,
            req,
            Number(req.headers["content-length"] ?? NaN)
        );
        res.status(204).end();
    } catch (err) {
        if (!(err instanceof service.UploadError)) throw err;
        // The unread rest of a refused body is dropped with the connection
        res.status(err.status).set("Connection", "close").json({ error: err.message });
    }
};

/** POST /jobs/:id/complete : every file has been sent; the Parquet folder is published and the dataset becomes READY (204), 409 if files are missing, 410 if gone */
export const complete = async (req: Request, res: Response) => {
    const problem = await service.complete(req.params.id as string);
    if (problem === "gone") return res.status(410).json(GONE);
    if (problem) return res.status(409).json({ error: problem });
    res.status(204).end();
};

/** POST /jobs/:id/fail : the job could not be processed; body { message } is shown (with paths cut down) as the dataset's failure (204, or 410 if gone) */
export const fail = async (req: Request, res: Response) => {
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    if (!(await service.fail(req.params.id as string, message))) return res.status(410).json(GONE);
    res.status(204).end();
};

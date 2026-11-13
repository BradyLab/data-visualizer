// A small real Express app with the large-memory worker's routes (the real router, middleware and services), for the HTTP tests of /api/worker
// and for running shiny/preprocess/cluster/cluster-worker.sh against. The Postgres rate limit store is replaced with counters in memory; the models are
// stubbed by the test (fixtures/fakeRemoteDb.ts)
import { mock } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { PostgresStore } from "@src/middleware/rateLimitStore.ts";
import workerRouter from "@src/routers/worker.ts";

const hits = new Map<string, number>();
const resetTime = new Date(Date.now() + 15 * 60 * 1000);
const key = (store: PostgresStore, k: string) => `${store.prefix}:${k}`;

mock.method(PostgresStore.prototype, "increment", async function (this: PostgresStore, k: string) {
    const total = (hits.get(key(this, k)) ?? 0) + 1;
    hits.set(key(this, k), total);
    return { totalHits: total, resetTime };
});
mock.method(PostgresStore.prototype, "decrement", async function (this: PostgresStore, k: string) {
    hits.set(key(this, k), Math.max(0, (hits.get(key(this, k)) ?? 0) - 1));
});
mock.method(PostgresStore.prototype, "get", async function (this: PostgresStore, k: string) {
    const totalHits = hits.get(key(this, k));
    return totalHits === undefined ? undefined : { totalHits, resetTime };
});

/** Failed-attempt counters start from zero again */
export const resetLimits = () => hits.clear();

/** Starts the app on a free port; close() stops it */
export const startWorkerApp = async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/worker", workerRouter);
    // Same last resort as index.ts: an unexpected error is a 500, not a hung request
    app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
        console.error("[TEST APP] Unhandled error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    });
    const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    return {
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
};

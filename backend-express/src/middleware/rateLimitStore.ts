// express-rate-limit store that keeps counters in the RateLimits table, so limits survive restarts and are shared across instances
import type { ClientRateLimitInfo, IncrementResponse, Options, Store } from "express-rate-limit";
import { QueryTypes } from "sequelize";
import { sequelize } from "@src/database.ts";

// Row shape returned by the increment/get queries
type Row = { hits: number; reset_time: Date };

// Rate limit store backed by Postgres; implements express-rate-limit's Store interface
export class PostgresStore implements Store {
    // Keys live in a shared table, so each limiter needs its own prefix or they would count each other's hits
    readonly prefix: string;
    // Counters in the database are visible to every instance (lets express-rate-limit skip its in-memory double-count check)
    readonly localKeys = false;
    private windowMs = 15 * 60 * 1000;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    private key(key: string) {
        return `${this.prefix}:${key}`;
    }

    // Takes the window length from the limiter and starts deleting expired rows once per window
    init(options: Options) {
        this.windowMs = options.windowMs;
        this.cleanupTimer = setInterval(() => {
            sequelize
                .query(`DELETE FROM "RateLimits" WHERE reset_time <= NOW()`)
                .catch((e) => console.error("[RATE LIMIT STORE] Cleanup failed", e));
        }, this.windowMs);
        this.cleanupTimer.unref(); // do not keep the process alive just for cleanup
    }

    // Looks up a client's current counter; an expired window counts as none
    async get(key: string): Promise<ClientRateLimitInfo | undefined> {
        const [row] = await sequelize.query<Row>(
            `SELECT hits, reset_time FROM "RateLimits" WHERE key = :key AND reset_time > NOW()`,
            { replacements: { key: this.key(key) }, type: QueryTypes.SELECT }
        );
        return row ? { totalHits: row.hits, resetTime: new Date(row.reset_time) } : undefined;
    }

    // Adds one hit in a single atomic statement, starting a new window if the old one expired
    async increment(key: string): Promise<IncrementResponse> {
        const [row] = await sequelize.query<Row>(
            `INSERT INTO "RateLimits" (key, hits, reset_time)
             VALUES (:key, 1, NOW() + (:windowMs * INTERVAL '1 millisecond'))
             ON CONFLICT (key) DO UPDATE SET
                 hits = CASE WHEN "RateLimits".reset_time <= NOW() THEN 1 ELSE "RateLimits".hits + 1 END,
                 reset_time = CASE WHEN "RateLimits".reset_time <= NOW()
                     THEN NOW() + (:windowMs * INTERVAL '1 millisecond') ELSE "RateLimits".reset_time END
             RETURNING hits, reset_time`,
            { replacements: { key: this.key(key), windowMs: this.windowMs }, type: QueryTypes.SELECT }
        );
        return { totalHits: row!.hits, resetTime: new Date(row!.reset_time) };
    }

    // Takes one hit back (used when skipSuccessfulRequests refunds a successful login)
    async decrement(key: string) {
        await sequelize.query(`UPDATE "RateLimits" SET hits = GREATEST(hits - 1, 0) WHERE key = :key`, {
            replacements: { key: this.key(key) },
        });
    }

    // Forgets one client's counter
    async resetKey(key: string) {
        await sequelize.query(`DELETE FROM "RateLimits" WHERE key = :key`, { replacements: { key: this.key(key) } });
    }

    // Clears only this limiter's counters, not the other limiters' (they share the table)
    async resetAll() {
        await sequelize.query(`DELETE FROM "RateLimits" WHERE key LIKE :pattern`, {
            replacements: { pattern: `${this.prefix.replace(/[\\%_]/g, "\\$&")}:%` },
        });
    }

    // Stops the cleanup timer
    shutdown() {
        clearInterval(this.cleanupTimer);
    }
}

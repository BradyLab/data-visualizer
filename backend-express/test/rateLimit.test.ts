// Tests for the login and password-change limiters (middleware/rateLimit) behind a small real Express app. The Postgres store is replaced
// with counters in memory, so these check what the limiters count and for whom, not the SQL (see rateLimitStore.test.ts)
import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { PostgresStore } from "@src/middleware/rateLimitStore.ts";
import { changePasswordLimiter, loginAccountLimiter, loginIpLimiter } from "@src/middleware/rateLimit.ts";

const hits = new Map<string, number>();
const resetTime = new Date(Date.now() + 15 * 60 * 1000);
const key = (store: PostgresStore, k: string) => `${store.prefix}:${k}`;

// Same behavior as the real store, minus the database
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

let server: Server;
let base: string;
before(async () => {
    const app = express();
    app.use(express.json());
    // The password is "right" or not; successful requests must not use up the budget
    app.post("/login", loginIpLimiter, loginAccountLimiter, (req, res) =>
        req.body.password === "right" ? res.json({ ok: true }) : res.status(401).json({ error: "Invalid credentials" })
    );
    app.post(
        "/password",
        (req, res, next) => {
            res.locals.user = req.headers["x-user"] ? { id: String(req.headers["x-user"]) } : undefined;
            next();
        },
        changePasswordLimiter,
        (req, res) => (req.body.password === "right" ? res.json({ ok: true }) : res.status(400).json({ error: "Wrong password" }))
    );
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());
afterEach(() => hits.clear());

const post = (path: string, body: object, headers: Record<string, string> = {}) =>
    fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
const login = (email: string, password = "wrong") => post("/login", { email, password });

test("an account is limited after 5 failed logins, whatever the casing of the email", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await login(i % 2 ? "A@x.org" : " a@x.org ")).status, 401);
    const blocked = await login("a@X.org", "right"); // even the right password is refused now
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many login attempts. Please try again later." });
    assert.ok(blocked.headers.get("retry-after"));
    // another account from the same address is not affected
    assert.equal((await login("b@x.org")).status, 401);
});

test("successful logins do not use up the budget", async () => {
    for (let i = 0; i < 12; i++) assert.equal((await login("a@x.org", "right")).status, 200);
    assert.equal((await login("a@x.org")).status, 401);
});

test("an address is limited after 10 failed logins, even for different accounts", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login(`user${i}@x.org`)).status, 401);
    assert.equal((await login("fresh@x.org")).status, 429);
});

test("a body without an email falls back to counting by address", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await post("/login", { password: "wrong" })).status, 401);
    assert.equal((await post("/login", { password: "wrong" })).status, 429);
    assert.equal((await post("/login", { email: 42, password: "wrong" })).status, 429);
});

test("password changes are limited per user after 5 failures", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await post("/password", { password: "wrong" }, { "x-user": "u1" })).status, 400);
    const blocked = await post("/password", { password: "right" }, { "x-user": "u1" });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many password change attempts. Please try again later." });
    assert.equal((await post("/password", { password: "wrong" }, { "x-user": "u2" })).status, 400);
});

test("the limiters count in separate namespaces", async () => {
    for (let i = 0; i < 5; i++) await post("/password", { password: "wrong" }, { "x-user": "a@x.org" });
    assert.equal((await login("a@x.org")).status, 401);
});

// Unit tests for PostgresStore: the SQL calls are stubbed, so these check the keys and parameters it sends
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { sequelize } from "@src/database.ts";
import { PostgresStore } from "@src/middleware/rateLimitStore.ts";

afterEach(() => mock.restoreAll());

// Stubs sequelize.query, returning `rows` and recording each call's options
const stubQuery = (rows: unknown[] = []) => {
    const stub = mock.method(sequelize, "query", async () => rows as never);
    return () => stub.mock.calls.map((c) => c.arguments[1] as { replacements: Record<string, unknown> });
};

test("keys are namespaced with the limiter's prefix", async () => {
    const calls = stubQuery([]);
    await new PostgresStore("login").get("1.2.3.4");
    assert.equal(calls()[0]!.replacements.key, "login:1.2.3.4");
});

test("get returns undefined when there is no live window", async () => {
    stubQuery([]);
    assert.equal(await new PostgresStore("p").get("k"), undefined);
});

test("get maps the row to totalHits and resetTime", async () => {
    const reset = new Date(Date.now() + 1000);
    stubQuery([{ hits: 3, reset_time: reset }]);
    assert.deepEqual(await new PostgresStore("p").get("k"), { totalHits: 3, resetTime: reset });
});

test("increment uses the window length from init and returns the new count", async () => {
    const reset = new Date();
    const calls = stubQuery([{ hits: 1, reset_time: reset }]);
    const store = new PostgresStore("p");
    store.init({ windowMs: 60_000 } as never);
    try {
        assert.deepEqual(await store.increment("k"), { totalHits: 1, resetTime: reset });
        assert.equal(calls()[0]!.replacements.windowMs, 60_000);
    } finally {
        store.shutdown();
    }
});

test("resetAll escapes LIKE wildcards in the prefix", async () => {
    const calls = stubQuery();
    await new PostgresStore("a_b%c").resetAll();
    assert.equal(calls()[0]!.replacements.pattern, "a\\_b\\%c:%");
});

test("resetKey and decrement target only the namespaced key", async () => {
    const calls = stubQuery();
    const store = new PostgresStore("p");
    await store.resetKey("k");
    await store.decrement("k");
    assert.deepEqual(
        calls().map((c) => c.replacements.key),
        ["p:k", "p:k"]
    );
});

// Unit tests for utils/pick
import { test } from "node:test";
import assert from "node:assert/strict";
import { pick } from "@src/utils/pick.ts";

type Body = { a: number; b: string; c: boolean };

test("pick copies only whitelisted keys", () => {
    assert.deepEqual(pick<Body>({ a: 1, b: "x", c: true, admin: true }, ["a", "b"]), { a: 1, b: "x" });
});

test("pick skips undefined values but keeps falsy ones", () => {
    assert.deepEqual(pick<Body>({ a: 0, b: "", c: undefined }, ["a", "b", "c"]), { a: 0, b: "" });
});

test("pick treats null and undefined bodies as empty", () => {
    assert.deepEqual(pick<Body>(null, ["a"]), {});
    assert.deepEqual(pick<Body>(undefined, ["a"]), {});
});

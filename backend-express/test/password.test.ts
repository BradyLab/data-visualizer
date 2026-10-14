// Unit tests for password hashing and the JWT helpers in services/auth
import { test, before } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { generatePassword, hashPassword } from "@src/utils/password.ts";
import {
    passwordVersion,
    signToken,
    verifyToken,
    signDownloadToken,
    verifyDownloadToken,
} from "@src/services/auth.ts";

before(() => {
    process.env.JWT_SECRET = "test-secret";
});

test("hashPassword produces salt:hash hex with a fresh salt each time", async () => {
    const a = await hashPassword("hunter2");
    const b = await hashPassword("hunter2");
    assert.match(a, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.notEqual(a, b);
});

test("passwordVersion is stable and depends on the stored hash", () => {
    assert.equal(passwordVersion("x"), passwordVersion("x"));
    assert.notEqual(passwordVersion("x"), passwordVersion("y"));
    assert.equal(passwordVersion("x").length, 16);
});

test("login token round-trips id and password version", () => {
    const token = signToken("user-1", "stored-hash");
    const result = verifyToken(token);
    assert.equal(result?.id, "user-1");
    assert.equal(result?.pv, passwordVersion("stored-hash"));
    assert.ok(result?.exp);
});

test("signToken throws without JWT_SECRET", () => {
    const secret = process.env.JWT_SECRET;
    delete (process.env as Record<string, string | undefined>).JWT_SECRET;
    try {
        assert.throws(() => signToken("u", "h"), /JWT_SECRET/);
    } finally {
        process.env.JWT_SECRET = secret;
    }
});

test("verifyToken rejects garbage, wrong secrets and expired tokens", () => {
    assert.equal(verifyToken("not-a-token"), null);
    assert.equal(verifyToken(jwt.sign({ id: "u", pv: "p" }, "other-secret")), null);
    assert.equal(verifyToken(jwt.sign({ id: "u", pv: "p" }, "test-secret", { expiresIn: -10 })), null);
});

test("verifyToken rejects tokens missing id or pv", () => {
    assert.equal(verifyToken(jwt.sign({ id: "u" }, "test-secret")), null);
});

test("download token round-trips file and user", () => {
    assert.deepEqual(verifyDownloadToken(signDownloadToken("file-1", "user-1")), { file: "file-1", user: "user-1" });
});

test("login and download tokens are not interchangeable", () => {
    assert.equal(verifyDownloadToken(signToken("u", "h")), null);
    assert.equal(verifyToken(signDownloadToken("f", "u")), null);
});

test("generatePassword returns the requested length from the unambiguous alphabet, and differs each time", () => {
    const a = generatePassword();
    assert.match(a, /^[A-HJ-NP-Za-km-z2-9]{16}$/);
    assert.equal(generatePassword(24).length, 24);
    assert.notEqual(a, generatePassword());
});

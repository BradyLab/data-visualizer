// Tests for the startup checks of secrets and the default password (services/startupChecks); the user lookup is stubbed
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { UserStatus } from "@commons/user.ts";
import { Users } from "@src/models/user.ts";
import { hashPassword } from "@src/utils/password.ts";
import {
    accountsOnDefaultPassword,
    defaultPasswordProblems,
    isProduction,
    secretProblems,
    secretsBlockStartup,
    warnAboutDefaultPassword,
} from "@src/services/startupChecks.ts";

afterEach(() => mock.restoreAll());

const strong = "k3j9x0a7q1w5e8r2t6y4u0i3o9p1a5s7d2f4g6h8j0k2l4z6x8c0v2b4n6m8q1w3";
const other = "z".repeat(10) + "Q9" + "m".repeat(30) + "7";

test("strong, different secrets are fine, and SHINY_SECRET is optional", () => {
    assert.deepEqual(secretProblems({ JWT_SECRET: strong, SHINY_SECRET: other }), []);
    assert.deepEqual(secretProblems({ JWT_SECRET: strong }), []);
});

test("placeholder and short secrets are reported by name", () => {
    assert.deepEqual(secretProblems({ JWT_SECRET: "change-me", SHINY_SECRET: "change-me-too" }), [
        "JWT_SECRET is a placeholder value",
        "SHINY_SECRET is a placeholder value",
    ]);
    assert.deepEqual(secretProblems({ JWT_SECRET: "Secret" }), ["JWT_SECRET is a placeholder value"]);
    assert.deepEqual(secretProblems({ JWT_SECRET: "e2e-only-secret" }), ["JWT_SECRET is shorter than 32 characters"]);
    assert.deepEqual(secretProblems({ JWT_SECRET: strong, SHINY_SECRET: "short" }), ["SHINY_SECRET is shorter than 32 characters"]);
});

test("one value must not serve as both secrets", () => {
    assert.deepEqual(secretProblems({ JWT_SECRET: strong, SHINY_SECRET: strong }), ["JWT_SECRET and SHINY_SECRET are the same"]);
});

test("weak secrets stop a production start and only warn otherwise", () => {
    const warn = mock.method(console, "warn", () => {});
    const error = mock.method(console, "error", () => {});
    const weak = { JWT_SECRET: "change-me" };
    assert.equal(secretsBlockStartup({ ...weak }), false);
    assert.equal(warn.mock.calls.length, 1);
    assert.equal(error.mock.calls.length, 0);
    assert.equal(secretsBlockStartup({ ...weak, NODE_ENV: "production" }), true);
    assert.match(String(error.mock.calls[0]!.arguments[0]), /JWT_SECRET is a placeholder value/);
    assert.match(String(error.mock.calls[1]!.arguments[0]), /refusing to start/);
    assert.equal(secretsBlockStartup({ JWT_SECRET: strong, NODE_ENV: "production" }), false);
    assert.equal(isProduction({ NODE_ENV: "production" }), true);
    assert.equal(isProduction({ NODE_ENV: "development" }), false);
    assert.equal(isProduction({}), false);
});

test("a weak DEFAULT_PASSWORD is reported, an unset one is not", () => {
    assert.deepEqual(defaultPasswordProblems({}), []);
    assert.deepEqual(defaultPasswordProblems({ DEFAULT_PASSWORD: "change-me" }), ["DEFAULT_PASSWORD is a placeholder value"]);
    assert.match(defaultPasswordProblems({ DEFAULT_PASSWORD: "abc" })[0]!, /DEFAULT_PASSWORD is shorter than \d+ characters/);
    assert.deepEqual(defaultPasswordProblems({ DEFAULT_PASSWORD: "a-good-long-starting-password" }), []);
});

const stubUsers = async (rows: { email: string; status: UserStatus; password: string }[]) => {
    mock.method(Users, "findAll", async () => rows as never);
};

test("accounts still on the default password are found by checking the stored hashes", async () => {
    const env = { DEFAULT_PASSWORD: "the-default-password" };
    await stubUsers([
        { email: "a@x.org", status: UserStatus.INVITED, password: await hashPassword("the-default-password") },
        { email: "b@x.org", status: UserStatus.ACTIVE, password: await hashPassword("changed-by-the-user") },
        { email: "c@x.org", status: UserStatus.ACTIVE, password: await hashPassword("the-default-password") },
    ]);
    assert.deepEqual(await accountsOnDefaultPassword(env), [
        { email: "a@x.org", status: UserStatus.INVITED },
        { email: "c@x.org", status: UserStatus.ACTIVE },
    ]);
    assert.deepEqual(await accountsOnDefaultPassword({}), []);
});

test("invited accounts on the default password give a warning, active ones an error", async () => {
    const warn = mock.method(console, "warn", () => {});
    const error = mock.method(console, "error", () => {});
    const hash = await hashPassword("the-default-password");
    await stubUsers([
        { email: "invited@x.org", status: UserStatus.INVITED, password: hash },
        { email: "active@x.org", status: UserStatus.ACTIVE, password: hash },
    ]);
    await warnAboutDefaultPassword({ DEFAULT_PASSWORD: "the-default-password" });
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /1 invited account\(s\).*invited@x\.org/);
    assert.match(String(error.mock.calls[0]!.arguments[0]), /active@x\.org \(ACTIVE\)/);
});

test("a failing user lookup is logged and does not throw", async () => {
    const error = mock.method(console, "error", () => {});
    mock.method(Users, "findAll", async () => {
        throw new Error("db down");
    });
    await warnAboutDefaultPassword({ DEFAULT_PASSWORD: "the-default-password" });
    assert.match(String(error.mock.calls[0]!.arguments[0]), /Could not check/);
});

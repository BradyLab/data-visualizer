// Tests for login and password changes (services/auth), the auth controller's input checks and the auth middleware; the user table is stubbed
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import * as service from "@src/services/auth.ts";
import * as controller from "@src/controllers/auth.ts";
import { optionalAuth, requireAuth, requireAuthAllowInvited, requireRole, requireSelfOrAdmin } from "@src/middleware/auth.ts";
import { Users } from "@src/models/user.ts";
import { hashPassword } from "@src/utils/password.ts";
import { PASSWORD_CHANGE_REQUIRED, MIN_PASSWORD_LENGTH } from "@commons/general.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { fakeReq, fakeRes } from "./fixtures/http.ts";

process.env.JWT_SECRET = "test-secret";
Reflect.deleteProperty(process.env, "DEFAULT_PASSWORD");

afterEach(() => mock.restoreAll());

// A stored user as the model returns it: the fields plus get() and update()
const makeUser = async (over: Record<string, unknown> = {}) => {
    const user: Record<string, unknown> = {
        id: "u1",
        email: "a@b.org",
        name: "A",
        role: UserRoles.LAB_MEMBER,
        status: UserStatus.ACTIVE,
        password: await hashPassword("correct horse"),
        ...over,
    };
    user.get = () => ({ ...user });
    user.update = async (fields: Record<string, unknown>) => Object.assign(user, fields);
    user.dataValues = user;
    return user;
};

test("login returns a token and the user without the password hash for the right credentials", async () => {
    const user = await makeUser();
    mock.method(Users, "findOne", async () => user);
    const result = await service.login(" A@B.org ", "correct horse");
    assert.ok(result);
    assert.equal("password" in result.user, false);
    assert.equal(result.user.id, "u1");
    assert.equal(service.verifyToken(result.token)?.id, "u1");
});

test("login gives the same null for a wrong password, an unknown email and an inactive user", async () => {
    mock.method(Users, "findOne", async () => makeUser());
    assert.equal(await service.login("a@b.org", "wrong"), null);
    mock.restoreAll();
    mock.method(Users, "findOne", async () => null);
    assert.equal(await service.login("nobody@b.org", "correct horse"), null);
    mock.restoreAll();
    mock.method(Users, "findOne", async () => makeUser({ status: UserStatus.INACTIVE }));
    assert.equal(await service.login("a@b.org", "correct horse"), null);
});

test("login treats a corrupt stored hash as a failed login, not an error", async () => {
    mock.method(Users, "findOne", async () => makeUser({ password: "garbage" }));
    assert.equal(await service.login("a@b.org", "x"), null);
    mock.restoreAll();
    mock.method(Users, "findOne", async () => makeUser({ password: "salt:zz" }));
    assert.equal(await service.login("a@b.org", "x"), null);
});

test("a login token stops working when the password changes, and is signed with HS256 only", async () => {
    const token = service.signToken("u1", "hash-one");
    const payload = service.verifyToken(token)!;
    assert.equal(payload.pv, service.passwordVersion("hash-one"));
    assert.notEqual(payload.pv, service.passwordVersion("hash-two"));
    const wrongAlg = jwt.sign({ id: "u1", pv: "x" }, "test-secret", { algorithm: "HS512" });
    assert.equal(service.verifyToken(wrongAlg), null);
    assert.equal(service.verifyToken("nonsense"), null);
});

test("JWT_SECRET missing is an error, not an invalid token", () => {
    const secret = process.env.JWT_SECRET;
    Reflect.deleteProperty(process.env, "JWT_SECRET");
    try {
        assert.throws(() => service.verifyToken("x"), /JWT_SECRET is not set/);
        assert.throws(() => service.signToken("u1", "h"), /JWT_SECRET is not set/);
    } finally {
        process.env.JWT_SECRET = secret;
    }
});

test("the token lifetime comes from JWT_EXPIRES_IN", () => {
    process.env.JWT_EXPIRES_IN = "90s";
    const { exp, iat } = jwt.decode(service.signToken("u1", "h")) as { exp: number; iat: number };
    delete process.env.JWT_EXPIRES_IN;
    assert.equal(exp - iat, 90);
});

test("download tokens carry the file and user, and are not login tokens", () => {
    const token = service.signDownloadToken("f1", "u1");
    assert.deepEqual(service.verifyDownloadToken(token), { file: "f1", user: "u1" });
    assert.equal(service.verifyToken(token), null);
    assert.equal(service.verifyDownloadToken(service.signToken("u1", "h")), null);
    assert.equal(service.verifyDownloadToken("x"), null);
});

test("changePassword activates an invited user, stores a new hash and returns a token tied to it", async () => {
    const user = await makeUser({ status: UserStatus.INVITED });
    const oldHash = user.password;
    mock.method(Users, "findByPk", async () => user);
    const token = await service.changePassword("u1", "correct horse", "a brand new password");
    assert.ok(token);
    assert.equal(user.status, UserStatus.ACTIVE);
    assert.notEqual(user.password, oldHash);
    assert.equal(service.verifyToken(token)?.pv, service.passwordVersion(user.password as string));
});

test("changePassword changes nothing when the old password is wrong or the user is gone", async () => {
    const user = await makeUser();
    const oldHash = user.password;
    mock.method(Users, "findByPk", async () => user);
    assert.equal(await service.changePassword("u1", "wrong", "a brand new password"), null);
    assert.equal(user.password, oldHash);
    mock.restoreAll();
    mock.method(Users, "findByPk", async () => null);
    assert.equal(await service.changePassword("u1", "x", "y"), null);
});

// ---- controller input checks (they answer before touching the database) ----

test("the login controller needs a string email and password", async () => {
    for (const body of [undefined, {}, { email: "a@b.org" }, { email: 1, password: "x" }, { email: "a@b.org", password: ["x"] }]) {
        const res = fakeRes();
        await controller.login(fakeReq({ body }), res as never);
        assert.equal(res.statusCode, 400);
    }
});

test("the login controller answers 401 for bad credentials and 200 with the result otherwise", async () => {
    mock.method(Users, "findOne", async () => null);
    const bad = fakeRes();
    await controller.login(fakeReq({ body: { email: "a@b.org", password: "x" } }), bad as never);
    assert.equal(bad.statusCode, 401);
    mock.restoreAll();
    mock.method(Users, "findOne", async () => makeUser());
    const good = fakeRes();
    await controller.login(fakeReq({ body: { email: "a@b.org", password: "correct horse" } }), good as never);
    assert.equal(good.statusCode, 200);
    assert.ok((good.body as { token: string }).token);
});

test("the change-password controller rejects missing, short, unchanged and default passwords", async () => {
    const user = { id: "u1", status: UserStatus.ACTIVE };
    const attempt = async (body: unknown) => {
        const res = fakeRes({ user });
        await controller.changePassword(fakeReq({ body }), res as never);
        return res;
    };
    assert.equal((await attempt({})).statusCode, 400);
    assert.equal((await attempt({ oldPassword: "a", newPassword: "" })).statusCode, 400);
    const short = await attempt({ oldPassword: "a", newPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1) });
    assert.match((short.body as { error: string }).error, /at least/);
    const same = "x".repeat(MIN_PASSWORD_LENGTH);
    assert.match(((await attempt({ oldPassword: same, newPassword: same })).body as { error: string }).error, /different/);
    process.env.DEFAULT_PASSWORD = "the-default-password";
    try {
        const reused = await attempt({ oldPassword: "a", newPassword: "the-default-password" });
        assert.match((reused.body as { error: string }).error, /default password/);
    } finally {
        Reflect.deleteProperty(process.env, "DEFAULT_PASSWORD");
    }
});

test("the change-password controller answers 403 when the old password is wrong", async () => {
    mock.method(Users, "findByPk", async () => makeUser());
    const res = fakeRes({ user: { id: "u1", status: UserStatus.ACTIVE } });
    await controller.changePassword(fakeReq({ body: { oldPassword: "wrong", newPassword: "x".repeat(MIN_PASSWORD_LENGTH + 2) } }), res as never);
    assert.equal(res.statusCode, 403);
});

test("logout answers 204", () => {
    const res = fakeRes({ user: { id: "u1" } });
    controller.logout(fakeReq(), res as never);
    assert.equal(res.statusCode, 204);
});

// ---- middleware ----

// Runs a middleware and reports whether it let the request through
const run = async (middleware: (...args: never[]) => unknown, headers: Record<string, string> = {}, locals: Record<string, unknown> = {}) => {
    const res = fakeRes(locals);
    let passed = false;
    await middleware(fakeReq({ headers }) as never, res as never, (() => (passed = true)) as never);
    return { res, passed };
};

// The stored user behind a valid token
const loggedIn = async (over: Record<string, unknown> = {}) => {
    const user = await makeUser(over);
    // A fresh copy per lookup: the middleware strips the hash from the instance it is given
    mock.method(Users, "findByPk", async () => ({ ...user, dataValues: { ...user } }));
    return { Authorization: `Bearer ${service.signToken("u1", user.password as string)}` };
};

test("requireAuth lets an active user through and puts them in res.locals without the hash", async () => {
    const headers = await loggedIn();
    const { res, passed } = await run(requireAuth, { authorization: headers.Authorization! });
    assert.ok(passed);
    assert.equal((res.locals.user as { id: string }).id, "u1");
    assert.equal("password" in (res.locals.user as { dataValues: object }).dataValues, false);
});

test("requireAuth answers 401 without a token, with a bad one, for an inactive user and after a password change", async () => {
    assert.equal((await run(requireAuth)).res.statusCode, 401);
    assert.equal((await run(requireAuth, { authorization: "Bearer nope" })).res.statusCode, 401);
    assert.equal((await run(requireAuth, { authorization: "Basic abc" })).res.statusCode, 401);
    const headers = await loggedIn({ status: UserStatus.INACTIVE });
    assert.equal((await run(requireAuth, { authorization: headers.Authorization! })).res.statusCode, 401);
    // The token was made for the old hash
    const old = service.signToken("u1", "old-hash");
    mock.restoreAll();
    mock.method(Users, "findByPk", async () => makeUser());
    assert.equal((await run(requireAuth, { authorization: `Bearer ${old}` })).res.statusCode, 401);
    // And for a user that no longer exists
    mock.restoreAll();
    mock.method(Users, "findByPk", async () => null);
    assert.equal((await run(requireAuth, { authorization: `Bearer ${old}` })).res.statusCode, 401);
});

test("an invited user gets 403 with the password-change code, except where invited users are allowed", async () => {
    const headers = await loggedIn({ status: UserStatus.INVITED });
    const blocked = await run(requireAuth, { authorization: headers.Authorization! });
    assert.equal(blocked.res.statusCode, 403);
    assert.equal((blocked.res.body as { code: string }).code, PASSWORD_CHANGE_REQUIRED);
    assert.ok((await run(requireAuthAllowInvited, { authorization: headers.Authorization! })).passed);
});

test("optionalAuth treats no header as a guest, a bad token as 401, and an invited user as a guest", async () => {
    const guest = await run(optionalAuth);
    assert.ok(guest.passed);
    assert.equal(guest.res.locals.user, null);
    assert.equal((await run(optionalAuth, { authorization: "Bearer nope" })).res.statusCode, 401);
    const invited = await loggedIn({ status: UserStatus.INVITED });
    const asGuest = await run(optionalAuth, { authorization: invited.Authorization! });
    assert.ok(asGuest.passed);
    assert.equal(asGuest.res.locals.user, null);
    mock.restoreAll();
    const active = await loggedIn();
    assert.equal(((await run(optionalAuth, { authorization: active.Authorization! })).res.locals.user as { id: string }).id, "u1");
    mock.restoreAll();
    const inactive = await loggedIn({ status: UserStatus.INACTIVE });
    assert.equal((await run(optionalAuth, { authorization: inactive.Authorization! })).res.statusCode, 401);
});

test("requireRole and requireSelfOrAdmin check the logged-in user", async () => {
    const asAdmin = { user: { id: "a", role: UserRoles.ADMIN } };
    const asLab = { user: { id: "l", role: UserRoles.LAB_MEMBER } };
    assert.ok((await run(requireRole(UserRoles.ADMIN) as never, {}, asAdmin)).passed);
    assert.equal((await run(requireRole(UserRoles.ADMIN) as never, {}, asLab)).res.statusCode, 403);
    assert.ok((await run(requireRole(UserRoles.ADMIN, UserRoles.LAB_MEMBER) as never, {}, asLab)).passed);
    const self = (locals: Record<string, unknown>, id: string) => {
        const res = fakeRes(locals);
        let passed = false;
        requireSelfOrAdmin("userId")(fakeReq({ params: { userId: id } }), res as never, (() => (passed = true)) as never);
        return { res, passed };
    };
    assert.ok(self(asLab, "l").passed);
    assert.equal(self(asLab, "other").res.statusCode, 403);
    assert.ok(self(asAdmin, "other").passed);
});

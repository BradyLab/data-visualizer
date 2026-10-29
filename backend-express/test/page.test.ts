// Tests for the page controller and router: who may read and change a page, and what is refused.
// The model is stubbed, so no database is needed
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { ActivityType } from "@commons/activity.ts";
import { MAX_PAGE_LENGTH } from "@commons/page.ts";
import { UserRoles, UserStatus } from "@commons/user.ts";
import { fakeReq, fakeRes } from "./fixtures/http.ts";

process.env.JWT_SECRET = "test-secret";
const page = await import("@src/controllers/page.ts");
const { Pages } = await import("@src/models/page.ts");
const { Activities } = await import("@src/models/activity.ts");
const pageRouter = (await import("@src/routers/page.ts")).default;
const { requireRole } = await import("@src/middleware/auth.ts");

// The saved row, or null while the page has never been saved
let saved: { slug: string; content: string; updatedAt: Date | null } | null;
// What was written to the activity log
let logged: Array<{ user_id: string | null; type: string; data: Record<string, unknown> }>;

beforeEach(() => {
    saved = null;
    logged = [];
    mock.method(Activities, "create", async (entry: (typeof logged)[number]) => {
        logged.push(entry);
        return { get: () => entry };
    });
    mock.method(Pages, "findByPk", async () =>
        saved ? { ...saved, update: async (f: { content: string }) => (saved = { ...saved!, ...f, updatedAt: new Date() }) } : null
    );
    mock.method(Pages, "create", async (f: { slug: string; content: string }) => (saved = { ...f, updatedAt: null }));
    // Quiet output; the controllers log every request
    mock.method(console, "log", () => {});
});
afterEach(() => mock.restoreAll());

const call = async (handler: (req: never, res: never) => unknown, req: Parameters<typeof fakeReq>[0] = {}) => {
    const res = fakeRes({ user: { id: "admin" } });
    await handler(fakeReq(req), res as never);
    return res;
};

test("get answers an unsaved page with empty content and no date, so the frontend shows its built-in text", async () => {
    const res = await call(page.get, { params: { slug: "about" } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { slug: "about", content: "", updatedAt: null });
});

test("get returns the saved content", async () => {
    saved = { slug: "about", content: "# Hello", updatedAt: new Date(0) };
    const res = await call(page.get, { params: { slug: "about" } });
    assert.deepEqual(res.body, { slug: "about", content: "# Hello", updatedAt: new Date(0) });
});

test("get and update answer 404 for a slug that is not an editable page", async () => {
    assert.equal((await call(page.get, { params: { slug: "secrets" } })).statusCode, 404);
    assert.equal((await call(page.update, { params: { slug: "secrets" }, body: { content: "x" } })).statusCode, 404);
});

test("update creates the page the first time and replaces its content afterwards", async () => {
    const first = await call(page.update, { params: { slug: "about" }, body: { content: "one" } });
    assert.equal(first.statusCode, 200);
    assert.equal(saved?.content, "one");
    const second = await call(page.update, { params: { slug: "about" }, body: { content: "two" } });
    assert.equal(second.statusCode, 200);
    assert.equal((second.body as { content: string }).content, "two");
    assert.equal(saved?.content, "two");
});

test("update logs who changed the page, with the text before and after, and skips a save that changes nothing", async () => {
    await call(page.update, { params: { slug: "about" }, body: { content: "one" } });
    await call(page.update, { params: { slug: "about" }, body: { content: "two" } });
    await call(page.update, { params: { slug: "about" }, body: { content: "two" } });
    assert.equal(logged.length, 2);
    assert.deepEqual(logged[1], {
        user_id: "admin",
        type: ActivityType.PAGE_UPDATED,
        data: { slug: "about", changes: { content: { before: "one", after: "two" } } },
    });
    assert.deepEqual((logged[0]!.data.changes as Record<string, unknown>).content, { before: "", after: "one" });
});

test("update does not log a refused save", async () => {
    await call(page.update, { params: { slug: "about" }, body: {} });
    assert.deepEqual(logged, []);
});

test("update accepts an empty page, which brings back the built-in text", async () => {
    assert.equal((await call(page.update, { params: { slug: "about" }, body: { content: "" } })).statusCode, 200);
});

test("update refuses content that is not text or is too long", async () => {
    assert.equal((await call(page.update, { params: { slug: "about" }, body: {} })).statusCode, 400);
    assert.equal((await call(page.update, { params: { slug: "about" }, body: { content: 5 } })).statusCode, 400);
    assert.equal((await call(page.update, { params: { slug: "about" }, body: { content: "x".repeat(MAX_PAGE_LENGTH + 1) } })).statusCode, 400);
    assert.equal(saved, null);
    assert.equal((await call(page.update, { params: { slug: "about" }, body: { content: "x".repeat(MAX_PAGE_LENGTH) } })).statusCode, 200);
});

// The router's routes in order: [method, path, middleware names...]
const routes = pageRouter.stack.map((layer) => {
    const route = (layer as unknown as { route: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } }).route;
    return { path: route.path, method: Object.keys(route.methods)[0], handlers: route.stack.map((s) => s.handle as (...a: never[]) => unknown) };
});

test("anyone may read a page, but writing needs a login and then an admin", () => {
    const read = routes.find((r) => r.method === "get")!;
    const write = routes.find((r) => r.method === "put")!;
    assert.equal(read.handlers.length, 1);
    // requireAuth, requireRole(ADMIN), the controller
    assert.equal(write.handlers.length, 3);
});

test("the admin check on the write route refuses lab members, external users and guests", () => {
    const check = requireRole(UserRoles.ADMIN);
    const run = (user: { role: UserRoles; status: UserStatus }) => {
        const res = fakeRes({ user });
        let passed = false;
        check(fakeReq() as never, res as never, () => (passed = true));
        return { passed, status: res.statusCode };
    };
    assert.deepEqual(run({ role: UserRoles.ADMIN, status: UserStatus.ACTIVE }), { passed: true, status: 200 });
    assert.deepEqual(run({ role: UserRoles.LAB_MEMBER, status: UserStatus.ACTIVE }), { passed: false, status: 403 });
    assert.deepEqual(run({ role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE }), { passed: false, status: 403 });
});

// Unit tests for the invite email: skipped without config, never throws, and sends the right payload to EmailJS
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isNoticeConfigured, sendInviteEmail, sendNotice } from "@src/services/email.ts";

const invite = { name: "New User", email: "new@example.com", invitedBy: { name: "Ada Admin", email: "ada@example.com" } };
const KEYS = ["EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"] as const;
const realFetch = globalThis.fetch;
const realNodeEnv = process.env.NODE_ENV;

// `npm test` runs with NODE_ENV=test, which disables sending; these tests turn it back on but only ever against a mocked fetch
beforeEach(() => {
    process.env.NODE_ENV = "development";
    delete process.env.EMAIL_DISABLED;
    process.env.FRONTEND_URL = "https://viz.example.com";
    for (const key of KEYS) process.env[key] = `test-${key}`;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    process.env.NODE_ENV = realNodeEnv;
    delete process.env.EMAIL_DISABLED;
});

test("sendInviteEmail makes no request under NODE_ENV=test or EMAIL_DISABLED, even when fully configured", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return new Response("ok");
    }) as typeof fetch;
    process.env.NODE_ENV = "test";
    assert.equal(await sendInviteEmail(invite), false);
    process.env.NODE_ENV = "development";
    process.env.EMAIL_DISABLED = "true";
    assert.equal(await sendInviteEmail(invite), false);
    assert.equal(calls, 0);
});

test("sendInviteEmail does nothing and returns false when EmailJS is not configured", async () => {
    delete process.env.EMAILJS_PRIVATE_KEY;
    let called = false;
    globalThis.fetch = (async () => {
        called = true;
        return new Response("ok");
    }) as typeof fetch;
    assert.equal(await sendInviteEmail(invite), false);
    assert.equal(called, false);
});

test("sendInviteEmail posts the template variables and keys to EmailJS, with no password in them", async () => {
    let body: any;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response("OK", { status: 200 });
    }) as typeof fetch;
    assert.equal(await sendInviteEmail(invite), true);
    assert.equal(body.service_id, "test-EMAILJS_SERVICE_ID");
    assert.equal(body.accessToken, "test-EMAILJS_PRIVATE_KEY");
    assert.deepEqual(body.template_params, {
        invitee_name: "New User",
        invitee_email: "new@example.com",
        admin_name: "Ada Admin",
        admin_email: "ada@example.com",
    });
});

test("sendInviteEmail returns false, without throwing, when EmailJS refuses or the request fails", async () => {
    globalThis.fetch = (async () => new Response("bad key", { status: 403 })) as typeof fetch;
    assert.equal(await sendInviteEmail(invite), false);
    globalThis.fetch = (async () => {
        throw new Error("network down");
    }) as typeof fetch;
    assert.equal(await sendInviteEmail(invite), false);
});

// ---- notices to the lab (NOTIFY_EMAIL_TO, through a second EmailJS template) ----

const NOTICE_KEYS = ["EMAILJS_NOTIFY_TEMPLATE_ID", "NOTIFY_EMAIL_TO"] as const;
const configureNotices = () => {
    process.env.EMAILJS_NOTIFY_TEMPLATE_ID = "notice-template";
    process.env.NOTIFY_EMAIL_TO = "lab@example.org , boss@example.org,";
};
afterEach(() => {
    for (const key of NOTICE_KEYS) delete process.env[key];
});

test("sendNotice does nothing unless the notice template and a recipient are configured, or under NODE_ENV=test", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        return new Response("ok");
    }) as typeof fetch;
    assert.equal(isNoticeConfigured(), false);
    assert.equal(await sendNotice("s", "m"), false);
    process.env.EMAILJS_NOTIFY_TEMPLATE_ID = "notice-template"; // still no recipient
    assert.equal(await sendNotice("s", "m"), false);
    configureNotices();
    process.env.NODE_ENV = "test";
    assert.equal(await sendNotice("s", "m"), false);
    assert.equal(calls, 0);
});

test("sendNotice sends one message per recipient, with the notice template and its variables", async () => {
    configureNotices();
    const bodies: any[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return new Response("OK");
    }) as typeof fetch;
    assert.equal(isNoticeConfigured(), true);
    assert.equal(await sendNotice("Subject", "Body text"), true);
    assert.deepEqual(
        bodies.map((b) => b.template_params),
        [
            { to_email: "lab@example.org", subject: "Subject", message: "Body text" },
            { to_email: "boss@example.org", subject: "Subject", message: "Body text" },
        ]
    );
    assert.equal(bodies[0].template_id, "notice-template");
    assert.equal(bodies[0].accessToken, "test-EMAILJS_PRIVATE_KEY");
});

test("sendNotice returns false, without throwing, when a message is refused or fails, and still tries the other recipients", async () => {
    configureNotices();
    let calls = 0;
    globalThis.fetch = (async () => {
        calls++;
        if (calls === 1) throw new Error("network down");
        return new Response("bad key", { status: 403 });
    }) as typeof fetch;
    assert.equal(await sendNotice("s", "m"), false);
    assert.equal(calls, 2);
});

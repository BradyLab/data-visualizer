// Unit tests for the invite email: skipped without config, never throws, and sends the right payload to EmailJS
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendInviteEmail } from "@src/services/email.ts";

const invite = { name: "New User", email: "new@example.com", invitedBy: { name: "Ada Admin", email: "ada@example.com" } };
const KEYS = ["EMAILJS_SERVICE_ID", "EMAILJS_TEMPLATE_ID", "EMAILJS_PUBLIC_KEY", "EMAILJS_PRIVATE_KEY"] as const;
const realFetch = globalThis.fetch;

beforeEach(() => {
    process.env.FRONTEND_URL = "https://viz.example.com";
    for (const key of KEYS) process.env[key] = `test-${key}`;
});

afterEach(() => {
    globalThis.fetch = realFetch;
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
        to_name: "New User",
        to_email: "new@example.com",
        invited_by_name: "Ada Admin",
        invited_by_email: "ada@example.com",
        login_url: "https://viz.example.com/login",
        reply_to: "ada@example.com",
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

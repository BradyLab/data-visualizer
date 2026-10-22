// Tests for the authenticating Shiny proxy (middleware/shinyProxy) in front of a fake Shiny server: the ticket -> cookie exchange,
// what is and is not forwarded, and the WebSocket upgrade check
import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.JWT_SECRET = "test-secret";
process.env.SHINY_SECRET = "shared";
process.env.FRONTEND_URL = "http://frontend.test";

// Plays Shiny: records the requests it gets and answers with headers the proxy must replace
const seen: { url?: string | undefined; headers: http.IncomingHttpHeaders }[] = [];
const shiny = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    res.writeHead(200, {
        "x-frame-options": "DENY",
        "content-security-policy": "frame-ancestors 'none'",
        "content-type": "text/plain",
    });
    res.end("shiny says hi");
});
shiny.on("upgrade", (req, socket) => {
    seen.push({ url: req.url, headers: req.headers });
    socket.end("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
});
await new Promise<void>((resolve) => shiny.listen(0, "127.0.0.1", resolve));
process.env.SHINY_URL = `http://127.0.0.1:${(shiny.address() as AddressInfo).port}`;

// Set up first: the proxy is only created when SHINY_URL and SHINY_SECRET are known at import
const { handleShinyUpgrade, shinyProxy, SHINY_PREFIX, VIEWER_TICKET_PARAM, SHINY_CONTEXT_PARAM } =
    await import("@src/middleware/shinyProxy.ts");
const { signViewerSession, signViewerTicket } = await import("@src/services/viewer.ts");
const { Datasets } = await import("@src/models/dataset.ts");
const { Users } = await import("@src/models/user.ts");
const { DatasetStatus, DatasetVisibility } = await import("@commons/dataset.ts");

let app: http.Server;
let base: string;
let port: number;
before(async () => {
    const router = express();
    router.use(`${SHINY_PREFIX}/:url`, shinyProxy);
    app = http.createServer(router);
    app.on("upgrade", handleShinyUpgrade);
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    port = (app.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
});
after(() => {
    app.close();
    shiny.close();
    shiny.closeAllConnections();
});
afterEach(() => {
    mock.restoreAll();
    seen.length = 0;
});

// A READY, PUBLIC dataset "d1" with the url slug "slug", unless told otherwise
const stubDataset = (over: object | null = {}) => {
    mock.method(Datasets, "findOne", async () =>
        over === null
            ? null
            : {
                  id: "d1",
                  visibility: DatasetVisibility.PUBLIC,
                  owner: "someone",
                  plots: [],
                  status: DatasetStatus.READY,
                  ...over,
              }
    );
    mock.method(Users, "findByPk", async () => null);
};
const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { redirect: "manual", headers });
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

test("a ticket is exchanged for a path-scoped HttpOnly cookie and a redirect without the ticket", async () => {
    stubDataset();
    const res = await get(`/shiny/slug/?x=1&${VIEWER_TICKET_PARAM}=${signViewerTicket("d1", null)}`);
    assert.equal(res.status, 303);
    const location = new URL(res.headers.get("location")!, base);
    assert.equal(location.pathname, "/shiny/slug/");
    assert.equal(location.searchParams.get("x"), "1");
    assert.equal(location.searchParams.has(VIEWER_TICKET_PARAM), false);
    assert.match(location.searchParams.get(SHINY_CONTEXT_PARAM)!, /^.+\.[0-9a-f]{64}$/);
    const cookie = res.headers.get("set-cookie")!;
    assert.match(cookie, /^viewer=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/shiny\/slug/);
    assert.doesNotMatch(cookie, /Secure/i); // the frontend URL is http
    assert.equal(seen.length, 0, "nothing reaches Shiny before the session starts");
});

test("a ticket works once", async () => {
    stubDataset();
    const url = `/shiny/slug/?${VIEWER_TICKET_PARAM}=${signViewerTicket("d1", null)}`;
    assert.equal((await get(url)).status, 303);
    assert.equal((await get(url)).status, 404);
});

test("a ticket for another dataset, or a dataset that is not ready, is answered with 404", async () => {
    stubDataset();
    assert.equal((await get(`/shiny/slug/?${VIEWER_TICKET_PARAM}=${signViewerTicket("other", null)}`)).status, 404);
    stubDataset({ status: DatasetStatus.PROCESSING });
    assert.equal((await get(`/shiny/slug/?${VIEWER_TICKET_PARAM}=${signViewerTicket("d1", null)}`)).status, 404);
});

test("requests without a valid session are answered with 404 and never reach Shiny", async () => {
    stubDataset();
    assert.equal((await get("/shiny/slug/")).status, 404);
    assert.equal((await get("/shiny/slug/shared/x.js", { cookie: "viewer=garbage" })).status, 404);
    // a session of another dataset
    assert.equal((await get("/shiny/slug/shared/x.js", { cookie: `viewer=${signViewerSession("other", null)}` })).status, 404);
    // access lost since the session started
    stubDataset({ visibility: DatasetVisibility.PRIVATE });
    assert.equal((await get("/shiny/slug/shared/x.js", { cookie: `viewer=${signViewerSession("d1", null)}` })).status, 404);
    // a malformed slug never gets as far as the proxy (Express rejects the mount path parameter itself)
    assert.equal((await get("/shiny/%E0%A4%A/")).status, 400);
    assert.equal(seen.length, 0);
});

test("the page without a signed context is redirected to one", async () => {
    stubDataset();
    const res = await get("/shiny/slug/", { cookie: `viewer=${signViewerSession("d1", null)}` });
    assert.equal(res.status, 303);
    assert.match(new URL(res.headers.get("location")!, base).searchParams.get(SHINY_CONTEXT_PARAM)!, /^.+\.[0-9a-f]{64}$/);
    assert.equal(seen.length, 0);
});

test("an authorized request is proxied to the app path with its credentials removed and the framing headers replaced", async () => {
    stubDataset();
    const res = await get("/shiny/slug/?ctx=abc.def&t=123", {
        cookie: `viewer=${signViewerSession("d1", null)}; other=1`,
        authorization: "Bearer login-token",
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "shiny says hi");
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.equal(res.headers.get("content-security-policy"), "frame-ancestors http://frontend.test");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.url, "/app/?ctx=abc.def&t=123");
    assert.equal(seen[0]!.headers.cookie, undefined);
    assert.equal(seen[0]!.headers.authorization, undefined);
    assert.equal(seen[0]!.headers["x-forwarded-for"], "127.0.0.1");
});

test("assets are proxied under the app path", async () => {
    stubDataset();
    assert.equal((await get("/shiny/slug/shared/shiny.css", { cookie: `viewer=${signViewerSession("d1", null)}` })).status, 200);
    assert.equal(seen[0]!.url, "/app/shared/shiny.css");
});

// Sends a WebSocket handshake straight to the proxy and returns the first line of the answer ("" if it was cut off)
const upgrade = (path: string, headers: Record<string, string> = {}) =>
    new Promise<string>((resolve) => {
        const socket = net.connect(port, "127.0.0.1", () => {
            const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, "Connection: Upgrade", "Upgrade: websocket"];
            lines.push("Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==");
            for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
            socket.write(lines.join("\r\n") + "\r\n\r\n");
        });
        let data = "";
        socket.on("data", (chunk) => (data += chunk));
        socket.on("error", () => {});
        socket.on("close", () => resolve(data.split("\r\n")[0]!));
        setTimeout(() => socket.destroy(), 3000).unref();
    });

test("a WebSocket upgrade with a valid session is proxied, without the session cookie", async () => {
    stubDataset();
    const answer = await upgrade("/shiny/slug/websocket/", { Cookie: `viewer=${signViewerSession("d1", null)}` });
    assert.match(answer, /101 Switching Protocols/);
    assert.equal(seen[0]!.url, "/app/websocket/");
    assert.equal(seen[0]!.headers.cookie, undefined);
});

test("a WebSocket upgrade without a valid session is cut off before Shiny hears of it", async () => {
    stubDataset();
    assert.equal(await upgrade("/shiny/slug/websocket/"), "");
    assert.equal(await upgrade("/shiny/slug/websocket/", { Cookie: "viewer=garbage" }), "");
    assert.equal(await upgrade("/shiny/slug/websocket/", { Cookie: `viewer=${signViewerSession("other", null)}` }), "");
    stubDataset(null);
    assert.equal(await upgrade("/shiny/slug/websocket/", { Cookie: `viewer=${signViewerSession("d1", null)}` }), "");
    assert.equal(seen.length, 0);
});

test("a database failure during an upgrade closes the socket instead of crashing", async () => {
    mock.method(Datasets, "findOne", async () => {
        throw new Error("db down");
    });
    mock.method(console, "error", () => {});
    assert.equal(await upgrade("/shiny/slug/websocket/", { Cookie: `viewer=${signViewerSession("d1", null)}` }), "");
});

test("upgrades for other paths are left alone", async () => {
    const socket = new net.Socket();
    let destroyed = false;
    socket.destroy = (() => ((destroyed = true), socket)) as never;
    await handleShinyUpgrade({ url: "/socket.io/?x=1", headers: {} } as http.IncomingMessage, socket, Buffer.alloc(0));
    assert.equal(destroyed, false);
});

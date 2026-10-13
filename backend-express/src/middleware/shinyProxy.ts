// Authenticating reverse proxy in front of the (private) Shiny server: /shiny/<dataset url slug>/... -> SHINY_URL/app/...
//
// Browser iframe -> Express (ticket/cookie + dataset permission check) -> Shiny (internal network only)
//
// The viewer URL first arrives with ?viewer_ticket=<ticket> (see POST /datasets/:id/viewer); the ticket is swapped for an HttpOnly cookie
// scoped to this dataset's path and the browser is redirected to the same URL without it, plus ?ctx=<signed context> that tells the
// Shiny app which dataset it is showing and what the viewer may do (Shiny Server drops request headers, so it cannot be a header). HTTP requests and WebSocket upgrades
// are then authorized from the cookie. WebSocket upgrades never pass through Express middleware, so index.ts must call
// handleShinyUpgrade itself; the proxy is created without `ws: true` precisely because that option would subscribe an
// unauthenticated upgrade handler of its own
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { NextFunction, Request, Response } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import {
    authorizeViewer,
    sessionMaxAgeSeconds,
    signShinyContext,
    signViewerSession,
    viewerEnabled,
    verifyViewerSession,
    verifyViewerTicket,
    type ViewerContext,
} from "@src/services/viewer.ts";

/** URL prefix the proxy answers on; the next segment is the dataset's url slug */
export const SHINY_PREFIX = "/shiny";

// Path of the Shiny app on the Shiny server (rocker/shiny serves /srv/shiny-server/app there)
const SHINY_APP_PATH = "/app";

// Query parameter carrying the ticket. Deliberately not a short name like "t": Shiny's own SockJS requests use ?t=<timestamp>
export const VIEWER_TICKET_PARAM = "viewer_ticket";

// Name of the viewer session cookie
const COOKIE = "viewer";
// Matches the /shiny/<slug> start of a URL; group 1 is the (still encoded) slug
const SLUG_URL = new RegExp(`^${SHINY_PREFIX}/([^/?#]+)`);

// Query parameter holding the signed context the Shiny app trusts (see signShinyContext)
export const SHINY_CONTEXT_PARAM = "ctx";

/** The slug in a /shiny/<slug>/... request URL (decoded), or null if the URL is not a viewer URL or the slug is malformed */
export const slugFromUrl = (url: string | undefined) => {
    const raw = url?.match(SLUG_URL)?.[1];
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        return null;
    }
};

// True for the app's page itself (/shiny/<slug> or /shiny/<slug>/), as opposed to its assets and connections
const isPage = (url: URL) => /^\/shiny\/[^/]+\/?$/.test(url.pathname);

/** Value of one cookie in a Cookie header, or null (a tiny parser, so this needs no cookie dependency) */
export const readCookie = (header: string | undefined, name: string) => {
    for (const part of header?.split(";") ?? []) {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return null;
};

const proxy = viewerEnabled()
    ? createProxyMiddleware({
          target: process.env.SHINY_URL!,
          // Shiny only ever sees the app path; the slug and prefix are Express's business
          pathRewrite: (path) => path.replace(SLUG_URL, SHINY_APP_PATH),
          // The Shiny URL is internal, so the client's Host header is of no use to it (the Express host stays in x-forwarded-*)
          changeOrigin: true,
          xfwd: true,
          on: {
              // The iframe is embedded by the frontend only. Replaces anything Shiny sent
              proxyRes: (proxyRes) => {
                  delete proxyRes.headers["x-frame-options"];
                  proxyRes.headers["content-security-policy"] = `frame-ancestors ${process.env.FRONTEND_URL}`;
              },
          },
      })
    : null;

// The viewer cookie and any login token are for Express only; Shiny never needs to see them
const stripCredentials = (req: IncomingMessage) => {
    delete req.headers.cookie;
    delete req.headers.authorization;
};

// Express strips the mount path from req.url; restore the full URL so HTTP and WebSocket requests are rewritten the same way
const restoreUrl = (req: Request) => {
    req.url = req.originalUrl;
};

/**
 * Express handler for /shiny/:url/... : swaps a ?viewer_ticket= ticket for the session cookie, or authorizes the cookie and proxies the request.
 * Answers 404 (not 401/403) for anything the caller may not see, so private datasets are not revealed
 */
export const shinyProxy = async (req: Request, res: Response, next: NextFunction) => {
    if (!proxy) return res.status(503).json({ error: "The viewer is not configured" });
    restoreUrl(req);
    const slug = slugFromUrl(req.url);
    if (!slug) return res.status(404).json({ error: "Dataset not found" });

    const url = new URL(req.url, "http://placeholder");
    const ticket = url.searchParams.get(VIEWER_TICKET_PARAM);
    if (ticket) {
        const ctx = await authorizeViewer(verifyViewerTicket(ticket), slug);
        if (!ctx) return res.status(404).json({ error: "Dataset not found" });
        const secure = process.env.FRONTEND_URL.startsWith("https:");
        // Scoped to this dataset's path, so the cookie is never sent for other datasets or the API
        res.cookie(COOKIE, signViewerSession(ctx.dataset.id, ctx.user?.id ?? null), {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: `${SHINY_PREFIX}/${encodeURIComponent(slug)}`,
            maxAge: sessionMaxAgeSeconds() * 1000,
        });
        // Redirect without the ticket (other query parameters are kept), so it never lands in history, logs or Referer headers
        url.searchParams.delete(VIEWER_TICKET_PARAM);
        url.searchParams.set(SHINY_CONTEXT_PARAM, signShinyContext(ctx));
        console.log("[SHINY PROXY] Ticket accepted, starting viewer session");
        return res.redirect(303, url.pathname + url.search);
    }

    const session = readCookie(req.headers.cookie, COOKIE);
    const ctx = session ? await authorizeViewer(verifyViewerSession(session), slug) : null;
    if (!ctx) return res.status(404).json({ error: "Dataset not found" });
    // A page request without the signed context (e.g. the bare /shiny/<slug>/ URL, or a link from before it was added) gets a fresh one
    if (req.method === "GET" && isPage(url) && !url.searchParams.has(SHINY_CONTEXT_PARAM)) {
        url.searchParams.set(SHINY_CONTEXT_PARAM, signShinyContext(ctx));
        return res.redirect(303, url.pathname + url.search);
    }
    stripCredentials(req);
    proxy(req, res, next);
};

/**
 * Handler for the HTTP server's "upgrade" event. Authorizes WebSocket connections to /shiny/... from the viewer cookie and
 * proxies them; any other upgrade (e.g. Socket.IO's) is left to its own listener. Destroys the socket when the check fails
 */
export const handleShinyUpgrade = async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!req.url?.startsWith(`${SHINY_PREFIX}/`)) return;
    const reject = () => socket.destroy();
    // Without this a client could trigger an unhandled "error" (e.g. a reset) and crash the process
    socket.on("error", () => {});
    try {
        const slug = slugFromUrl(req.url);
        const session = readCookie(req.headers.cookie, COOKIE);
        const ctx = slug && session ? await authorizeViewer(verifyViewerSession(session), slug) : null;
        if (!ctx || !proxy) return reject();
        stripCredentials(req);
        proxy.upgrade?.(req, socket, head);
    } catch (error) {
        console.error("[SHINY PROXY] WebSocket upgrade failed:", error);
        reject();
    }
};

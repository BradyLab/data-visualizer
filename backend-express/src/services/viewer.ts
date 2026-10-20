// Access to the embedded Shiny viewer. An iframe or WebSocket cannot send an Authorization header, so the frontend asks for a
// short-lived "ticket" (POST /datasets/:id/viewer), opens the viewer URL with it, and the proxy swaps it for a cookie session.
// Both are signed with JWT_SECRET but carry a `typ` claim and no login-token fields, so none of them works as an API Bearer
// token (verifyToken needs id + pv) or a download link (verifyDownloadToken needs purpose), and vice versa
import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { Datasets } from "@src/models/dataset.ts";
import { Users } from "@src/models/user.ts";
import { getAccess, hasAccess, type Access } from "@src/services/access.ts";
import { jwtSecret } from "@src/services/auth.ts";
import { getByUrl } from "@src/services/dataset.ts";
import { PermissionOptions } from "@commons/permissions.ts";
import { DatasetStatus } from "@commons/dataset.ts";
import { UserStatus } from "@commons/user.ts";

const TICKET = "viewer-ticket";
const SESSION = "viewer-session";

// Lifetimes come from the environment (jsonwebtoken format, e.g. "60s", "1h"); the ticket is only a hand-off, the session lasts while the viewer is open
const ticketTtl = () => (process.env.VIEWER_TICKET_EXPIRES_IN ?? "60s") as NonNullable<jwt.SignOptions["expiresIn"]>;
const sessionTtl = () => (process.env.VIEWER_SESSION_EXPIRES_IN ?? "1h") as NonNullable<jwt.SignOptions["expiresIn"]>;

/** True when both SHINY_URL and SHINY_SECRET are set; without them the viewer is switched off */
export const viewerEnabled = () => Boolean(process.env.SHINY_URL && process.env.SHINY_SECRET);

/**
 * Signs what the Shiny app may know about the viewer: the dataset id, the plots the dataset offers and the treatments its cells are limited to.
 * Shiny Server does not hand request headers or query strings to the R app, so the identity cannot travel as trusted headers.
 * It goes in the iframe URL instead (?ctx=...), where the browser can read it but cannot change it: the value is
 * `<base64url JSON>.<hex HMAC-SHA256>` made with SHINY_SECRET, which only Express and Shiny know, and the R app verifies it.
 * It expires with the viewer session: `exp` (epoch seconds) is the session token's own expiry when re-signing inside a session
 * (see sessionExpiry), and a full session length from now when the session is just starting
 */
export const signShinyContext = (
    { dataset }: Pick<ViewerContext, "dataset">,
    exp = Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds()
) => {
    const payload = Buffer.from(
        JSON.stringify({
            dataset_id: dataset.id,
            plots: dataset.plots ?? [],
            treatments: dataset.treatments ?? [],
            exp,
        })
    ).toString("base64url");
    return `${payload}.${createHmac("sha256", process.env.SHINY_SECRET!).update(payload).digest("hex")}`;
};

/** How long the viewer session cookie lasts, in seconds (matches the session token, so the cookie does not outlive it); read back from a throwaway signed token so it follows VIEWER_SESSION_EXPIRES_IN */
export const sessionMaxAgeSeconds = () => {
    const { exp, iat } = jwt.decode(signViewerSession("x", null)) as { exp: number; iat: number };
    return exp - iat;
};

/** When a viewer session token expires, in epoch seconds; only for a token verifyViewerSession already accepted */
export const sessionExpiry = (token: string) => (jwt.decode(token) as { exp: number }).exp;

// Signs a viewer token of the given kind (typ) for a dataset and user (null = guest)
const sign = (typ: string, expiresIn: NonNullable<jwt.SignOptions["expiresIn"]>, datasetId: string, userId: string | null) => {
    return jwt.sign({ typ, dataset_id: datasetId, user_id: userId }, jwtSecret(), { expiresIn });
};

/** Signs the short-lived ticket (60s by default) handed to the frontend; the caller must already have checked VIEW access. userId is null for a guest */
export const signViewerTicket = (datasetId: string, userId: string | null) => sign(TICKET, ticketTtl(), datasetId, userId);

/** Signs the longer-lived token kept in the viewer cookie */
export const signViewerSession = (datasetId: string, userId: string | null) => sign(SESSION, sessionTtl(), datasetId, userId);

// The dataset and user ids in a valid, unexpired token of the given kind, or null
const verify = (token: string, typ: string) => {
    const secret = jwtSecret(); // outside the try: a missing secret must not look like an invalid token
    try {
        const p = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
            typ?: string;
            dataset_id?: unknown;
            user_id?: unknown;
        };
        if (p.typ !== typ || typeof p.dataset_id !== "string") return null;
        if (p.user_id !== null && typeof p.user_id !== "string") return null;
        return { datasetId: p.dataset_id, userId: p.user_id };
    } catch {
        return null;
    }
};

/** Claims of a valid viewer ticket, or null (session tokens are not tickets) */
export const verifyViewerTicket = (token: string) => verify(token, TICKET);

/** Claims of a valid viewer session token, or null (tickets are not sessions) */
export const verifyViewerSession = (token: string) => verify(token, SESSION);

export interface ViewerContext {
    dataset: Datasets;
    user: Users | null;
    access: NonNullable<Access>;
}

/**
 * Re-checks everything for a ticket/session token against the database, so a deleted or deactivated user, a revoked
 * permission or a dataset that became private stops working immediately instead of when the token expires.
 * Returns the READY dataset (found by its url slug, which must be the one the token was issued for), the user (null = guest) and their
 * access, or null if any check fails (callers answer 404 so private datasets are not revealed)
 */
export const authorizeViewer = async (
    claims: { datasetId: string; userId: string | null } | null,
    slug: string
): Promise<ViewerContext | null> => {
    if (!claims) return null;
    const dataset = await getByUrl(slug);
    // Only a dataset whose plot data is READY has anything to show; this also ends open viewers when a re-upload starts processing
    if (!dataset || dataset.id !== claims.datasetId || dataset.status !== DatasetStatus.READY) return null;
    let user: Users | null = null;
    if (claims.userId) {
        user = await Users.findByPk(claims.userId);
        if (!user || user.status !== UserStatus.ACTIVE) return null;
    }
    const access = await getAccess(user, dataset);
    return access && hasAccess(access, PermissionOptions.VIEW) ? { dataset, user, access } : null;
};

// Login logic: checks credentials and issues/verifies JWTs
import { createHash, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { fn, col, where } from "sequelize";
import { Users } from "@src/models/user.ts";
import { UserStatus } from "@commons/user.ts";
import { hashPassword, scryptAsync } from "@src/utils/password.ts";

// Payload stored in the token
export interface TokenPayload {
    id: string;
    pv: string;
}

/** Short fingerprint of a stored password hash, embedded in login tokens so a password change revokes them */
export const passwordVersion = (storedPassword: string) => createHash("sha256").update(storedPassword).digest("hex").slice(0, 16);

// Checks a password against a stored "salt:hash" (hex) value produced by the user service
const verifyPassword = async (password: string, stored: string) => {
    // Stored format is "salt:hash"; re-derive with the same salt and compare in constant time to avoid timing leaks
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    // A non-hex hash decodes to an empty buffer, and scrypt rejects a key length of 0; treat it as a failed login instead of a 500
    if (expected.length === 0) return false;
    const actual = await scryptAsync(password, salt, expected.length);
    return timingSafeEqual(expected, actual);
};

// Hash (a promise, since hashing is async) of a throwaway password, checked when the email is unknown so login takes about as long as for a real account
const DUMMY_HASH = hashPassword("not-a-real-password");

/** Signs a token for the user id, bound to their current stored password hash; lifetime comes from JWT_EXPIRES_IN (default 8h), signed with JWT_SECRET. Throws if JWT_SECRET is not set */
export const signToken = (id: string, storedPassword: string) => {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "8h") as NonNullable<jwt.SignOptions["expiresIn"]>;
    // Fail loudly: returning undefined here would let login() answer 200 with no token
    if (!process.env.JWT_SECRET) {
        console.error("[AUTH SERVICE] JWT_SECRET not set");
        throw new Error("JWT_SECRET is not set");
    }
    return jwt.sign({ id, pv: passwordVersion(storedPassword) } satisfies TokenPayload, process.env.JWT_SECRET, { expiresIn });
};

/** Returns the id, password fingerprint and expiry (seconds since the epoch, if the token has one) in a valid login token, or null if the token is invalid, expired, or not a login token */
export const verifyToken = (token: string) => {
    try {
        const { id, pv, exp } = jwt.verify(token, process.env.JWT_SECRET) as Partial<TokenPayload> & { exp?: number };
        return id && pv ? { id, pv, exp } : null;
    } catch {
        console.log("[AUTH SERVICE] Token is invalid or expired");
        return null;
    }
};

// How long a download link stays valid. The token is only checked when a request arrives, so a running download is never cut off,
// but a browser resuming an interrupted download of a very large file re-sends the same link, so it has to outlast a long transfer
const DOWNLOAD_TOKEN_TTL = "6h";

/**
 * Signs a short-lived token that lets whoever holds it fetch one file (see GET /files/current/:datasetId/:type/content).
 * It goes in a link, since a browser download cannot send an Authorization header; the caller must have checked access first.
 * The token names the user it was issued to, so the content route can re-check that user's account and access when the link is used
 */
export const signDownloadToken = (fileId: string, userId: string) => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
    return jwt.sign({ file: fileId, user: userId, purpose: "download" }, process.env.JWT_SECRET, {
        expiresIn: DOWNLOAD_TOKEN_TTL,
    });
};

/** Returns the file id and issuing user id in a valid download token, or null (login tokens are not download tokens and vice versa) */
export const verifyDownloadToken = (token: string) => {
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET) as { file?: string; user?: string; purpose?: string };
        return payload.purpose === "download" && typeof payload.file === "string" && typeof payload.user === "string"
            ? { file: payload.file, user: payload.user }
            : null;
    } catch {
        return null;
    }
};

/** Changes a user's password (activating them if invited) if the old one is correct; returns a fresh token (older ones stop working), or null (and changes nothing) if it is not */
export const changePassword = async (id: string, oldPassword: string, newPassword: string) => {
    console.log("[AUTH SERVICE] Changing password...");
    const user = await Users.findByPk(id);
    if (!user || !(await verifyPassword(oldPassword, user.password))) {
        console.log("[AUTH SERVICE] Old password did not match");
        return null;
    }
    // An invited user becomes active once they replace the default password
    await user.update({
        password: await hashPassword(newPassword),
        status: user.status === UserStatus.INVITED ? UserStatus.ACTIVE : user.status,
    });
    return signToken(user.id, user.password);
};

/** Returns a token and the user (without password) for valid credentials of an active user, otherwise null */
export const login = async (email: string, password: string) => {
    console.log("[AUTH SERVICE] Looking up user to log in...");
    const user = await Users.findOne({ where: where(fn("lower", col("email")), email.trim().toLowerCase()) });
    // Always run scrypt, even for an unknown email, so response time doesn't reveal whether an account exists
    const passwordOk = await verifyPassword(password, user?.password ?? (await DUMMY_HASH));
    let success = true;
    // Callers get the same result for unknown email, wrong password, and inactive account so they can't tell which;
    // the logs say which, but they stay server-side
    if (!user) {
        console.log("[AUTH SERVICE] No user found for that email");
        success = false;
    }
    if (user && !passwordOk) {
        console.log("[AUTH SERVICE] Password did not match");
        success = false;
    }
    if (user && user.status === UserStatus.INACTIVE) {
        console.log("[AUTH SERVICE] User is inactive");
        success = false;
    }
    if (success && user) {
        console.log("[AUTH SERVICE] Credentials verified, signing token");
        // Strip the hash so it is never sent to the client
        const { password: _password, ...publicUser } = user.get({ plain: true });
        return { token: signToken(user.id, user.password), user: publicUser };
    } else return null;
};

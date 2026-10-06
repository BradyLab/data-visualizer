// Rate limiters for login, to slow down password brute-forcing
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { Request, Response } from "express";
import { PostgresStore } from "@src/middleware/rateLimitStore.ts";

// Counters are kept in Postgres (see rateLimitStore.ts), so they survive restarts and are shared across instances.
// Each limiter gets its own store prefix. If the database is unreachable the request fails with an error rather than skipping the limit
const WINDOW_MS = 15 * 60 * 1000;
// Body shared by both limiters; the client shows this message on HTTP 429
const TOO_MANY = { error: "Too many login attempts. Please try again later." };

/**
 * Limits login attempts per client IP (10 per 15 minutes).
 * Successful logins do not count, so only failures use up the budget.
 * Behind a reverse proxy, set app.set("trust proxy", ...) in index.ts or every client shares the proxy's IP.
 */
export const loginIpLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 10,
    standardHeaders: "draft-7", // sends the RateLimit and Retry-After headers
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: new PostgresStore("login-ip"),
    message: TOO_MANY,
});

/**
 * Limits failed logins per target account (5 per 15 minutes), so an attacker rotating IPs still cannot
 * guess one account's password. This is a temporary throttle, not a lockout, and the 429 looks the same
 * whether or not the email exists, so it does not reveal which accounts are real.
 * Note that anyone can use up an account's budget on purpose and briefly block its owner from logging in.
 */
export const loginAccountLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: new PostgresStore("login-account"),
    // Same email in any casing counts as one account; bodies without a usable email fall back to the IP
    keyGenerator: (req: Request) => {
        const email = req.body?.email;
        return typeof email === "string" && email.trim()
            ? `email:${email.trim().toLowerCase()}`
            : ipKeyGenerator(req.ip ?? "");
    },
    message: TOO_MANY,
});

/**
 * Limits failed password changes per logged-in user (5 per 15 minutes), since a stolen token could otherwise
 * be used to guess the old password. Must run after requireAuth, which sets res.locals.user.
 */
export const changePasswordLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    store: new PostgresStore("change-password"),
    keyGenerator: (req: Request, res: Response) => {
        const id = res.locals.user?.id;
        return typeof id === "string" ? `user:${id}` : ipKeyGenerator(req.ip ?? "");
    },
    message: { error: "Too many password change attempts. Please try again later." },
});

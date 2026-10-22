// Checks of the secrets and the default password at startup (called from start() in index.ts).
// Weak or placeholder secrets are refused when NODE_ENV=production and only warned about otherwise, since .env.example ships placeholders
// that local development and the Docker dev stack use as they are
import { MIN_PASSWORD_LENGTH } from "@commons/general.ts";
import { UserStatus } from "@commons/user.ts";
import { Users } from "@src/models/user.ts";
import { verifyPassword } from "@src/services/auth.ts";

// A secret shorter than this is too easy to guess (openssl rand -hex 32 makes 64 characters)
export const MIN_SECRET_LENGTH = 32;

// Values people leave in from an example file or pick as a stand-in: the "change-me" of .env.example, and common words
const PLACEHOLDER = /^(change[-_ ]?me.*|changeit|secret|password|passw0rd|default|example|test|todo|xxx+|your[-_ ].*)$/i;

type Env = Record<string, string | undefined>;

const secretProblem = (name: string, value: string) => {
    if (PLACEHOLDER.test(value.trim())) return `${name} is a placeholder value`;
    if (value.length < MIN_SECRET_LENGTH) return `${name} is shorter than ${MIN_SECRET_LENGTH} characters`;
    return null;
};

/** What is wrong with the secrets in the environment (empty when they are fine). SHINY_SECRET is only checked when it is set */
export const secretProblems = (env: Env = process.env) => {
    const problems: string[] = [];
    for (const name of ["JWT_SECRET", "SHINY_SECRET"]) {
        const value = env[name];
        const problem = value ? secretProblem(name, value) : null;
        if (problem) problems.push(problem);
    }
    // One leaked secret must not give away the other
    if (env.JWT_SECRET && env.JWT_SECRET === env.SHINY_SECRET) problems.push("JWT_SECRET and SHINY_SECRET are the same");
    return problems;
};

/** Whether the server runs in production, where weak secrets stop it from starting */
export const isProduction = (env: Env = process.env) => env.NODE_ENV === "production";

/** What is wrong with DEFAULT_PASSWORD itself (it is what seeded users start with); empty when it is not set or fine */
export const defaultPasswordProblems = (env: Env = process.env) => {
    const value = env.DEFAULT_PASSWORD;
    if (!value) return [];
    if (PLACEHOLDER.test(value.trim())) return ["DEFAULT_PASSWORD is a placeholder value"];
    if (value.length < MIN_PASSWORD_LENGTH) return [`DEFAULT_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters`];
    return [];
};

/**
 * The accounts whose password is still DEFAULT_PASSWORD, as "email (status)". INVITED users are made to change it before they can do
 * anything, so they only show how long the window is open; ACTIVE or INACTIVE ones are a real hole (the password change refuses it)
 */
export const accountsOnDefaultPassword = async (env: Env = process.env) => {
    const password = env.DEFAULT_PASSWORD;
    if (!password) return [];
    const users = await Users.findAll({ attributes: ["email", "status", "password"] });
    const found: { email: string; status: UserStatus }[] = [];
    for (const user of users)
        if (await verifyPassword(password, user.password)) found.push({ email: user.email, status: user.status });
    return found;
};

/** Reports secret problems: logs them and returns true when the server must not start (production only) */
export const secretsBlockStartup = (env: Env = process.env) => {
    const problems = secretProblems(env);
    if (!problems.length) return false;
    const blocking = isProduction(env);
    for (const problem of problems)
        console[blocking ? "error" : "warn"](
            `[SERVER]: ${problem}.${blocking ? "" : " Fine for development, refused in production."}`
        );
    if (blocking)
        console.error(
            "[SERVER]: Set strong secrets (for example `openssl rand -hex 32`) before running with NODE_ENV=production; refusing to start."
        );
    return blocking;
};

/** Warns about a weak DEFAULT_PASSWORD and about accounts still on it. Never throws: a failed check must not stop the server */
export const warnAboutDefaultPassword = async (env: Env = process.env) => {
    try {
        for (const problem of defaultPasswordProblems(env)) console.warn(`[SERVER]: ${problem}.`);
        const accounts = await accountsOnDefaultPassword(env);
        const invited = accounts.filter((a) => a.status === UserStatus.INVITED);
        const others = accounts.filter((a) => a.status !== UserStatus.INVITED);
        if (others.length)
            console.error(
                `[SERVER]: These accounts are not waiting to change their password but still use DEFAULT_PASSWORD: ` +
                    `${others.map((a) => `${a.email} (${a.status})`).join(", ")}. Change it for them now.`
            );
        if (invited.length)
            console.warn(
                `[SERVER]: ${invited.length} invited account(s) still have DEFAULT_PASSWORD and must log in to change it: ` +
                    invited.map((a) => a.email).join(", ")
            );
    } catch (err) {
        console.error("[SERVER]: Could not check for accounts on the default password:", err);
    }
};

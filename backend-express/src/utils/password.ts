// Password hashing helper; the matching verifyPassword lives in services/auth.ts
import { randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";

// Async scrypt, so hashing runs on the thread pool instead of blocking the event loop
export const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

// Hashes a password as "salt:hash" (hex) using scrypt with a fresh random 16-byte salt.
// The 64-byte output length is what verifyPassword relies on (it reads the length from the stored hash)
export const hashPassword = async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
};

// Characters for generated passwords; no look-alikes (0/O, 1/l/I) so an admin can read one out or retype it
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Returns a random password of the given length (default 16) from a cryptographically secure source */
export const generatePassword = (length = 16) =>
    Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join("");

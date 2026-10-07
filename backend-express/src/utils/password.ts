// Password hashing helper; the matching verifyPassword lives in services/auth.ts
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

// Async scrypt, so hashing runs on the thread pool instead of blocking the event loop
export const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

// Hashes a password as "salt:hash" (hex) using scrypt with a fresh random 16-byte salt.
// The 64-byte output length is what verifyPassword relies on (it reads the length from the stored hash)
export const hashPassword = async (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${(await scryptAsync(password, salt, 64)).toString("hex")}`;
};

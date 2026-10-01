// Password hashing helper; the matching verifyPassword lives in services/auth.ts
import { randomBytes, scryptSync } from "node:crypto";

// Hashes a password as "salt:hash" (hex) using scrypt with a fresh random 16-byte salt.
// The 64-byte output length is what verifyPassword relies on (it reads the length from the stored hash)
export const hashPassword = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

import { randomBytes, scryptSync } from "node:crypto";

// Hashes a password as "salt:hash" (hex) using scrypt
export const hashPassword = (password: string) => {
    const salt = randomBytes(16).toString("hex");
    return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};
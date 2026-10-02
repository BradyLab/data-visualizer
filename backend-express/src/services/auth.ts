// Login logic: checks credentials and issues/verifies JWTs
import { scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { Users } from "@src/models/user.ts";
import { UserStatus } from "@commons/user.ts";
import { hashPassword } from "@src/utils/password.ts";

// Payload stored in the token
export interface TokenPayload {
    id: string;
}

// Checks a password against a stored "salt:hash" (hex) value produced by the user service
const verifyPassword = (password: string, stored: string) => {
    // Stored format is "salt:hash"; re-derive with the same salt and compare in constant time to avoid timing leaks
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return timingSafeEqual(expected, actual);
};

/** Signs a token for the user id; lifetime comes from JWT_EXPIRES_IN (default 8h), signed with JWT_SECRET */
export const signToken = (id: string) => {
    const expiresIn = (process.env.JWT_EXPIRES_IN ?? "8h") as NonNullable<jwt.SignOptions["expiresIn"]>;
    return jwt.sign({ id } satisfies TokenPayload, process.env.JWT_SECRET, { expiresIn });
};

/** Returns the id in a valid token, or null if the token is invalid or expired */
export const verifyToken = (token: string) => {
    try {
        return (jwt.verify(token, process.env.JWT_SECRET) as TokenPayload).id;
    } catch {
        console.log("[AUTH SERVICE] Token is invalid or expired");
        return null;
    }
};

/** Changes a user's password (activating them if invited) if the old one is correct; returns false (and changes nothing) if it is not */
export const changePassword = async (id: string, oldPassword: string, newPassword: string) => {
    console.log("[AUTH SERVICE] Changing password...");
    const user = await Users.findByPk(id);
    if (!user || !verifyPassword(oldPassword, user.password)) {
        console.log("[AUTH SERVICE] Old password did not match");
        return false;
    }
    // An invited user becomes active once they replace the default password
    await user.update({
        password: hashPassword(newPassword),
        status: user.status === UserStatus.INVITED ? UserStatus.ACTIVE : user.status,
    });
    return true;
};

/** Returns a token and the user (without password) for valid credentials of an active user, otherwise null */
export const login = async (email: string, password: string) => {
    console.log("[AUTH SERVICE] Looking up user to log in...");
    const user = await Users.findOne({ where: { email } });
    // Callers get the same result for unknown email, wrong password, and inactive account so they can't tell which;
    // the logs say which, but they stay server-side
    if (!user) {
        console.log("[AUTH SERVICE] No user found for that email");
        return null;
    }
    if (!verifyPassword(password, user.password)) {
        console.log("[AUTH SERVICE] Password did not match");
        return null;
    }
    if (user.status == UserStatus.INACTIVE) {
        console.log("[AUTH SERVICE] User is inactive");
        return null;
    }
    console.log("[AUTH SERVICE] Credentials verified, signing token");
    // Strip the hash so it is never sent to the client
    const { password: _password, ...publicUser } = user.get({ plain: true });
    return { token: signToken(user.id), user: publicUser };
};

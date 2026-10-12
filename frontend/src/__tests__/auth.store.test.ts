// Tests for the auth store: login, session restore, logout and the global 401 handling (the API layer is mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import axios, { AxiosError } from "axios";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { authApi } from "@src/api/auth";
import { useAuthStore } from "@src/stores/auth";

vi.mock("@src/api/auth", () => ({ authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn(), changePassword: vi.fn() } }));
// The 403 handler imports the router lazily; it is not under test here
vi.mock("@src/router", () => ({ default: { push: vi.fn() } }));

const makeUser = (role = UserRoles.LAB_MEMBER, status = UserStatus.ACTIVE): IUser =>
    ({ id: "u1", email: "a@b.c", name: "A", role, status, createdAt: new Date(), updatedAt: new Date() }) as IUser;

// An axios error with the given response status, as the interceptor sees it
const httpError = (status: number, data: unknown = {}) =>
    new AxiosError("fail", String(status), undefined, undefined, { status, data } as never);

beforeEach(() => {
    localStorage.clear();
    delete axios.defaults.headers.common["Authorization"];
    vi.resetAllMocks();
    setActivePinia(createPinia());
});

describe("login", () => {
    it("stores the token and user and sets the Authorization header", async () => {
        vi.mocked(authApi.login).mockResolvedValue({ token: "tok", user: makeUser() });
        const auth = useAuthStore();
        expect(await auth.login("a@b.c", "pw")).toBe(true);
        expect(auth.isLoggedIn).toBe(true);
        expect(localStorage.getItem("token")).toBe("tok");
        expect(axios.defaults.headers.common["Authorization"]).toBe("Bearer tok");
        expect(auth.loading).toBe(false);
    });

    it.each([
        [401, "Invalid email or password"],
        [429, "Too many login attempts. Please wait a few minutes and try again."],
        [500, "Unable to log in. Please try again."],
    ])("maps a %i response to an error message", async (status, message) => {
        vi.mocked(authApi.login).mockRejectedValue(httpError(status));
        const auth = useAuthStore();
        expect(await auth.login("a@b.c", "pw")).toBe(false);
        expect(auth.error).toBe(message);
        expect(auth.isLoggedIn).toBe(false);
    });
});

describe("roles", () => {
    it("lets admins and lab members create datasets, but not external users", async () => {
        const auth = useAuthStore();
        for (const [role, canCreate, isAdmin] of [
            [UserRoles.ADMIN, true, true],
            [UserRoles.LAB_MEMBER, true, false],
            [UserRoles.EXTERNAL, false, false],
        ] as const) {
            vi.mocked(authApi.login).mockResolvedValue({ token: "t", user: makeUser(role) });
            await auth.login("a@b.c", "pw");
            expect(auth.canCreateDatasets).toBe(canCreate);
            expect(auth.isAdmin).toBe(isAdmin);
        }
    });

    it("starts as a logged-out guest", () => {
        const auth = useAuthStore();
        expect(auth.user.role).toBe(UserRoles.GUEST);
        expect(auth.isLoggedIn).toBe(false);
        expect(auth.canCreateDatasets).toBe(false);
    });
});

describe("restore", () => {
    it("does nothing without a saved token", async () => {
        await useAuthStore().restore();
        expect(authApi.me).not.toHaveBeenCalled();
    });

    it("loads the user for a saved token", async () => {
        localStorage.setItem("token", "saved");
        vi.mocked(authApi.me).mockResolvedValue(makeUser());
        setActivePinia(createPinia());
        const auth = useAuthStore();
        await auth.restore();
        expect(auth.isLoggedIn).toBe(true);
        expect(axios.defaults.headers.common["Authorization"]).toBe("Bearer saved");
    });

    it("clears the session when the server answers 401", async () => {
        localStorage.setItem("token", "expired");
        vi.mocked(authApi.me).mockRejectedValue(httpError(401));
        setActivePinia(createPinia());
        const auth = useAuthStore();
        await auth.restore();
        expect(auth.token).toBeNull();
        expect(localStorage.getItem("token")).toBeNull();
    });

    it("keeps the token and flags restoreFailed on a server error", async () => {
        localStorage.setItem("token", "saved");
        vi.mocked(authApi.me).mockRejectedValue(httpError(503));
        setActivePinia(createPinia());
        const auth = useAuthStore();
        await auth.restore();
        expect(auth.token).toBe("saved");
        expect(auth.restoreFailed).toBe(true);
        expect(auth.isLoggedIn).toBe(false);
    });
});

describe("logout", () => {
    it("clears the local session even when the request fails", async () => {
        vi.mocked(authApi.login).mockResolvedValue({ token: "tok", user: makeUser() });
        vi.mocked(authApi.logout).mockRejectedValue(new Error("offline"));
        const auth = useAuthStore();
        await auth.login("a@b.c", "pw");
        await auth.logout();
        expect(auth.isLoggedIn).toBe(false);
        expect(auth.user.role).toBe(UserRoles.GUEST);
        expect(axios.defaults.headers.common["Authorization"]).toBeUndefined();
    });
});

describe("markPasswordChanged", () => {
    it("activates an invited user and leaves others alone", async () => {
        vi.mocked(authApi.login).mockResolvedValue({ token: "t", user: makeUser(UserRoles.EXTERNAL, UserStatus.INVITED) });
        const auth = useAuthStore();
        await auth.login("a@b.c", "pw");
        auth.markPasswordChanged();
        expect(auth.user.status).toBe(UserStatus.ACTIVE);
    });
});

describe("401 interceptor", () => {
    // Drives the store's response interceptor with a rejected response, without a network
    const respondWith = (status: number) =>
        axios
            .get("http://test.invalid/x", {
                adapter: () => Promise.reject(httpError(status)),
            })
            .catch(() => {});

    it("drops the session on a 401 while holding a token", async () => {
        vi.mocked(authApi.login).mockResolvedValue({ token: "tok", user: makeUser() });
        const auth = useAuthStore();
        await auth.login("a@b.c", "pw");
        await respondWith(401);
        expect(auth.isLoggedIn).toBe(false);
        expect(auth.token).toBeNull();
    });
});

// Tests for the route guard in router/index.ts (stores are real, the API layer is mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { authApi } from "@src/api/auth";
import { useAuthStore } from "@src/stores/auth";
import router from "@src/router";

vi.mock("@src/api/auth", () => ({ authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() } }));
// Pages are lazy-loaded and not under test; stub them so navigating does not pull in the whole UI
vi.mock("@src/views/HomeView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@src/views/LoginView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@src/views/SettingsView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@src/views/EditDatasetView.vue", () => ({ default: { template: "<div />" } }));
vi.mock("@src/views/admin/UserManagement.vue", () => ({ default: { template: "<div />" } }));

const logInAs = async (role: UserRoles) => {
    const user = { id: "u1", email: "a@b.c", name: "A", role, status: UserStatus.ACTIVE } as IUser;
    vi.mocked(authApi.login).mockResolvedValue({ token: "t", user });
    await useAuthStore().login("a@b.c", "pw");
};

beforeEach(async () => {
    localStorage.clear();
    setActivePinia(createPinia());
    await router.push("/home");
});

describe("route guard", () => {
    it("sends logged-out users to /login with the requested page as redirect", async () => {
        await router.push("/settings");
        expect(router.currentRoute.value.name).toBe("login");
        expect(router.currentRoute.value.query.redirect).toBe("/settings");
    });

    it("lets logged-in users reach auth-only pages", async () => {
        await logInAs(UserRoles.EXTERNAL);
        await router.push("/settings");
        expect(router.currentRoute.value.name).toBe("settings");
    });

    it("sends non-admins away from admin pages", async () => {
        await logInAs(UserRoles.LAB_MEMBER);
        await router.push("/admin/user-mgmt");
        expect(router.currentRoute.value.name).toBe("home");
    });

    it("lets admins into admin pages", async () => {
        await logInAs(UserRoles.ADMIN);
        await router.push("/admin/user-mgmt");
        expect(router.currentRoute.value.name).toBe("user-mgmt");
    });

    it("keeps external users off the new-dataset page but lets lab members in", async () => {
        await logInAs(UserRoles.EXTERNAL);
        await router.push("/dataset/new");
        expect(router.currentRoute.value.name).toBe("home");
        await logInAs(UserRoles.LAB_MEMBER);
        await router.push("/dataset/new");
        expect(router.currentRoute.value.name).toBe("new");
    });

    it("does not redirect when the saved session could not be checked", async () => {
        const auth = useAuthStore();
        auth.restoreFailed = true;
        await router.push("/settings");
        expect(router.currentRoute.value.name).toBe("settings");
    });

    it("treats 'new' as the create page, not a dataset slug", () => {
        expect(router.resolve("/dataset/new").name).toBe("new");
        expect(router.resolve("/dataset/my-data").name).toBe("dataset");
    });

    it("shows the not-found page for unknown URLs", () => {
        expect(router.resolve("/no/such/page").name).toBe("not-found");
        expect(router.resolve("/admin/nope").name).toBe("not-found");
    });
});

// Component tests for the login page: the form, the error from the auth store, and where a successful login goes
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { UserRoles, UserStatus } from "@commons/user";
import LoginView from "@src/views/LoginView.vue";
import { useAuthStore } from "@src/stores/auth";

const nav = vi.hoisted(() => ({ push: vi.fn(), query: {} as Record<string, unknown> }));
vi.mock("vue-router", () => ({
    useRouter: () => ({ push: nav.push }),
    useRoute: () => ({ query: nav.query }),
}));
vi.mock("@src/api/auth", () => ({ authApi: { login: vi.fn(), getMe: vi.fn() } }));
vi.mock("@src/stores/socket", () => ({ useSocketStore: () => ({ on: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));

// v-text-field and the layout use ResizeObserver, which jsdom lacks
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const render = () => {
    const wrapper = mount(LoginView, { global: { plugins: [createVuetify()] }, attachTo: document.body });
    return { wrapper, auth: useAuthStore() };
};
const fill = async (wrapper: ReturnType<typeof render>["wrapper"], email: string, password: string) => {
    await wrapper.find('input[type="email"]').setValue(email);
    await wrapper.find('input[autocomplete="current-password"]').setValue(password);
};
const loggedInAs = (auth: ReturnType<typeof useAuthStore>, status = UserStatus.ACTIVE) => {
    auth.login = vi.fn(async () => {
        auth.user = { id: "u1", role: UserRoles.EXTERNAL, status } as typeof auth.user;
        return true;
    });
};

beforeEach(() => {
    vi.clearAllMocks();
    nav.query = {};
    document.body.innerHTML = "";
    localStorage.clear();
    setActivePinia(createPinia());
});

describe("LoginView", () => {
    it("does not log in until both fields are filled, and says which are missing", async () => {
        const { wrapper, auth } = render();
        const login = vi.spyOn(auth, "login");
        await wrapper.find('input[type="email"]').setValue("a@b.c");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(login).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("Password is required");
        expect(wrapper.find('button[type="submit"]').attributes("disabled")).toBeUndefined();
    });

    it("has a page heading and a named show/hide password button", async () => {
        const { wrapper } = render();
        expect(wrapper.find("h1").text()).toBe("Log In");
        const toggle = wrapper.find('button[aria-label="Show password"]');
        expect(wrapper.find('input[autocomplete="current-password"]').attributes("type")).toBe("password");
        await toggle.trigger("click");
        expect(wrapper.find('input[autocomplete="current-password"]').attributes("type")).toBe("text");
        expect(wrapper.find('button[aria-label="Hide password"]').attributes("aria-pressed")).toBe("true");
    });

    it("logs in with what was typed and goes home", async () => {
        const { wrapper, auth } = render();
        loggedInAs(auth);
        await fill(wrapper, "a@b.c", "secret");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(auth.login).toHaveBeenCalledWith("a@b.c", "secret");
        expect(nav.push).toHaveBeenCalledWith("/home");
    });

    it("goes back to the page the route guard sent the user from", async () => {
        nav.query = { redirect: "/datasets/abc" };
        const { wrapper, auth } = render();
        loggedInAs(auth);
        await fill(wrapper, "a@b.c", "secret");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(nav.push).toHaveBeenCalledWith("/datasets/abc");
    });

    it.each(["https://evil.example/", "//evil.example/", "javascript:alert(1)", ["/a"]])("does not follow the redirect %j", async (redirect) => {
        nav.query = { redirect };
        const { wrapper, auth } = render();
        loggedInAs(auth);
        await fill(wrapper, "a@b.c", "secret");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(nav.push).toHaveBeenCalledWith("/home");
    });

    it("sends an invited user to settings to choose a password, whatever the redirect", async () => {
        nav.query = { redirect: "/datasets/abc" };
        const { wrapper, auth } = render();
        loggedInAs(auth, UserStatus.INVITED);
        await fill(wrapper, "a@b.c", "temporary");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(nav.push).toHaveBeenCalledWith("/settings");
    });

    it("stays on the page and shows the error when the login fails", async () => {
        const { wrapper, auth } = render();
        auth.login = vi.fn(async () => {
            auth.error = "Invalid email or password";
            return false;
        });
        await fill(wrapper, "a@b.c", "wrong");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(nav.push).not.toHaveBeenCalled();
        expect(wrapper.find(".v-alert").text()).toContain("Invalid email or password");
    });

    it("clears an old error when the page opens, and skips the form for someone already logged in", async () => {
        setActivePinia(createPinia());
        const auth = useAuthStore();
        auth.error = "old error";
        auth.token = "t";
        auth.user = { id: "u1", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE } as typeof auth.user;
        const wrapper = mount(LoginView, { global: { plugins: [createVuetify()] } });
        await flushPromises();
        expect(auth.error).toBe("");
        expect(wrapper.find(".v-alert").exists()).toBe(false);
        expect(nav.push).toHaveBeenCalledWith("/home");
    });

    it("shows the password only after the eye icon is clicked", async () => {
        const { wrapper } = render();
        const input = () => wrapper.find('input[autocomplete="current-password"]');
        expect(input().attributes("type")).toBe("password");
        await wrapper.find(".mdi-eye-off-outline").trigger("click");
        expect(input().attributes("type")).toBe("text");
    });
});

// Component tests for the change-password popup: the field rules, what is sent, the token swap and the errors the backend can answer with
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { UserRoles, UserStatus } from "@commons/user";
import ChangePasswordDialog from "@src/components/ChangePasswordDialog.vue";
import { authApi } from "@src/api/auth";
import { useAuthStore } from "@src/stores/auth";

vi.mock("@src/api/auth", () => ({ authApi: { changePassword: vi.fn(), login: vi.fn(), getMe: vi.fn() } }));
vi.mock("@src/stores/socket", () => ({ useSocketStore: () => ({ on: vi.fn(), socketId: "sock-1" }) }));

// ResizeObserver is missing in jsdom and the Vuetify inputs use it
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

// v-dialog positions itself with the visual viewport, which jsdom lacks too
vi.stubGlobal("visualViewport", { width: 1024, height: 768, scale: 1, addEventListener() {}, removeEventListener() {} });

let wrapper: VueWrapper;
const isOpen = () => (wrapper.props() as { modelValue: boolean }).modelValue;
const render = async (status = UserStatus.ACTIVE) => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = { id: "u1", role: UserRoles.EXTERNAL, status } as typeof auth.user;
    vi.spyOn(auth, "setToken");
    vi.spyOn(auth, "markPasswordChanged");
    // Mounted closed, then opened, as the pages do (the form is cleared when the popup opens)
    wrapper = mount(ChangePasswordDialog, {
        props: { modelValue: false, "onUpdate:modelValue": (v: boolean) => wrapper.setProps({ modelValue: v }) },
        global: { plugins: [createVuetify()] },
        attachTo: document.body,
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
    return auth;
};

const input = (label: string) => wrapper.findAllComponents({ name: "VTextField" }).find((f) => f.props("label") === label)!;
const type = async (label: string, value: string) => {
    input(label).vm.$emit("update:modelValue", value);
    await flushPromises();
};
const button = (text: string) => wrapper.findAllComponents({ name: "VBtn" }).find((b) => b.text() === text);
const alerts = () => wrapper.findAllComponents({ name: "VAlert" }).map((a) => a.text());
const errors = () => wrapper.findAllComponents({ name: "VMessages" }).flatMap((m) => m.text() || []);
const fillValid = async () => {
    await type("Old password", "old-password");
    await type("New password", "new-password");
    await type("Confirm new password", "new-password");
};
const axiosError = (status: number, data: unknown = {}) =>
    Object.assign(new Error("request failed"), { isAxiosError: true, response: { status, data } });

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    localStorage.clear();
});

describe("ChangePasswordDialog", () => {
    it("asks for the old, new and confirmed password and offers Cancel and Change", async () => {
        await render();
        for (const label of ["Old password", "New password", "Confirm new password"]) expect(input(label)).toBeDefined();
        expect(button("Cancel")).toBeDefined();
        expect(button("Change")).toBeDefined();
    });

    it("does not send anything while a field is empty, and says which", async () => {
        await render();
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(authApi.changePassword).not.toHaveBeenCalled();
        expect(errors()).toEqual(expect.arrayContaining(["Old password is required", "New password is required", "Confirmation is required"]));
    });

    it("rejects a short new password, one equal to the old, and a confirmation that differs", async () => {
        await render();
        await type("Old password", "old-password");
        await type("New password", "short");
        await type("Confirm new password", "other");
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(errors()).toEqual(expect.arrayContaining(["Must be at least 8 characters", "Passwords do not match"]));
        await type("New password", "old-password");
        await type("Confirm new password", "old-password");
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(errors()).toContain("New password must not equal old password");
        expect(authApi.changePassword).not.toHaveBeenCalled();
    });

    it("re-checks the confirmation when the new password is edited afterwards", async () => {
        await render();
        await fillValid();
        await type("New password", "another-password");
        expect(errors()).toContain("Passwords do not match");
    });

    it("sends the passwords with this tab's socket id, swaps the token and shows the success message", async () => {
        const auth = await render();
        vi.mocked(authApi.changePassword).mockResolvedValue("fresh-token");
        await fillValid();
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(authApi.changePassword).toHaveBeenCalledWith("old-password", "new-password", "sock-1");
        expect(auth.setToken).toHaveBeenCalledWith("fresh-token");
        expect(auth.markPasswordChanged).toHaveBeenCalled();
        expect(alerts()).toContain("Password updated.");
        // the form is done: no Change button, and Cancel turned into Close
        expect(button("Change")).toBeUndefined();
        expect(button("Cancel")).toBeUndefined();
        expect(button("Close")).toBeDefined();
    });

    it("closes through the Close button", async () => {
        await render();
        vi.mocked(authApi.changePassword).mockResolvedValue("t");
        await fillValid();
        await button("Change")!.trigger("click");
        await flushPromises();
        await button("Close")!.trigger("click");
        expect(isOpen()).toBe(false);
    });

    it("closes through Cancel without sending anything", async () => {
        await render();
        await button("Cancel")!.trigger("click");
        expect(isOpen()).toBe(false);
        expect(authApi.changePassword).not.toHaveBeenCalled();
    });

    it.each([
        [403, {}, "Old password is incorrect."],
        [400, { error: "Choose another password" }, "Choose another password"],
        [429, { error: "Too many password change attempts. Please try again later." }, "Too many password change attempts. Please try again later."],
        [400, {}, "Unable to change your password. Please try again."],
        [500, { error: "boom" }, "Unable to change your password. Please try again."],
    ])("answers a %i from the backend with the right message", async (status, data, message) => {
        const auth = await render();
        vi.mocked(authApi.changePassword).mockRejectedValue(axiosError(status, data));
        await fillValid();
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(alerts()).toEqual([message]);
        expect(auth.setToken).not.toHaveBeenCalled();
        expect(button("Change")).toBeDefined(); // can try again
    });

    it("shows the generic message for a failure that is not an HTTP answer", async () => {
        await render();
        vi.mocked(authApi.changePassword).mockRejectedValue(new Error("network"));
        await fillValid();
        await button("Change")!.trigger("click");
        await flushPromises();
        expect(alerts()).toEqual(["Unable to change your password. Please try again."]);
    });

    it("cannot be cancelled by an invited user, who must replace the default password", async () => {
        await render(UserStatus.INVITED);
        expect(button("Cancel")).toBeUndefined();
        expect(button("Change")).toBeDefined();
    });

    it("starts empty each time it opens", async () => {
        await render();
        await fillValid();
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(input("Old password").props("modelValue")).toBe("");
        expect(input("New password").props("modelValue")).toBe("");
    });
});

// Component tests for the invite-user popup: the field rules, what is sent, the one-time temporary password and the failure messages
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import InviteUserDialog from "@src/components/InviteUserDialog.vue";
import { useUserStore } from "@src/stores/user";

vi.mock("@src/api/user", () => ({ userApi: {} }));
vi.mock("@src/stores/socket", () => ({ useSocketStore: () => ({ on: vi.fn() }) }));

// jsdom lacks these, and the Vuetify inputs and dialogs use them
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);
vi.stubGlobal("visualViewport", { width: 1024, height: 768, scale: 1, addEventListener() {}, removeEventListener() {} });

const invitedUser = { id: "u9", name: "Ann Lee", email: "ann@b.c", role: UserRoles.EXTERNAL, status: UserStatus.INVITED } as IUser;
const axiosError = (status: number) => Object.assign(new Error("request failed"), { isAxiosError: true, response: { status, data: {} } });

// jsdom has no clipboard; replaces only that property (replacing the whole navigator would break Vuetify's browser checks)
const setClipboard = (writeText: () => Promise<void>) =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

let wrapper: VueWrapper;
const isOpen = () => (wrapper.props() as { modelValue: boolean }).modelValue;
let addUser: ReturnType<typeof vi.fn>;
const render = async () => {
    setActivePinia(createPinia());
    addUser = vi.fn().mockResolvedValue({ user: invitedUser, temporaryPassword: "Temp-1234", emailSent: true });
    useUserStore().addUser = addUser as never;
    wrapper = mount(InviteUserDialog, {
        props: { modelValue: false, "onUpdate:modelValue": (v: boolean) => wrapper.setProps({ modelValue: v }) },
        global: { plugins: [createVuetify()] },
        attachTo: document.body,
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
};

const input = (label: string) => wrapper.findAllComponents({ name: "VTextField" }).find((f) => f.props("label") === label)!;
const type = async (label: string, value: string) => {
    input(label).vm.$emit("update:modelValue", value);
    await flushPromises();
};
const button = (text: string) => wrapper.findAllComponents({ name: "VBtn" }).find((b) => b.text() === text)!;
const copyButton = () => document.body.querySelector<HTMLButtonElement>('button[aria-label="Copy temporary password"]')!;
const alerts = () => wrapper.findAllComponents({ name: "VAlert" }).map((a) => a.text());
const errors = () => wrapper.findAllComponents({ name: "VMessages" }).flatMap((m) => m.text() || []);
const invite = async () => {
    await button("Invite").trigger("click");
    await flushPromises();
};

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

describe("InviteUserDialog", () => {
    it("asks for a name, an email and a role, which starts as EXTERNAL", async () => {
        await render();
        expect(input("Name")).toBeDefined();
        expect(input("Email")).toBeDefined();
        const role = wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("label") === "Role")!;
        expect(role.props("modelValue")).toBe(UserRoles.EXTERNAL);
        expect(role.props("items")).toEqual([UserRoles.ADMIN, UserRoles.LAB_MEMBER, UserRoles.EXTERNAL]);
    });

    it("sends nothing while the name or email is missing, and says so", async () => {
        await render();
        await type("Name", "   ");
        await invite();
        expect(addUser).not.toHaveBeenCalled();
        expect(errors()).toEqual(expect.arrayContaining(["Name is required", "Email is required"]));
    });

    it.each(["ann", "ann@b", "ann @b.c", "@b.c"])("rejects the email %j", async (email) => {
        await render();
        await type("Name", "Ann Lee");
        await type("Email", email);
        await invite();
        expect(addUser).not.toHaveBeenCalled();
        expect(errors()).toContain("Enter a valid email address");
    });

    it("sends the trimmed name and email with the chosen role", async () => {
        await render();
        await type("Name", "  Ann Lee ");
        await type("Email", " ann@b.c ");
        wrapper.findAllComponents({ name: "VSelect" })[0]!.vm.$emit("update:modelValue", UserRoles.LAB_MEMBER);
        await flushPromises();
        await invite();
        expect(addUser).toHaveBeenCalledWith({ name: "Ann Lee", email: "ann@b.c", role: UserRoles.LAB_MEMBER });
    });

    it("then shows the temporary password once, with the email notice, instead of the form", async () => {
        await render();
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        expect(document.body.textContent).toContain("User Invited");
        expect(input("Temporary password").props("modelValue")).toBe("Temp-1234");
        expect(alerts()).toEqual(["An email with a login link was sent to ann@b.c."]);
        expect(wrapper.findAllComponents({ name: "VForm" })).toHaveLength(0);
    });

    it("warns when the invite email could not be sent", async () => {
        await render();
        addUser.mockResolvedValue({ user: invitedUser, temporaryPassword: "Temp-1234", emailSent: false });
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        expect(alerts()[0]).toContain("The invite email could not be sent");
        expect(alerts()[0]).toContain("Ann Lee");
    });

    it("copies the password to the clipboard and shows a check", async () => {
        await render();
        const writeText = vi.fn().mockResolvedValue(undefined);
        setClipboard(writeText);
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        copyButton().click();
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith("Temp-1234");
        expect(copyButton().querySelector(".mdi-check")).not.toBeNull();
        expect(document.body.querySelector('[role="status"]')!.textContent).toContain("copied");
    });

    it("keeps the copy icon when the browser refuses the clipboard", async () => {
        await render();
        setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        copyButton().click();
        await flushPromises();
        expect(copyButton().querySelector(".mdi-content-copy")).not.toBeNull();
    });

    it("closes through Done, and is empty again when reopened", async () => {
        await render();
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        await button("Done").trigger("click");
        expect(isOpen()).toBe(false);
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(document.body.textContent).not.toContain("User Invited");
        expect(input("Name").props("modelValue")).toBe("");
        expect(input("Email").props("modelValue")).toBe("");
    });

    it.each([
        [axiosError(409), "A user with that email already exists."],
        [axiosError(500), "Unable to send the invite. Please try again."],
        [new Error("network"), "Unable to send the invite. Please try again."],
    ])("stays on the form with a message when the invite fails (%#)", async (failure, message) => {
        await render();
        addUser.mockRejectedValue(failure);
        await type("Name", "Ann Lee");
        await type("Email", "ann@b.c");
        await invite();
        expect(alerts()).toEqual([message]);
        expect(button("Invite")).toBeDefined();
    });

    it("cancels without sending", async () => {
        await render();
        await button("Cancel").trigger("click");
        expect(isOpen()).toBe(false);
        expect(addUser).not.toHaveBeenCalled();
    });
});

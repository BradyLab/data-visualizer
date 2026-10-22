// Component tests for the admin's edit-user popup: the offered values, what is saved, the rule for editing yourself and the failure message
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import EditUserDialog from "@src/components/EditUserDialog.vue";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";

vi.mock("@src/api/user", () => ({ userApi: {} }));
vi.mock("@src/api/auth", () => ({ authApi: {} }));
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

const makeUser = (over: Partial<IUser> = {}) =>
    ({ id: "u2", name: "Sam Lee", email: "sam@b.c", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE, ...over }) as IUser;

let wrapper: VueWrapper;
const isOpen = () => (wrapper.props() as { modelValue: boolean }).modelValue;
let editUser: ReturnType<typeof vi.fn>;
const render = async (user: IUser | null = makeUser()) => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    auth.user = { id: "admin", role: UserRoles.ADMIN, status: UserStatus.ACTIVE } as typeof auth.user;
    editUser = vi.fn().mockResolvedValue(undefined);
    useUserStore().editUser = editUser as never;
    wrapper = mount(EditUserDialog, {
        props: { user, modelValue: false, "onUpdate:modelValue": (v: boolean) => wrapper.setProps({ modelValue: v }) },
        global: { plugins: [createVuetify()] },
        attachTo: document.body,
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
};

const select = (label: string) => wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("label") === label);
const pick = async (label: string, value: string) => {
    select(label)!.vm.$emit("update:modelValue", value);
    await flushPromises();
};
const button = (text: string) => wrapper.findAllComponents({ name: "VBtn" }).find((b) => b.text() === text)!;
const alerts = () => wrapper.findAllComponents({ name: "VAlert" }).map((a) => a.text());

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

describe("EditUserDialog", () => {
    it("is titled with the user and starts with their current role and status", async () => {
        await render(makeUser({ role: UserRoles.LAB_MEMBER, status: UserStatus.INACTIVE }));
        expect(document.body.textContent).toContain("Sam Lee (sam@b.c)");
        expect(select("Role")!.props("modelValue")).toBe(UserRoles.LAB_MEMBER);
        expect(select("Status")!.props("modelValue")).toBe(UserStatus.INACTIVE);
    });

    it("does not offer GUEST as a role or INVITED as a status", async () => {
        await render();
        expect(select("Role")!.props("items")).toEqual([UserRoles.ADMIN, UserRoles.LAB_MEMBER, UserRoles.EXTERNAL]);
        expect(select("Status")!.props("items")).toEqual([UserStatus.ACTIVE, UserStatus.INACTIVE]);
    });

    it("saves the chosen role and status and closes", async () => {
        await render();
        await pick("Role", UserRoles.LAB_MEMBER);
        await pick("Status", UserStatus.INACTIVE);
        await button("Save").trigger("click");
        await flushPromises();
        expect(editUser).toHaveBeenCalledWith("u2", { role: UserRoles.LAB_MEMBER, status: UserStatus.INACTIVE });
        expect(isOpen()).toBe(false);
    });

    it("hides the status of an invited user and saves only the role", async () => {
        await render(makeUser({ status: UserStatus.INVITED }));
        expect(select("Status")).toBeUndefined();
        await pick("Role", UserRoles.ADMIN);
        await button("Save").trigger("click");
        await flushPromises();
        expect(editUser).toHaveBeenCalledWith("u2", { role: UserRoles.ADMIN });
    });

    it("keeps the popup open and shows an error when saving fails, and can be retried", async () => {
        await render();
        editUser.mockRejectedValueOnce(new Error("nope"));
        await button("Save").trigger("click");
        await flushPromises();
        expect(alerts()).toEqual(["Unable to save changes. Please try again."]);
        expect(isOpen()).toBe(true);
        await button("Save").trigger("click");
        await flushPromises();
        expect(alerts()).toEqual([]);
        expect(isOpen()).toBe(false);
    });

    it("cancels without saving", async () => {
        await render();
        await button("Cancel").trigger("click");
        expect(isOpen()).toBe(false);
        expect(editUser).not.toHaveBeenCalled();
    });

    it("does not let an admin change their own role or status", async () => {
        await render(makeUser({ id: "admin", role: UserRoles.ADMIN }));
        expect(alerts()).toEqual(["You can't change your own role or status."]);
        expect(select("Role")!.props("disabled")).toBe(true);
        expect(select("Status")!.props("disabled")).toBe(true);
        expect(button("Save").props("disabled")).toBe(true);
        await button("Save").trigger("click");
        expect(editUser).not.toHaveBeenCalled();
    });

    it("forgets edits that were not saved when it is opened again", async () => {
        await render();
        await pick("Role", UserRoles.ADMIN);
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(select("Role")!.props("modelValue")).toBe(UserRoles.EXTERNAL);
    });

    it("renders nothing without a user", async () => {
        await render(null);
        expect(document.body.textContent).not.toContain("Save");
    });
});

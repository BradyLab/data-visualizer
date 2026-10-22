// Component tests for the new-permission popup: who and what can be picked, the levels each role may hold, what is sent and the failures
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { PermissionOptions } from "@commons/permissions";
import type { IDataset } from "@commons/dataset";
import { UserRoles, UserStatus } from "@commons/user";
import NewPermissionDialog from "@src/components/NewPermissionDialog.vue";
import { usePermissionStore } from "@src/stores/permission";
import { useUserStore } from "@src/stores/user";

vi.mock("@src/api/user", () => ({ userApi: {} }));
vi.mock("@src/api/permission", () => ({ permissionApi: {} }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => ({}) }));
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

const datasets = [
    { id: "d1", name: "Liver", owner: "ext-a" },
    { id: "d2", name: "Brain", owner: "someone" },
] as IDataset[];
const axiosError = (status: number) => Object.assign(new Error("request failed"), { isAxiosError: true, response: { status, data: {} } });

let wrapper: VueWrapper;
const isOpen = () => (wrapper.props() as { modelValue: boolean }).modelValue;
let addPermission: ReturnType<typeof vi.fn>;
const render = async () => {
    setActivePinia(createPinia());
    useUserStore().names = [
        { id: "admin", name: "Ada", role: UserRoles.ADMIN, status: UserStatus.ACTIVE },
        { id: "lab", name: "Lou", role: UserRoles.LAB_MEMBER, status: UserStatus.ACTIVE },
        { id: "ext-a", name: "Eve", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE },
        { id: "ext-b", name: "Ed", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE },
        { id: "gone", name: "Gus", role: UserRoles.EXTERNAL, status: UserStatus.INACTIVE },
    ] as never;
    addPermission = vi.fn().mockResolvedValue(undefined);
    usePermissionStore().addPermission = addPermission as never;
    wrapper = mount(NewPermissionDialog, {
        props: { datasets, modelValue: false, "onUpdate:modelValue": (v: boolean) => wrapper.setProps({ modelValue: v }) },
        global: { plugins: [createVuetify()] },
        attachTo: document.body,
    });
    await wrapper.setProps({ modelValue: true });
    await flushPromises();
};

const select = (label: string) => wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("label") === label)!;
const pick = async (label: string, value: string) => {
    select(label).vm.$emit("update:modelValue", value);
    await flushPromises();
};
const ids = (label: string) => (select(label).props("items") as { id: string }[]).map((i) => i.id);
const button = (text: string) => wrapper.findAllComponents({ name: "VBtn" }).find((b) => b.text() === text)!;
const alerts = () => wrapper.findAllComponents({ name: "VAlert" }).map((a) => a.text());
const errors = () => wrapper.findAllComponents({ name: "VMessages" }).flatMap((m) => m.text() || []);
const create = async () => {
    await button("Create").trigger("click");
    await flushPromises();
};

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
});

describe("NewPermissionDialog", () => {
    it("offers the datasets it was given", async () => {
        await render();
        expect(ids("Dataset")).toEqual(["d1", "d2"]);
    });

    it("offers neither admins nor deactivated users", async () => {
        await render();
        expect(ids("User")).toEqual(["lab", "ext-a", "ext-b"]);
    });

    it("leaves out the chosen dataset's owner, and clears them if already picked", async () => {
        await render();
        await pick("Dataset", "d2");
        await pick("User", "ext-a");
        expect(select("User").props("modelValue")).toBe("ext-a");
        await pick("Dataset", "d1"); // owned by ext-a
        expect(ids("User")).toEqual(["lab", "ext-b"]);
        expect(select("User").props("modelValue")).toBeNull();
    });

    it("disables the level until a user is picked, then offers only the levels their role may hold", async () => {
        await render();
        expect(select("Permission").props("disabled")).toBe(true);
        await pick("User", "ext-b");
        expect(select("Permission").props("disabled")).toBe(false);
        expect(select("Permission").props("items")).toEqual([PermissionOptions.VIEW, PermissionOptions.DOWNLOAD]);
        expect(select("Permission").props("modelValue")).toBe(PermissionOptions.VIEW);
        await pick("User", "lab");
        expect(select("Permission").props("items")).toEqual([PermissionOptions.EDIT]);
        expect(select("Permission").props("modelValue")).toBe(PermissionOptions.EDIT);
    });

    it("keeps a level that the next user may also hold", async () => {
        await render();
        await pick("User", "ext-b");
        await pick("Permission", PermissionOptions.DOWNLOAD);
        await pick("User", "ext-a");
        expect(select("Permission").props("modelValue")).toBe(PermissionOptions.DOWNLOAD);
    });

    it("asks for a dataset and a user before sending", async () => {
        await render();
        await create();
        expect(addPermission).not.toHaveBeenCalled();
        expect(errors()).toEqual(expect.arrayContaining(["Dataset is required", "User is required", "Permission is required"]));
    });

    it("grants the chosen level and closes", async () => {
        await render();
        await pick("Dataset", "d2");
        await pick("User", "ext-b");
        await pick("Permission", PermissionOptions.DOWNLOAD);
        await create();
        expect(addPermission).toHaveBeenCalledWith({ user_id: "ext-b", dataset_id: "d2", perm: PermissionOptions.DOWNLOAD });
        expect(isOpen()).toBe(false);
    });

    it.each([
        [axiosError(409), "This user already has a permission on this dataset. Edit the existing one instead."],
        [axiosError(500), "Unable to create the permission. Please try again."],
        [new Error("network"), "Unable to create the permission. Please try again."],
    ])("stays open with a message when granting fails (%#)", async (failure, message) => {
        await render();
        addPermission.mockRejectedValue(failure);
        await pick("Dataset", "d2");
        await pick("User", "ext-b");
        await create();
        expect(alerts()).toEqual([message]);
        expect(isOpen()).toBe(true);
    });

    it("starts empty each time it opens", async () => {
        await render();
        await pick("Dataset", "d2");
        await pick("User", "ext-b");
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await flushPromises();
        expect(select("Dataset").props("modelValue")).toBeNull();
        expect(select("User").props("modelValue")).toBeNull();
        expect(select("Permission").props("modelValue")).toBeNull();
    });

    it("cancels without sending", async () => {
        await render();
        await button("Cancel").trigger("click");
        expect(isOpen()).toBe(false);
        expect(addPermission).not.toHaveBeenCalled();
    });
});

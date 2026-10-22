// Component tests for the admin user table: loading, filters, and the buttons of each row (stores and router are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import UserManagement from "@src/views/admin/UserManagement.vue";

const fake = vi.hoisted(() => ({ auth: null as never as { isAdmin: boolean }, users: null as never as { users: unknown[]; fetchUsers: () => Promise<void> }, push: vi.fn() }));

vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }) }));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => fake.auth }));
vi.mock("@src/stores/user", () => ({ useUserStore: () => fake.users }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const user = (id: string, role: UserRoles, status: UserStatus): IUser =>
    ({ id, name: `Name ${id}`, email: `${id}@lab.org`, role, status }) as IUser;
const people = [
    user("u1", UserRoles.LAB_MEMBER, UserStatus.ACTIVE),
    user("u2", UserRoles.EXTERNAL, UserStatus.ACTIVE),
    user("u3", UserRoles.EXTERNAL, UserStatus.INVITED),
    user("u4", UserRoles.LAB_MEMBER, UserStatus.INACTIVE),
];

const stubs = {
    EditUserDialog: { name: "EditUserDialog", props: ["modelValue", "user"], template: "<div class='edit-dialog' />" },
    InviteUserDialog: { name: "InviteUserDialog", props: ["modelValue"], template: "<div class='invite-dialog' />" },
};
const render = async () => {
    const wrapper = mount(UserManagement, { global: { plugins: [createVuetify()], stubs } });
    await flushPromises();
    return wrapper;
};
const rowNames = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.findAll("tbody tr").map((r) => r.findAll("td")[0]!.text());
const button = (wrapper: Awaited<ReturnType<typeof render>>, text: string) => wrapper.findAll("button").filter((b) => b.text().includes(text));

beforeEach(() => {
    vi.clearAllMocks();
    fake.auth = reactive({ isAdmin: true });
    fake.users = reactive({ users: [...people], fetchUsers: vi.fn().mockResolvedValue(undefined) });
});

describe("UserManagement", () => {
    it("loads the users and lists each with name, email, role and status", async () => {
        const wrapper = await render();
        expect(fake.users.fetchUsers).toHaveBeenCalledOnce();
        expect(rowNames(wrapper)).toEqual(["Name u1", "Name u2", "Name u3", "Name u4"]);
        const first = wrapper.findAll("tbody tr")[0]!.text();
        expect(first).toContain("u1@lab.org");
        expect(first).toContain(UserRoles.LAB_MEMBER);
        expect(first).toContain(UserStatus.ACTIVE);
    });

    it("renders nothing for someone who is not an admin", async () => {
        fake.auth.isAdmin = false;
        const wrapper = await render();
        expect(wrapper.find("h1").exists()).toBe(false);
    });

    it("shows an error, which can be closed, when the users cannot be loaded", async () => {
        fake.users.fetchUsers = vi.fn().mockRejectedValue(new Error("down"));
        const wrapper = await render();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to load the users");
        await wrapper.find(".v-alert .v-alert__close button").trigger("click");
        expect(wrapper.find(".v-alert").exists()).toBe(false);
    });

    it("filters by status and by role, each filter showing a chip that removes it", async () => {
        const wrapper = await render();
        const vm = wrapper.vm as unknown as { statusFilter: UserStatus[]; roleFilter: UserRoles[] };
        vm.statusFilter = [UserStatus.ACTIVE, UserStatus.INVITED];
        await flushPromises();
        expect(rowNames(wrapper)).toEqual(["Name u1", "Name u2", "Name u3"]);
        vm.roleFilter = [UserRoles.EXTERNAL];
        await flushPromises();
        expect(rowNames(wrapper)).toEqual(["Name u2", "Name u3"]);
        const chips = wrapper.findAll(".v-chip");
        expect(chips.map((c) => c.text())).toEqual([`Status: ${UserStatus.ACTIVE}`, `Status: ${UserStatus.INVITED}`, `Role: ${UserRoles.EXTERNAL}`]);
        await chips[2]!.find(".v-chip__close").trigger("click");
        expect(vm.roleFilter).toEqual([]);
        await chips[0]!.find(".v-chip__close").trigger("click");
        expect(vm.statusFilter).toEqual([UserStatus.INVITED]);
        await flushPromises();
        expect(rowNames(wrapper)).toEqual(["Name u3"]);
    });

    it("has no chips while nothing is filtered", async () => {
        expect((await render()).findAll(".v-chip")).toHaveLength(0);
    });

    it("offers every status, including INVITED, but only the assignable roles", async () => {
        const wrapper = await render();
        const vm = wrapper.vm as unknown as { statusOptions: string[]; roleOptions: string[] };
        expect(vm.statusOptions).toEqual(Object.values(UserStatus));
        expect(vm.roleOptions).not.toContain(UserRoles.GUEST);
    });

    it("opens the edit popup for the clicked user", async () => {
        const wrapper = await render();
        await button(wrapper, "Edit")[1]!.trigger("click");
        const dialog = wrapper.findComponent({ name: "EditUserDialog" });
        expect(dialog.props("modelValue")).toBe(true);
        expect((dialog.props("user") as IUser).id).toBe("u2");
    });

    it("opens the invite popup", async () => {
        const wrapper = await render();
        expect(wrapper.findComponent({ name: "InviteUserDialog" }).props("modelValue")).toBe(false);
        await button(wrapper, "Invite User")[0]!.trigger("click");
        expect(wrapper.findComponent({ name: "InviteUserDialog" }).props("modelValue")).toBe(true);
    });

    it("jumps to the permissions and the activity logs of a user", async () => {
        const wrapper = await render();
        await button(wrapper, "Permissions")[2]!.trigger("click");
        expect(fake.push).toHaveBeenLastCalledWith({ name: "permissions", query: { user: "u3" } });
        await button(wrapper, "Activity Logs")[0]!.trigger("click");
        expect(fake.push).toHaveBeenLastCalledWith({ name: "activity-logs", query: { user: "u1" } });
    });
});

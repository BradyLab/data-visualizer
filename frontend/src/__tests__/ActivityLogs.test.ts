// Component tests for the admin activity log: server-side paging and filters, name lookup, expandable data (stores and route are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { ActivityType, type IActivity } from "@commons/activity";
import ActivityLogs from "@src/views/admin/ActivityLogs.vue";

type Fake = {
    route: { query: Record<string, unknown> };
    auth: { isAdmin: boolean };
    users: { users: { id: string; name: string }[]; fetchUsers: ReturnType<typeof vi.fn>; getById: (id: string) => { id: string; name: string } | undefined };
    activities: { activities: IActivity[]; total: number; fetchActivities: ReturnType<typeof vi.fn> };
};
const fake = vi.hoisted(() => ({}) as Fake);

vi.mock("vue-router", () => ({ useRoute: () => fake.route }));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => fake.auth }));
vi.mock("@src/stores/user", () => ({ useUserStore: () => fake.users }));
vi.mock("@src/stores/activity", () => ({ useActivityStore: () => fake.activities }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const act = (id: string, user_id: string | null, type = ActivityType.USER_UPDATED, data: Record<string, unknown> = { a: 1 }) =>
    ({ id, user_id, type, data, createdAt: "2026-10-08T15:45:00" }) as unknown as IActivity;

type Vm = { typeFilter: ActivityType[]; userFilter: string[]; page: number; itemsPerPage: number; expanded: string[] };
const render = async () => {
    const wrapper = mount(ActivityLogs, { global: { plugins: [createVuetify()] } });
    await flushPromises();
    return { wrapper, vm: wrapper.vm as unknown as Vm };
};
const lastQuery = () => fake.activities.fetchActivities.mock.lastCall![0];

beforeEach(() => {
    vi.clearAllMocks();
    fake.route = reactive({ query: {} });
    fake.auth = reactive({ isAdmin: true });
    const users = [{ id: "u1", name: "Ada" }, { id: "u2", name: "Bo" }];
    fake.users = reactive({ users, fetchUsers: vi.fn().mockResolvedValue(undefined), getById: (id: string) => users.find((u) => u.id === id) });
    fake.activities = reactive({
        activities: [act("a1", "u1", ActivityType.PERM_GRANTED), act("a2", "ghost"), act("a3", null, ActivityType.USER_DELETED)],
        total: 60,
        fetchActivities: vi.fn().mockResolvedValue(undefined),
    });
});

describe("ActivityLogs", () => {
    it("loads the first page and the users on mount", async () => {
        await render();
        expect(lastQuery()).toEqual({ user_id: [], type: [], limit: 25, offset: 0 });
        expect(fake.users.fetchUsers).toHaveBeenCalledOnce();
    });

    it("renders nothing for someone who is not an admin", async () => {
        fake.auth.isAdmin = false;
        const { wrapper } = await render();
        expect(wrapper.find("h1").exists()).toBe(false);
    });

    it("shows the type label, the user's name, an id when the user is not loaded, and 'Deleted user' without one", async () => {
        const { wrapper } = await render();
        const rows = wrapper.findAll("tbody tr").map((r) => r.findAll("td").map((c) => c.text()));
        expect(rows.map((r) => r.slice(0, 2))).toEqual([
            ["Permission Granted", "Ada"],
            ["User Updated", "ghost"],
            ["User Deleted", "Deleted user"],
        ]);
        expect(rows[0]![3]).toBe("October 8, 2026 at 3:45 PM");
    });

    it("presets the user filter from ?user= and follows later changes of it", async () => {
        fake.route.query = { user: "u2" };
        const { wrapper, vm } = await render();
        expect(lastQuery().user_id).toEqual(["u2"]);
        expect(wrapper.find(".v-chip").text()).toBe("User: Bo");
        fake.route.query = { user: "u1" };
        await flushPromises();
        expect(vm.userFilter).toEqual(["u1"]);
        fake.route.query = {};
        await flushPromises();
        expect(vm.userFilter).toEqual([]);
    });

    it("reloads from the first page when a filter changes, and chips remove their filter", async () => {
        const { wrapper, vm } = await render();
        vm.page = 2;
        await flushPromises();
        expect(lastQuery().offset).toBe(25);
        vm.typeFilter = [ActivityType.FILE_UPLOADED];
        await flushPromises();
        expect(vm.page).toBe(1);
        expect(lastQuery()).toEqual({ user_id: [], type: [ActivityType.FILE_UPLOADED], limit: 25, offset: 0 });
        expect(wrapper.find(".v-chip").text()).toBe("Type: File Uploaded");
        await wrapper.find(".v-chip .v-chip__close").trigger("click");
        await flushPromises();
        expect(lastQuery().type).toEqual([]);
        expect(wrapper.findAll(".v-chip")).toHaveLength(0);
    });

    it("starts again from the first page when the page size changes", async () => {
        const { vm } = await render();
        vm.page = 3;
        await flushPromises();
        vm.itemsPerPage = 10;
        await flushPromises();
        expect(vm.page).toBe(1);
        expect(lastQuery()).toMatchObject({ limit: 10, offset: 0 });
    });

    it("reports a failed load, and a newer successful load clears it", async () => {
        fake.activities.fetchActivities.mockRejectedValueOnce(new Error("down"));
        const { wrapper, vm } = await render();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to load the activity log");
        vm.typeFilter = [ActivityType.USER_JOINED];
        await flushPromises();
        expect(wrapper.find(".v-alert").exists()).toBe(false);
    });

    it("a slow failed request does not hide the result of a newer one", async () => {
        let rejectSlow: (e: Error) => void = () => {};
        fake.activities.fetchActivities.mockReset();
        fake.activities.fetchActivities.mockImplementationOnce(() => new Promise((_, reject) => (rejectSlow = reject)));
        const { wrapper, vm } = await render();
        fake.activities.fetchActivities.mockResolvedValue(undefined);
        vm.typeFilter = [ActivityType.USER_JOINED];
        await flushPromises();
        rejectSlow(new Error("late"));
        await flushPromises();
        expect(wrapper.find(".v-alert").exists()).toBe(false);
    });

    it("says that users are shown by id when their names cannot be loaded", async () => {
        fake.users.fetchUsers.mockRejectedValue(new Error("down"));
        const { wrapper } = await render();
        expect(wrapper.find(".v-alert").text()).toContain("users are shown by id");
    });

    it("expands and collapses long data only", async () => {
        fake.activities.activities = [
            act("short", "u1", ActivityType.USER_UPDATED, { a: 1 }),
            act("long", "u1", ActivityType.USER_UPDATED, { a: 1, b: 2, c: 3, d: 4 }),
        ];
        const { wrapper, vm } = await render();
        // Only the long data gets a toggle button; the short data has nothing to expand
        const toggles = wrapper.findAll("tbody button");
        expect(toggles).toHaveLength(1);
        const [, long] = wrapper.findAll("tbody pre");
        expect(toggles[0]!.text()).toBe("Show more");
        expect(toggles[0]!.attributes("aria-expanded")).toBe("false");
        expect(toggles[0]!.attributes("aria-controls")).toBe(long!.attributes("id"));
        expect(long!.attributes("style")).toContain("line-clamp");
        await toggles[0]!.trigger("click");
        await nextTick();
        expect(vm.expanded).toEqual(["long"]);
        expect(wrapper.findAll("tbody pre")[1]!.attributes("style")).not.toContain("line-clamp");
        expect(wrapper.find("tbody button").text()).toBe("Show less");
        expect(wrapper.find("tbody button").attributes("aria-expanded")).toBe("true");
        await wrapper.find("tbody button").trigger("click");
        expect(vm.expanded).toEqual([]);
    });
});

// Tests for the activity store: paging, the lookup by id and the live updates from the socket (the API and the socket are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { ActivityType, type IActivity } from "@commons/activity";
import { SocketEvent } from "@commons/socket";
import { activityApi } from "@src/api/activity";
import { useActivityStore } from "@src/stores/activity";

const socket = vi.hoisted(() => ({ handlers: new Map<string, (...args: never[]) => void>(), reconnects: { value: 0 } }));

vi.mock("@src/api/activity", () => ({ activityApi: { getActivities: vi.fn(), getByUser: vi.fn() } }));
// One shared fake socket store, so a test can fire a server event at the handler the store registered
vi.mock("@src/stores/socket", async () => {
    const { ref, reactive } = await import("vue");
    // reactive() unwraps the ref like a Pinia store does, so the store's watch on `reconnects` sees the number change.
    // Each test's store gets its own counter, so the watchers of earlier tests' stores stay quiet
    return {
        useSocketStore: () => {
            socket.reconnects = ref(0);
            return reactive({
                on: (event: string, handler: (...args: never[]) => void) => socket.handlers.set(event, handler),
                reconnects: socket.reconnects,
            });
        },
    };
});

const activity = (id: string, user_id: string | null = "u1", type = ActivityType.USER_UPDATED) => ({ id, user_id, type }) as IActivity;
const page = (rows: IActivity[], total = rows.length) => ({ rows, total });
const push = (a: IActivity) => (socket.handlers.get(SocketEvent.ACTIVITY_CREATED) as (e: { activity: IActivity }) => void)({ activity: a });

beforeEach(() => {
    vi.resetAllMocks();
    socket.handlers.clear();
    setActivePinia(createPinia());
});

describe("activity store", () => {
    it("replaces the list and the total with the fetched page", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1"), activity("a2")], 40));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 2, offset: 0 });
        expect(store.activities.map((a) => a.id)).toEqual(["a1", "a2"]);
        expect(store.total).toBe(40);
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a3")], 41));
        await store.fetchActivities({ limit: 2, offset: 2 });
        expect(store.activities.map((a) => a.id)).toEqual(["a3"]);
    });

    it("finds an activity by id in either list, or returns null", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1")]));
        vi.mocked(activityApi.getByUser).mockResolvedValue(page([activity("b1")]));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 10, offset: 0 });
        await store.fetchByUser("u1", { limit: 10, offset: 0 });
        expect(store.getById("a1")?.id).toBe("a1");
        expect(store.getById("b1")?.id).toBe("b1");
        expect(store.getById("zzz")).toBeNull();
    });

    it("shows a pushed activity first on the first page, keeping the page size, and counts it", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1"), activity("a2")], 2));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 2, offset: 0 });
        push(activity("new"));
        expect(store.activities.map((a) => a.id)).toEqual(["new", "a1"]);
        expect(store.total).toBe(3);
    });

    it("only counts a pushed activity when a later page is shown", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a3")], 3));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 2, offset: 2 });
        push(activity("new"));
        expect(store.activities.map((a) => a.id)).toEqual(["a3"]);
        expect(store.total).toBe(4);
    });

    it("ignores a pushed activity that the filters exclude, or that is already listed", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1", "u1", ActivityType.USER_UPDATED)], 1));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 10, offset: 0, user_id: ["u1"], type: [ActivityType.USER_UPDATED] });
        push(activity("x1", "u2"));
        push(activity("x2", null));
        push(activity("x3", "u1", ActivityType.USER_DELETED));
        push(activity("a1"));
        expect(store.activities.map((a) => a.id)).toEqual(["a1"]);
        expect(store.total).toBe(1);
        push(activity("x4", "u1", ActivityType.USER_UPDATED));
        expect(store.activities.map((a) => a.id)).toEqual(["x4", "a1"]);
    });

    it("does nothing with a pushed activity before any list was loaded", () => {
        const store = useActivityStore();
        push(activity("new"));
        expect(store.activities).toEqual([]);
        expect(store.total).toBe(0);
    });

    it("adds a pushed activity of the user whose log is open, on the first page only", async () => {
        vi.mocked(activityApi.getByUser).mockResolvedValue(page([activity("b1"), activity("b2")]));
        const store = useActivityStore();
        await store.fetchByUser("u1", { limit: 2, offset: 0 });
        push(activity("other", "u2"));
        expect(store.userActivities.map((a) => a.id)).toEqual(["b1", "b2"]);
        push(activity("new", "u1"));
        expect(store.userActivities.map((a) => a.id)).toEqual(["new", "b1"]);
        await store.fetchByUser("u1", { limit: 2, offset: 2 });
        push(activity("later", "u1"));
        expect(store.userActivities.map((a) => a.id)).not.toContain("later");
    });

    it("reloads the loaded lists after the socket reconnects", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1")]));
        vi.mocked(activityApi.getByUser).mockResolvedValue(page([activity("b1")]));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 5, offset: 0 });
        await store.fetchByUser("u1", { limit: 5, offset: 0 });
        vi.mocked(activityApi.getActivities).mockResolvedValue(page([activity("a1"), activity("missed")], 2));
        socket.reconnects.value++;
        await nextTick();
        await vi.waitFor(() => expect(store.activities.map((a) => a.id)).toEqual(["a1", "missed"]));
        expect(activityApi.getByUser).toHaveBeenCalledTimes(2);
    });

    it("keeps its lists when the reload after a reconnect fails", async () => {
        vi.mocked(activityApi.getActivities).mockResolvedValueOnce(page([activity("a1")]));
        const store = useActivityStore();
        await store.fetchActivities({ limit: 5, offset: 0 });
        vi.mocked(activityApi.getActivities).mockRejectedValue(new Error("offline"));
        socket.reconnects.value++;
        await nextTick();
        await vi.waitFor(() => expect(activityApi.getActivities).toHaveBeenCalledTimes(2));
        expect(store.activities.map((a) => a.id)).toEqual(["a1"]);
    });
});

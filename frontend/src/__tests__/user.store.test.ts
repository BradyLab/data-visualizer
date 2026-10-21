// Tests for the user store: the cached lists, the names lookup and the live updates (the API and the socket are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { SocketEvent } from "@commons/socket";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { userApi } from "@src/api/user";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";

const socket = vi.hoisted(() => ({ handlers: new Map<string, (...args: never[]) => void>() }));

vi.mock("@src/api/user", () => ({
    userApi: { getUsers: vi.fn(), getNames: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(), deleteUser: vi.fn() },
}));
vi.mock("@src/stores/socket", () => ({
    useSocketStore: () => ({
        on: (event: string, handler: (...args: never[]) => void) => socket.handlers.set(event, handler),
        reconnects: 0,
    }),
}));

const makeUser = (id: string, role = UserRoles.LAB_MEMBER, name = id): IUser =>
    ({ id, email: `${id}@b.c`, name, role, status: UserStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date() }) as IUser;

const loginAs = (user: IUser) => {
    const auth = useAuthStore();
    auth.token = "tok";
    auth.user = user;
};
const fire = (event: SocketEvent, payload: object) => (socket.handlers.get(event) as (p: object) => void)(payload);

beforeEach(() => {
    vi.resetAllMocks();
    socket.handlers.clear();
    setActivePinia(createPinia());
});

describe("lookups", () => {
    it("nameOf gives the loaded name, or the id while the names are not loaded", async () => {
        vi.mocked(userApi.getNames).mockResolvedValue([
            { id: "a", name: "Ada", role: UserRoles.ADMIN, status: UserStatus.ACTIVE },
        ]);
        const store = useUserStore();
        expect(store.nameOf("a")).toBe("a");
        await store.fetchNames();
        expect(store.nameOf("a")).toBe("Ada");
        expect(store.nameOf("zzz")).toBe("zzz");
    });

    it("getById finds a loaded user or returns null", async () => {
        vi.mocked(userApi.getUsers).mockResolvedValue([makeUser("a")]);
        const store = useUserStore();
        await store.fetchUsers();
        expect(store.getById("a")?.id).toBe("a");
        expect(store.getById("b")).toBeNull();
    });
});

describe("changing users", () => {
    it("addUser adds the user to both lists, once, even if the websocket announced them first", async () => {
        vi.mocked(userApi.createUser).mockResolvedValue({ user: makeUser("n"), password: "pw" } as never);
        loginAs(makeUser("admin", UserRoles.ADMIN));
        const store = useUserStore();
        fire(SocketEvent.USER_CHANGED, { user: makeUser("n") });
        const result = await store.addUser({ email: "n@b.c", name: "n", role: UserRoles.LAB_MEMBER } as never);
        expect(result).toMatchObject({ password: "pw" });
        expect(store.users.map((u) => u.id)).toEqual(["n"]);
        expect(store.names.map((u) => u.id)).toEqual(["n"]);
    });

    it("editUser replaces the cached user and updates the name list", async () => {
        vi.mocked(userApi.getUsers).mockResolvedValue([makeUser("a", UserRoles.EXTERNAL, "Old")]);
        vi.mocked(userApi.updateUser).mockResolvedValue(makeUser("a", UserRoles.LAB_MEMBER, "New"));
        const store = useUserStore();
        await store.fetchUsers();
        await store.editUser("a", { name: "New" } as never);
        expect(store.users).toHaveLength(1);
        expect(store.users[0]).toMatchObject({ name: "New", role: UserRoles.LAB_MEMBER });
        expect(store.nameOf("a")).toBe("New");
    });

    it("removeUser drops the user from both lists, but only once the request succeeded", async () => {
        vi.mocked(userApi.getUsers).mockResolvedValue([makeUser("a"), makeUser("b")]);
        const store = useUserStore();
        await store.fetchUsers();
        vi.mocked(userApi.deleteUser).mockRejectedValueOnce(new Error("owns datasets"));
        await expect(store.removeUser("a")).rejects.toThrow("owns datasets");
        expect(store.users).toHaveLength(2);
        vi.mocked(userApi.deleteUser).mockResolvedValueOnce(undefined);
        await store.removeUser("a");
        expect(store.users.map((u) => u.id)).toEqual(["b"]);
    });
});

describe("live updates", () => {
    it("an admin hears about every user; a non-admin only about their own account", () => {
        loginAs(makeUser("admin", UserRoles.ADMIN));
        const store = useUserStore();
        fire(SocketEvent.USER_CHANGED, { user: makeUser("x") });
        fire(SocketEvent.USER_CHANGED, { user: makeUser("x", UserRoles.EXTERNAL, "Renamed") });
        expect(store.users).toHaveLength(1);
        expect(store.users[0]!.role).toBe(UserRoles.EXTERNAL);
    });

    it("replaces the logged-in user when their own account changes, and keeps the list empty for non-admins", () => {
        loginAs(makeUser("me", UserRoles.EXTERNAL));
        const store = useUserStore();
        fire(SocketEvent.USER_CHANGED, { user: makeUser("me", UserRoles.LAB_MEMBER, "Promoted") });
        expect(useAuthStore().user.name).toBe("Promoted");
        expect(store.users).toEqual([]);
    });

    it("name changes only update a names list that was loaded", async () => {
        const store = useUserStore();
        fire(SocketEvent.USER_NAME_CHANGED, { user: { id: "a", name: "A", role: UserRoles.ADMIN, status: UserStatus.ACTIVE } });
        expect(store.names).toEqual([]);
        vi.mocked(userApi.getNames).mockResolvedValue([{ id: "b", name: "B", role: UserRoles.ADMIN, status: UserStatus.ACTIVE }]);
        await store.fetchNames();
        fire(SocketEvent.USER_NAME_CHANGED, { user: { id: "a", name: "A", role: UserRoles.ADMIN, status: UserStatus.ACTIVE } });
        expect(store.names.map((u) => u.id)).toEqual(["b", "a"]);
    });

    it("a deleted user leaves both lists", async () => {
        vi.mocked(userApi.getUsers).mockResolvedValue([makeUser("a"), makeUser("b")]);
        vi.mocked(userApi.getNames).mockResolvedValue([{ id: "a", name: "A", role: UserRoles.ADMIN, status: UserStatus.ACTIVE }]);
        const store = useUserStore();
        await store.fetchUsers();
        await store.fetchNames();
        fire(SocketEvent.USER_DELETED, { id: "a" });
        expect(store.users.map((u) => u.id)).toEqual(["b"]);
        expect(store.names).toEqual([]);
    });
});

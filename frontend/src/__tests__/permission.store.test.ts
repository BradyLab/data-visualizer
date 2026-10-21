// Tests for the permission store: the access rules the UI offers, the cached lists and the live updates (the API and the socket are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { PermissionOptions, type IPermission } from "@commons/permissions";
import { SocketEvent } from "@commons/socket";
import type { IDataset } from "@commons/dataset";
import { UserRoles, UserStatus, type IUser } from "@commons/user";
import { permissionApi } from "@src/api/permission";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";

const socket = vi.hoisted(() => ({ handlers: new Map<string, (...args: never[]) => void>() }));

vi.mock("@src/api/permission", () => ({
    permissionApi: {
        getPermissions: vi.fn(),
        getByUser: vi.fn(),
        getByDataset: vi.fn(),
        createPermission: vi.fn(),
        updatePermission: vi.fn(),
        deletePermission: vi.fn(),
    },
}));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: vi.fn() }));
// The same fake socket store for every caller, so a test can fire a server event at the handler a store registered
vi.mock("@src/stores/socket", () => ({
    useSocketStore: () => ({
        on: (event: string, handler: (...args: never[]) => void) => socket.handlers.set(event, handler),
        reconnects: ref(0),
    }),
}));

const makeUser = (id: string, role: UserRoles): IUser =>
    ({
        id,
        email: `${id}@b.c`,
        name: id,
        role,
        status: UserStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
    }) as IUser;
const ds = (id: string, owner = "someone") => ({ id, owner }) as unknown as IDataset;
const perm = (user_id: string, dataset_id: string, level: PermissionOptions) =>
    ({ user_id, dataset_id, perm: level }) as IPermission;

let fetchDatasets: ReturnType<typeof vi.fn>;
let datasets: IDataset[];

// Logs the given user in on the real auth store
const loginAs = (id: string, role: UserRoles) => {
    const auth = useAuthStore();
    auth.token = "tok";
    auth.user = makeUser(id, role);
};

beforeEach(() => {
    vi.resetAllMocks();
    socket.handlers.clear();
    setActivePinia(createPinia());
    fetchDatasets = vi.fn().mockResolvedValue(undefined);
    datasets = [];
    vi.mocked(useDatasetStore).mockReturnValue({
        fetchDatasets,
        get datasets() {
            return datasets;
        },
    } as never);
});

describe("access rules", () => {
    it("gives guests nothing", () => {
        const store = usePermissionStore();
        expect(store.canManage(ds("d"))).toBe(false);
        expect(store.canEdit(ds("d"))).toBe(false);
        expect(store.canDownload(ds("d"))).toBe(false);
    });

    it("lets admins and the owner manage, edit and download", () => {
        const store = usePermissionStore();
        loginAs("a", UserRoles.ADMIN);
        expect([store.canManage(ds("d")), store.canEdit(ds("d")), store.canDownload(ds("d"))]).toEqual([true, true, true]);
        loginAs("o", UserRoles.EXTERNAL);
        expect(store.canManage(ds("d", "o"))).toBe(true);
        expect(store.canManage(ds("d", "other"))).toBe(false);
    });

    it("lets lab members download everything but edit only what they hold EDIT on", async () => {
        const store = usePermissionStore();
        loginAs("l", UserRoles.LAB_MEMBER);
        expect(store.canDownload(ds("d"))).toBe(true);
        expect(store.canEdit(ds("d"))).toBe(false);
        vi.mocked(permissionApi.getByUser).mockResolvedValue([perm("l", "d", PermissionOptions.EDIT)]);
        await store.fetchMine("l");
        expect(store.canEdit(ds("d"))).toBe(true);
        expect(store.canManage(ds("d"))).toBe(false);
    });

    it("gives external users what their permission rows say", async () => {
        const store = usePermissionStore();
        loginAs("e", UserRoles.EXTERNAL);
        vi.mocked(permissionApi.getByUser).mockResolvedValue([
            perm("e", "v", PermissionOptions.VIEW),
            perm("e", "dl", PermissionOptions.DOWNLOAD),
        ]);
        await store.fetchMine("e");
        expect(store.canDownload(ds("v"))).toBe(false);
        expect(store.canDownload(ds("dl"))).toBe(true);
        expect(store.canEdit(ds("dl"))).toBe(false);
        expect(store.downloadableDatasetIds).toEqual(["dl"]);
        expect(store.editableDatasetIds).toEqual([]);
    });
});

describe("fetchManaged", () => {
    it("loads every permission for admins", async () => {
        vi.mocked(permissionApi.getPermissions).mockResolvedValue([perm("u", "d", PermissionOptions.VIEW)]);
        const store = usePermissionStore();
        await store.fetchManaged([], true);
        expect(store.adminPermissions).toHaveLength(1);
    });

    it("loads the rows of each managed dataset, keeps what loaded when one request fails, and rethrows", async () => {
        vi.mocked(permissionApi.getByDataset).mockImplementation(async (id) => {
            if (id === "bad") throw new Error("down");
            return [perm("u", id, PermissionOptions.VIEW)];
        });
        const store = usePermissionStore();
        await expect(store.fetchManaged(["a", "bad", "b"], false)).rejects.toThrow("down");
        expect(store.adminPermissions.map((p) => p.dataset_id)).toEqual(["a", "b"]);
    });
});

describe("changing permissions", () => {
    it("adds, replaces and removes rows in the cached lists", async () => {
        loginAs("a", UserRoles.ADMIN);
        const store = usePermissionStore();
        vi.mocked(permissionApi.createPermission).mockResolvedValue(perm("e", "d", PermissionOptions.VIEW));
        await store.addPermission({ user_id: "e", dataset_id: "d", perm: PermissionOptions.VIEW });
        expect(store.adminPermissions).toHaveLength(1);
        // Not the viewer's own row, so it stays out of their own list
        expect(store.myPermissions).toHaveLength(0);
        vi.mocked(permissionApi.updatePermission).mockResolvedValue(perm("e", "d", PermissionOptions.DOWNLOAD));
        await store.editPermission("e", "d", PermissionOptions.DOWNLOAD);
        expect(store.adminPermissions.map((p) => p.perm)).toEqual([PermissionOptions.DOWNLOAD]);
        await store.removePermission("e", "d");
        expect(store.adminPermissions).toEqual([]);
    });

    it("keeps the viewer's own list in step when they change their own row", async () => {
        loginAs("l", UserRoles.LAB_MEMBER);
        const store = usePermissionStore();
        vi.mocked(permissionApi.createPermission).mockResolvedValue(perm("l", "d", PermissionOptions.EDIT));
        await store.addPermission({ user_id: "l", dataset_id: "d", perm: PermissionOptions.EDIT });
        expect(store.editableDatasetIds).toEqual(["d"]);
    });

    it("does not change the lists when the request fails", async () => {
        loginAs("a", UserRoles.ADMIN);
        const store = usePermissionStore();
        vi.mocked(permissionApi.createPermission).mockRejectedValue(new Error("409"));
        await expect(store.addPermission({ user_id: "e", dataset_id: "d", perm: PermissionOptions.VIEW })).rejects.toThrow("409");
        expect(store.adminPermissions).toEqual([]);
    });

    it("drops every row of a deleted dataset, and clear() forgets everything", async () => {
        loginAs("a", UserRoles.ADMIN);
        vi.mocked(permissionApi.getPermissions).mockResolvedValue([
            perm("u", "d", PermissionOptions.VIEW),
            perm("u", "x", PermissionOptions.VIEW),
        ]);
        vi.mocked(permissionApi.getByUser).mockResolvedValue([perm("a", "d", PermissionOptions.EDIT)]);
        const store = usePermissionStore();
        await store.fetchManaged([], true);
        await store.fetchMine("a");
        store.removeForDataset("d");
        expect(store.adminPermissions.map((p) => p.dataset_id)).toEqual(["x"]);
        expect(store.myPermissions).toEqual([]);
        store.clear();
        expect(store.adminPermissions).toEqual([]);
    });
});

describe("live updates", () => {
    const fire = (event: { user_id: string; dataset_id: string; permission: IPermission | null }) =>
        (socket.handlers.get(SocketEvent.PERMISSION_CHANGED) as (e: typeof event) => void)(event);

    it("follows a grant, a change and a revoke of the viewer's own row, and reloads the dataset list", () => {
        loginAs("e", UserRoles.EXTERNAL);
        const store = usePermissionStore();
        fire({ user_id: "e", dataset_id: "d", permission: perm("e", "d", PermissionOptions.VIEW) });
        expect(store.myPermissions.map((p) => p.perm)).toEqual([PermissionOptions.VIEW]);
        fire({ user_id: "e", dataset_id: "d", permission: perm("e", "d", PermissionOptions.DOWNLOAD) });
        expect(store.myPermissions.map((p) => p.perm)).toEqual([PermissionOptions.DOWNLOAD]);
        fire({ user_id: "e", dataset_id: "d", permission: null });
        expect(store.myPermissions).toEqual([]);
        expect(fetchDatasets).toHaveBeenCalledTimes(3);
    });

    it("tracks other people's rows only for admins and owners, which is who the server sends them to", () => {
        loginAs("o", UserRoles.LAB_MEMBER);
        const store = usePermissionStore();
        datasets = [ds("mine", "o")];
        fire({ user_id: "e", dataset_id: "mine", permission: perm("e", "mine", PermissionOptions.VIEW) });
        expect(store.adminPermissions).toHaveLength(1);
        expect(store.myPermissions).toEqual([]);
        // Someone else's row does not make the viewer's own dataset list reload
        expect(fetchDatasets).not.toHaveBeenCalled();
    });

    it("does not copy a row about the viewer into the management list unless they manage the dataset", () => {
        loginAs("e", UserRoles.EXTERNAL);
        const store = usePermissionStore();
        datasets = [ds("d", "other")];
        fire({ user_id: "e", dataset_id: "d", permission: perm("e", "d", PermissionOptions.VIEW) });
        expect(store.adminPermissions).toEqual([]);
        expect(store.myPermissions).toHaveLength(1);
    });
});

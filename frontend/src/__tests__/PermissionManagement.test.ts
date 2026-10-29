// Component tests for the permission table: loading, who sees what, filters, in-place level changes and the delete confirmation
// (stores and router are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { PermissionOptions } from "@commons/permissions";
import { UserRoles, UserStatus } from "@commons/user";
import PermissionManagement from "@src/views/admin/PermissionManagement.vue";

type Fake = {
    route: { query: Record<string, unknown> };
    router: { replace: ReturnType<typeof vi.fn> };
    auth: { user: { id: string }; isAdmin: boolean };
    users: { names: { id: string; name: string; role: UserRoles; status: UserStatus }[]; fetchNames: ReturnType<typeof vi.fn>; nameOf: (id: string) => string };
    datasets: { datasets: { id: string; name: string; owner: string }[]; fetchDatasets: ReturnType<typeof vi.fn> };
    perms: {
        adminPermissions: { user_id: string; dataset_id: string; perm: PermissionOptions }[];
        canManage: (d: { id: string; owner: string }) => boolean;
        fetchMine: ReturnType<typeof vi.fn>;
        fetchManaged: ReturnType<typeof vi.fn>;
        editPermission: ReturnType<typeof vi.fn>;
        removePermission: ReturnType<typeof vi.fn>;
    };
};
const fake = vi.hoisted(() => ({}) as Fake);

vi.mock("vue-router", () => ({ useRoute: () => fake.route, useRouter: () => fake.router }));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => fake.auth }));
vi.mock("@src/stores/user", () => ({ useUserStore: () => fake.users }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => fake.datasets }));
vi.mock("@src/stores/permission", () => ({ usePermissionStore: () => fake.perms }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

// The dialog's overlay positions itself with the visual viewport, which jsdom lacks
vi.stubGlobal("visualViewport", { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} });

const stubs = { NewPermissionDialog: { name: "NewPermissionDialog", props: ["modelValue", "datasets"], template: "<div />" } };
type Vm = { userFilter: string[]; datasetFilter: string[]; showInactive: boolean; error: string | null; confirmOpen: boolean };
const render = async () => {
    const wrapper = mount(PermissionManagement, { global: { plugins: [createVuetify()], stubs }, attachTo: document.body });
    await flushPromises();
    return { wrapper, vm: wrapper.vm as unknown as Vm };
};
const rows = (wrapper: Awaited<ReturnType<typeof render>>["wrapper"]) => wrapper.findAll("tbody tr").map((r) => r.findAll("td").map((c) => c.text()));

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    const names = [
        { id: "u1", name: "Ada", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE },
        { id: "u2", name: "Bo", role: UserRoles.LAB_MEMBER, status: UserStatus.INVITED },
        { id: "u3", name: "Cy", role: UserRoles.EXTERNAL, status: UserStatus.INACTIVE },
    ];
    fake.route = reactive({ query: {} });
    fake.router = { replace: vi.fn() };
    fake.auth = reactive({ user: { id: "admin" }, isAdmin: true });
    fake.users = reactive({
        names,
        fetchNames: vi.fn().mockResolvedValue(undefined),
        nameOf: (id: string) => names.find((u) => u.id === id)?.name ?? id,
    });
    fake.datasets = reactive({
        datasets: [{ id: "d1", name: "Brain", owner: "admin" }, { id: "d2", name: "Liver", owner: "other" }],
        fetchDatasets: vi.fn().mockResolvedValue(undefined),
    });
    fake.perms = reactive({
        adminPermissions: [
            { user_id: "u1", dataset_id: "d1", perm: PermissionOptions.VIEW },
            { user_id: "u2", dataset_id: "d2", perm: PermissionOptions.EDIT },
            { user_id: "u3", dataset_id: "d1", perm: PermissionOptions.VIEW },
        ],
        canManage: () => true,
        fetchMine: vi.fn().mockResolvedValue(undefined),
        fetchManaged: vi.fn().mockResolvedValue(undefined),
        editPermission: vi.fn().mockResolvedValue(undefined),
        removePermission: vi.fn().mockResolvedValue(undefined),
    });
});

describe("PermissionManagement", () => {
    it("loads names, datasets and permissions for the logged-in user, then the managed datasets' permissions", async () => {
        await render();
        expect(fake.users.fetchNames).toHaveBeenCalled();
        expect(fake.datasets.fetchDatasets).toHaveBeenCalled();
        expect(fake.perms.fetchMine).toHaveBeenCalledWith("admin");
        expect(fake.perms.fetchManaged).toHaveBeenCalledWith(["d1", "d2"], true);
    });

    it("waits for the real user before loading anything", async () => {
        fake.auth.user.id = "";
        const { wrapper } = await render();
        expect(fake.perms.fetchMine).not.toHaveBeenCalled();
        expect(wrapper.find("h1").exists()).toBe(false);
        fake.auth.user.id = "admin";
        await flushPromises();
        expect(fake.perms.fetchMine).toHaveBeenCalledWith("admin");
    });

    it("lists user, role, status and dataset, hiding deactivated users' rows by default", async () => {
        const { wrapper } = await render();
        expect(rows(wrapper).map((r) => r.slice(0, 4))).toEqual([
            ["Ada", UserRoles.EXTERNAL, UserStatus.ACTIVE, "Brain"],
            ["Bo", UserRoles.LAB_MEMBER, UserStatus.INVITED, "Liver"],
        ]);
    });

    it("shows deactivated users when asked, with a chip that switches it off again", async () => {
        const { wrapper, vm } = await render();
        vm.showInactive = true;
        await flushPromises();
        expect(rows(wrapper).map((r) => r[0])).toEqual(["Ada", "Bo", "Cy"]);
        const chip = wrapper.find(".v-chip");
        expect(chip.text()).toBe("Including deactivated users");
        await chip.find(".v-chip__close").trigger("click");
        expect(vm.showInactive).toBe(false);
    });

    it("a ?user= preset filters the rows, and one naming a deactivated user switches deactivated users on", async () => {
        fake.route.query = { user: "u3" };
        const { wrapper, vm } = await render();
        expect(vm.showInactive).toBe(true);
        expect(rows(wrapper).map((r) => r[0])).toEqual(["Cy"]);
        fake.route.query = { user: "u1" };
        await flushPromises();
        expect(rows(wrapper).map((r) => r[0])).toEqual(["Ada"]);
    });

    it("filters by dataset, and the chips name the filters and remove them", async () => {
        const { wrapper, vm } = await render();
        vm.datasetFilter = ["d2"];
        await flushPromises();
        expect(rows(wrapper).map((r) => r[0])).toEqual(["Bo"]);
        expect(wrapper.find(".v-chip").text()).toBe("Dataset: Liver");
        await wrapper.find(".v-chip .v-chip__close").trigger("click");
        expect(vm.datasetFilter).toEqual([]);
    });

    it("shows only the datasets the viewer manages, and an id for rows of other datasets", async () => {
        fake.auth.isAdmin = false;
        fake.perms.canManage = (d) => d.owner === "admin";
        fake.perms.adminPermissions = [
            { user_id: "u1", dataset_id: "d1", perm: PermissionOptions.VIEW },
            { user_id: "u1", dataset_id: "d2", perm: PermissionOptions.VIEW },
        ];
        const { wrapper } = await render();
        expect(fake.perms.fetchManaged).toHaveBeenCalledWith(["d1"], false);
        expect(rows(wrapper).map((r) => r[3])).toEqual(["Brain", "d2"]);
    });

    it("sends a non-admin who owns no dataset home", async () => {
        fake.auth.isAdmin = false;
        fake.perms.canManage = () => false;
        await render();
        expect(fake.router.replace).toHaveBeenCalledWith("/home");
    });

    it("does not redirect an admin without datasets, nor anyone when loading failed", async () => {
        fake.datasets.datasets = [];
        await render();
        expect(fake.router.replace).not.toHaveBeenCalled();
        fake.auth.isAdmin = false;
        fake.perms.fetchMine.mockRejectedValue(new Error("down"));
        const { wrapper } = await render();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to load permissions");
        expect(fake.router.replace).not.toHaveBeenCalled();
    });

    it("offers each row only the levels its user may hold", async () => {
        const { wrapper } = await render();
        const selects = wrapper.find("tbody").findAllComponents({ name: "VSelect" });
        expect(selects).toHaveLength(2);
        expect(selects[0]!.props("items")).not.toContain(PermissionOptions.EDIT); // an external user is capped
        expect(selects[1]!.props("items")).toContain(PermissionOptions.EDIT);
        expect(selects[1]!.props("modelValue")).toBe(PermissionOptions.EDIT);
    });

    it("shows the level as text when the user's role is not loaded", async () => {
        fake.perms.adminPermissions = [{ user_id: "unknown", dataset_id: "d1", perm: PermissionOptions.DOWNLOAD }];
        const { wrapper } = await render();
        expect(wrapper.find("tbody").findAllComponents({ name: "VSelect" })).toHaveLength(0);
        expect(rows(wrapper)[0]![4]).toBe(PermissionOptions.DOWNLOAD);
    });

    it("saves a changed level, ignores an unchanged one, and reports a failure", async () => {
        const { wrapper } = await render();
        const select = wrapper.find("tbody").findAllComponents({ name: "VSelect" })[1]!;
        select.vm.$emit("update:modelValue", PermissionOptions.EDIT);
        await flushPromises();
        expect(fake.perms.editPermission).not.toHaveBeenCalled();
        select.vm.$emit("update:modelValue", PermissionOptions.DOWNLOAD);
        await flushPromises();
        expect(fake.perms.editPermission).toHaveBeenCalledWith("u2", "d2", PermissionOptions.DOWNLOAD);
        fake.perms.editPermission.mockRejectedValue(new Error("no"));
        select.vm.$emit("update:modelValue", PermissionOptions.VIEW);
        await flushPromises();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to change the permission");
    });

    it("asks for confirmation before revoking, and Cancel revokes nothing", async () => {
        const { wrapper, vm } = await render();
        await wrapper.findAll('button[aria-label^="Delete permission"]')[1]!.trigger("click");
        expect(vm.confirmOpen).toBe(true);
        expect(document.body.textContent).toContain("Remove Bo's access to Liver?");
        const buttons = [...document.body.querySelectorAll<HTMLButtonElement>(".v-dialog button")];
        buttons.find((b) => b.textContent!.includes("Cancel"))!.click();
        await flushPromises();
        expect(vm.confirmOpen).toBe(false);
        expect(fake.perms.removePermission).not.toHaveBeenCalled();
    });

    it("revokes the confirmed permission and closes the popup, or reports a failure", async () => {
        const { wrapper, vm } = await render();
        const confirm = async () => {
            await wrapper.findAll('button[aria-label^="Delete permission"]')[0]!.trigger("click");
            [...document.body.querySelectorAll<HTMLButtonElement>(".v-dialog button")].find((b) => b.textContent!.includes("Delete"))!.click();
            await flushPromises();
        };
        await confirm();
        expect(fake.perms.removePermission).toHaveBeenCalledWith("u1", "d1");
        expect(vm.confirmOpen).toBe(false);
        fake.perms.removePermission.mockRejectedValue(new Error("no"));
        await confirm();
        expect(vm.confirmOpen).toBe(false);
        expect(wrapper.find(".v-alert").text()).toContain("Unable to delete the permission");
    });

    it("opens the new-permission popup with the datasets the viewer manages", async () => {
        const { wrapper } = await render();
        const dialog = wrapper.findComponent({ name: "NewPermissionDialog" });
        expect(dialog.props("datasets")).toHaveLength(2);
        await wrapper.findAll("button").find((b) => b.text().includes("New Permission"))!.trigger("click");
        expect(dialog.props("modelValue")).toBe(true);
    });
});

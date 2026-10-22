// Component tests for the settings page: the name form, the admin section, the visibility switches (and the popup that stops a public
// dataset without a DOI or attribution), and the password popup (stores and router are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { DatasetStatus, DatasetVisibility, type IDataset } from "@commons/dataset";
import { UserRoles, UserStatus } from "@commons/user";
import SettingsView from "@src/views/SettingsView.vue";

const mocks = vi.hoisted(() => ({
    auth: {} as Record<string, unknown>,
    dataset: {} as Record<string, unknown>,
    permission: {} as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    push: vi.fn(),
}));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => mocks.auth }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => mocks.dataset }));
vi.mock("@src/stores/permission", () => ({ usePermissionStore: () => mocks.permission }));
vi.mock("@src/stores/user", () => ({ useUserStore: () => mocks.user }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

// v-dialog positions itself with the visual viewport, which jsdom lacks
vi.stubGlobal("visualViewport", {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
    addEventListener() {},
    removeEventListener() {},
});

// The password popup has its own tests; here only whether the page asks for it to be open matters
const PasswordDialog = defineComponent({
    name: "ChangePasswordDialog",
    props: { modelValue: { type: Boolean, default: false } },
    setup: (props) => () => h("div", { class: "password-dialog", "data-open": String(props.modelValue) }),
});

const makeDataset = (over: Partial<IDataset> = {}): IDataset => ({
    id: "d1",
    name: "Root atlas",
    owner: "u1",
    url: "root-atlas",
    description: "",
    doi: "10.1/abc",
    attribution: "Brady Lab",
    plots: [],
    visibility: DatasetVisibility.PRIVATE,
    status: DatasetStatus.READY,
    statusMessage: null,
    createdAt: new Date(),
    updatedAt: null,
    ...over,
});

const setAuth = (role: UserRoles, status = UserStatus.ACTIVE) =>
    (mocks.auth = reactive({
        user: { id: "u1", name: "Una", role, status },
        get isAdmin() {
            return (this.user as { role: UserRoles }).role === UserRoles.ADMIN;
        },
    }));

const mountView = () =>
    mount(SettingsView, {
        global: { plugins: [createVuetify()], stubs: { ChangePasswordDialog: PasswordDialog } },
        attachTo: document.body,
    });
const button = (w: VueWrapper, label: string) => w.findAll("button").find((b) => b.text().includes(label));
const switches = (w: VueWrapper) => w.findAllComponents({ name: "VSwitch" });
const flip = async (w: VueWrapper, index: number, value: boolean | null) => {
    switches(w)[index]!.vm.$emit("update:modelValue", value);
    await flushPromises();
};
type Mocked = Record<string, ReturnType<typeof vi.fn>>;
// A mocked function of one of the stores, to change what it answers or to check its calls
const fn = (key: "dataset" | "permission" | "user", name: string) => (mocks[key] as Mocked)[name]!;

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    setAuth(UserRoles.LAB_MEMBER);
    mocks.dataset = reactive({
        datasets: [] as IDataset[],
        fetchDatasets: vi.fn(async () => {}),
        editDataset: vi.fn(async () => makeDataset()),
    });
    mocks.permission = reactive({
        fetchMine: vi.fn(async () => {}),
        canManage: vi.fn((d: IDataset) => d.owner === "u1"),
    });
    mocks.user = reactive({ editUser: vi.fn(async (_id: string, fields: object) => ({ id: "u1", role: UserRoles.LAB_MEMBER, status: UserStatus.ACTIVE, ...fields })) });
});

describe("SettingsView: user settings", () => {
    it("loads the datasets and the user's permissions when it opens, and survives their failure", async () => {
        fn("dataset", "fetchDatasets").mockRejectedValue(new Error("offline"));
        fn("permission", "fetchMine").mockRejectedValue(new Error("offline"));
        const wrapper = mountView();
        await flushPromises();
        expect(fn("dataset", "fetchDatasets")).toHaveBeenCalled();
        expect(fn("permission", "fetchMine")).toHaveBeenCalledWith("u1");
        expect(wrapper.text()).toContain("SETTINGS");
    });

    it("saves the trimmed name and shows the user the server returned", async () => {
        const wrapper = mountView();
        await wrapper.find("input").setValue("  Una Lee  ");
        await button(wrapper, "Save Name")!.trigger("click");
        await flushPromises();
        expect(fn("user", "editUser")).toHaveBeenCalledWith("u1", { name: "Una Lee" });
        expect(wrapper.find(".v-alert").text()).toContain("Name updated.");
        expect((mocks.auth as { user: { name: string } }).user.name).toBe("Una Lee");
    });

    it("saves the name when the form is submitted", async () => {
        const wrapper = mountView();
        await wrapper.find("input").setValue("Una Lee");
        await wrapper.find("form").trigger("submit");
        await flushPromises();
        expect(fn("user", "editUser")).toHaveBeenCalledWith("u1", { name: "Una Lee" });
    });

    it("refuses an empty name without calling the server", async () => {
        const wrapper = mountView();
        await wrapper.find("input").setValue("   ");
        await button(wrapper, "Save Name")!.trigger("click");
        await flushPromises();
        expect(fn("user", "editUser")).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("Name is required");
    });

    it("reports a name that could not be saved", async () => {
        fn("user", "editUser").mockRejectedValue(new Error("nope"));
        const wrapper = mountView();
        await button(wrapper, "Save Name")!.trigger("click");
        await flushPromises();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to update your name. Please try again.");
    });

    it("opens the password popup from the button, and by itself for an invited user", async () => {
        const wrapper = mountView();
        const dialog = () => wrapper.find(".password-dialog").attributes("data-open");
        expect(dialog()).toBe("false");
        await button(wrapper, "Change Password")!.trigger("click");
        expect(dialog()).toBe("true");

        setAuth(UserRoles.EXTERNAL, UserStatus.INVITED);
        const invited = mountView();
        expect(invited.find(".password-dialog").attributes("data-open")).toBe("true");
    });

    it("opens the popup when the user becomes invited while the page is open", async () => {
        const wrapper = mountView();
        (mocks.auth as { user: { status: UserStatus } }).user.status = UserStatus.INVITED;
        await nextTick();
        expect(wrapper.find(".password-dialog").attributes("data-open")).toBe("true");
    });
});

describe("SettingsView: who sees the admin section", () => {
    it("shows an ordinary user nothing but the name and password", async () => {
        (mocks.dataset as { datasets: IDataset[] }).datasets = [makeDataset({ owner: "someone-else" })];
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.text()).not.toContain("ADMIN");
        expect(wrapper.text()).not.toContain("USER SETTINGS");
        expect(button(wrapper, "Permissions Management")).toBeUndefined();
        expect(wrapper.text()).not.toContain("Root atlas");
    });

    it("shows the owner of a dataset the permissions page only, and no dataset list", async () => {
        (mocks.dataset as { datasets: IDataset[] }).datasets = [makeDataset()];
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.text()).toContain("ADMIN");
        expect(button(wrapper, "Permissions Management")).toBeDefined();
        expect(button(wrapper, "User Management")).toBeUndefined();
        expect(button(wrapper, "Activity Logs")).toBeUndefined();
        expect(wrapper.text()).not.toContain("Root atlas");
        await button(wrapper, "Permissions Management")!.trigger("click");
        expect(mocks.push).toHaveBeenCalledWith({ name: "permissions" });
    });

    it("shows an admin every management page and the dataset list", async () => {
        setAuth(UserRoles.ADMIN);
        (mocks.dataset as { datasets: IDataset[] }).datasets = [makeDataset(), makeDataset({ id: "d2", url: "leaf", name: "Leaf atlas", visibility: DatasetVisibility.PUBLIC })];
        const wrapper = mountView();
        await flushPromises();
        for (const [label, name] of [
            ["User Management", "user-mgmt"],
            ["Permissions Management", "permissions"],
            ["Activity Logs", "activity-logs"],
        ] as const) {
            await button(wrapper, label)!.trigger("click");
            expect(mocks.push).toHaveBeenLastCalledWith({ name });
        }
        expect(wrapper.text()).toContain("Root atlas");
        expect(wrapper.text()).toContain("Leaf atlas");
        expect(switches(wrapper).map((s) => s.props("modelValue"))).toEqual([false, true]);

        await button(wrapper, "Edit Dataset")!.trigger("click");
        expect(mocks.push).toHaveBeenLastCalledWith("/dataset/root-atlas/edit");
        await wrapper.findAll(".cursor-pointer")[1]!.trigger("click");
        expect(mocks.push).toHaveBeenLastCalledWith("/dataset/leaf");
    });
});

describe("SettingsView: visibility switches", () => {
    const adminWith = (...datasets: IDataset[]) => {
        setAuth(UserRoles.ADMIN);
        (mocks.dataset as { datasets: IDataset[] }).datasets = datasets;
        return mountView();
    };

    it("makes a complete dataset public, and a public one private", async () => {
        const wrapper = adminWith(makeDataset(), makeDataset({ id: "d2", url: "leaf", visibility: DatasetVisibility.PUBLIC }));
        await flip(wrapper, 0, true);
        expect(fn("dataset", "editDataset")).toHaveBeenLastCalledWith("d1", { visibility: DatasetVisibility.PUBLIC });
        await flip(wrapper, 1, false);
        expect(fn("dataset", "editDataset")).toHaveBeenLastCalledWith("d2", { visibility: DatasetVisibility.PRIVATE });
        // a cleared switch (null) counts as off
        await flip(wrapper, 1, null);
        expect(fn("dataset", "editDataset")).toHaveBeenLastCalledWith("d2", { visibility: DatasetVisibility.PRIVATE });
        expect(wrapper.text()).not.toContain("Unable to change");
    });

    it.each([
        [{ doi: "" }, "no DOI", "add it"],
        [{ attribution: "  " }, "no attribution", "add it"],
        [{ doi: "", attribution: "" }, "no DOI and attribution", "add them"],
    ])("stops a dataset that lacks %j and says what is missing", async (over, missing, add) => {
        const wrapper = adminWith(makeDataset(over));
        await flip(wrapper, 0, true);
        expect(fn("dataset", "editDataset")).not.toHaveBeenCalled();
        const dialog = document.body.textContent!.replace(/\s+/g, " ");
        expect(dialog).toContain("Can't make this dataset public yet");
        expect(dialog).toContain(`Root atlas has ${missing}. It stays private until you ${add} on the edit page.`);
    });

    it("cancels the popup, or goes to the edit page from it", async () => {
        const wrapper = adminWith(makeDataset({ doi: "" }));
        await flip(wrapper, 0, true);
        const popupButton = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent!.includes(label))!;
        popupButton("Cancel").click();
        await flushPromises();
        expect(mocks.push).not.toHaveBeenCalled();
        expect(wrapper.findComponent({ name: "VDialog" }).props("modelValue")).toBe(false);

        await flip(wrapper, 0, true);
        popupButton("Edit dataset").click();
        await flushPromises();
        expect(mocks.push).toHaveBeenCalledWith("/dataset/root-atlas/edit");
        expect(fn("dataset", "editDataset")).not.toHaveBeenCalled();
    });

    it("shows an error when the visibility could not be saved, and clears it on the next change", async () => {
        const wrapper = adminWith(makeDataset());
        fn("dataset", "editDataset").mockRejectedValueOnce(new Error("nope"));
        await flip(wrapper, 0, true);
        expect(wrapper.find(".v-alert").text()).toContain("Unable to change the visibility of Root atlas. Please try again.");
        await flip(wrapper, 0, true);
        expect(wrapper.find(".v-alert").exists()).toBe(false);
    });
});

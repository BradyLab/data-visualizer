// Component tests for the create/edit dataset page: the form rules, create vs edit mode, the order of the file uploads, the error messages,
// and the warnings when the dataset changes elsewhere while the form is open (stores, router and the file dropzones are mocked)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { AxiosError } from "axios";
import { DatasetPlots, DatasetStatus, DatasetVisibility, type IDataset } from "@commons/dataset";
import { FileTypes } from "@commons/file";
import { UserRoles, UserStatus } from "@commons/user";
import EditDatasetView from "@src/views/EditDatasetView.vue";

// Everything the view reads from its stores and router, rebuilt for every test
const mocks = vi.hoisted(() => ({
    auth: {} as Record<string, unknown>,
    dataset: {} as Record<string, unknown>,
    file: {} as Record<string, unknown>,
    permission: {} as Record<string, unknown>,
    user: {} as Record<string, unknown>,
    route: { params: {} as Record<string, string> },
    push: vi.fn(),
    replace: vi.fn(),
}));
vi.mock("vue-router", () => ({
    useRoute: () => mocks.route,
    useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => mocks.auth }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => mocks.dataset }));
vi.mock("@src/stores/file", () => ({ useFileStore: () => mocks.file }));
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

// Vuetify positions dialogs with visualViewport, which jsdom lacks
vi.stubGlobal("visualViewport", { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} });

// The dropzone is a labs component that is awkward in jsdom: a stand-in that shows its title and lets a test pick a file with setValue
const FileUpload = defineComponent({
    name: "VFileUpload",
    props: { modelValue: { type: [Object, Array], default: undefined }, title: { type: String, default: "" } },
    emits: ["update:modelValue"],
    setup: (props) => () => h("div", { class: "dropzone", "data-title": props.title }),
});

const makeDataset = (over: Partial<IDataset> = {}): IDataset => ({
    id: "d1",
    name: "Root atlas",
    owner: "u1",
    url: "root-atlas",
    description: "About roots",
    doi: "10.1/abc",
    attribution: "Brady Lab",
    plots: [DatasetPlots.UMAP],
    visibility: DatasetVisibility.PRIVATE,
    status: DatasetStatus.READY,
    statusMessage: null,
    createdAt: new Date(),
    updatedAt: null,
    ...over,
});

const file = (name: string) => new File(["x"], name);
const mountView = () => mount(EditDatasetView, { global: { plugins: [createVuetify()], stubs: { VFileUpload: FileUpload } } });

// Fills a dropzone the way the real one does (it emits update:modelValue)
const pick = (wrapper: VueWrapper, title: string, value: File | File[] | undefined) =>
    wrapper
        .findAllComponents(FileUpload)
        .find((c) => (c.props("title") ?? "").includes(title))!
        .vm.$emit("update:modelValue", value);

const nameInput = (w: VueWrapper) => w.find('input[placeholder="DATASET NAME"]');
const urlInput = (w: VueWrapper) => w.find('input[placeholder="dataset-url"]');
const saveButton = (w: VueWrapper) => w.findAll("button").find((b) => /Create New Dataset|Save Changes/.test(b.text()))!;
const text = (w: VueWrapper) => w.text();
const deleteButton = (w: VueWrapper) => w.findAll("button").find((b) => b.text() === "Delete Dataset");
// The confirm dialog is teleported to the body, so its buttons are looked up there
const dialogButton = (label: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

beforeEach(() => {
    vi.clearAllMocks();
    mocks.route = reactive({ params: {} as Record<string, string> });
    mocks.auth = reactive({
        user: { id: "u1", name: "Una", role: UserRoles.LAB_MEMBER, status: UserStatus.ACTIVE },
        isAdmin: false,
    });
    mocks.dataset = reactive({
        currentDataset: null as IDataset | null,
        getByUrl: vi.fn(async () => null),
        addDataset: vi.fn(async (fields: Partial<IDataset>) => makeDataset({ ...fields, id: "new-id" })),
        editDataset: vi.fn(async (id: string, fields: Partial<IDataset>) => makeDataset({ ...fields, id })),
        removeDataset: vi.fn(async () => {}),
    });
    mocks.file = reactive({ uploading: null, uploadFile: vi.fn(async () => {}) });
    mocks.permission = reactive({ fetchMine: vi.fn(async () => {}), canEdit: vi.fn(() => true), canManage: vi.fn(() => true) });
    mocks.user = reactive({
        users: [] as unknown[],
        fetchUsers: vi.fn(async () => {}),
        fetchNames: vi.fn(async () => {}),
        nameOf: (id: string) => `name-of-${id}`,
    });
});

type Mocked = Record<string, ReturnType<typeof vi.fn>>;
// A mocked function of one of the stores, to change what it answers or to check its calls
const fn = (key: "dataset" | "file" | "permission" | "user", name: string) => (mocks[key] as Mocked)[name]!;

describe("EditDatasetView: creating", () => {
    it("starts with a disabled button and asks for a tissue map, since no plots offers them all", async () => {
        const wrapper = mountView();
        await flushPromises();
        expect(saveButton(wrapper).text()).toBe("Create New Dataset");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
        expect(text(wrapper)).toContain("A tissue map is required");
        expect(fn("user", "fetchNames")).toHaveBeenCalled();
        expect(fn("user", "fetchUsers")).not.toHaveBeenCalled();
    });

    it("fills the url from the name until the user types their own", async () => {
        const wrapper = mountView();
        await nameInput(wrapper).setValue("My  Root Atlas!");
        expect((urlInput(wrapper).element as HTMLInputElement).value).toBe("my-root-atlas");
        await urlInput(wrapper).setValue("custom-url");
        await nameInput(wrapper).setValue("Another name");
        expect((urlInput(wrapper).element as HTMLInputElement).value).toBe("custom-url");
    });

    it("names the problem with a reserved or malformed url and blocks saving", async () => {
        const wrapper = mountView();
        pick(wrapper, "Tissue Map", file("map.csv"));
        await nameInput(wrapper).setValue("Atlas");
        await nextTick();
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
        await urlInput(wrapper).setValue("new");
        expect(text(wrapper)).toContain("is reserved");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
        // typed text is only normalised on save, so a messy url that slugifies to a usable one is accepted
        await urlInput(wrapper).setValue("My Atlas");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
        await urlInput(wrapper).setValue("");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("needs a name that is not only spaces", async () => {
        const wrapper = mountView();
        pick(wrapper, "Tissue Map", file("map.csv"));
        await nameInput(wrapper).setValue("   ");
        await urlInput(wrapper).setValue("atlas");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("needs a tissue map only while the tissue plot is on offer", async () => {
        const wrapper = mountView();
        await nameInput(wrapper).setValue("Atlas");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
        // plots picked that leave the tissue plot out
        (wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("multiple"))!.vm as { $emit: (event: string, value: unknown) => void }).$emit(
            "update:modelValue",
            [DatasetPlots.UMAP]
        );
        await nextTick();
        expect(text(wrapper)).not.toContain("A tissue map is required");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
        (wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("multiple"))!.vm as { $emit: (event: string, value: unknown) => void }).$emit(
            "update:modelValue",
            [DatasetPlots.UMAP, DatasetPlots.TISSUE]
        );
        await nextTick();
        expect(text(wrapper)).toContain("A tissue map is required");
        pick(wrapper, "Tissue Map", [file("map.csv")]);
        await nextTick();
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("lets only admins choose the owner, offering active admins and lab members", async () => {
        const wrapper = mountView();
        const select = () => wrapper.findAllComponents({ name: "VSelect" }).find((s) => !s.props("multiple"))!;
        expect(select().props("disabled")).toBe(true);
        expect(select().props("items")).toEqual([{ title: "Una", value: "u1" }]);

        mocks.auth = reactive({ user: { id: "u1", name: "Una", role: UserRoles.ADMIN, status: UserStatus.ACTIVE }, isAdmin: true });
        mocks.user.users = [
            { id: "u1", name: "Una", role: UserRoles.ADMIN, status: UserStatus.ACTIVE },
            { id: "u2", name: "Lab", role: UserRoles.LAB_MEMBER, status: UserStatus.ACTIVE },
            { id: "u3", name: "Gone", role: UserRoles.LAB_MEMBER, status: UserStatus.INACTIVE },
            { id: "u4", name: "Outside", role: UserRoles.EXTERNAL, status: UserStatus.ACTIVE },
        ];
        const adminWrapper = mountView();
        const adminSelect = adminWrapper.findAllComponents({ name: "VSelect" }).find((s) => !s.props("multiple"))!;
        expect(adminSelect.props("disabled")).toBe(false);
        expect((adminSelect.props("items") as { title: string }[]).map((i) => i.title)).toEqual(["Una", "Lab"]);
        expect(fn("user", "fetchUsers")).toHaveBeenCalled();
    });

    it("creates the dataset, then uploads the cover, the tissue map and the .rds in that order, and opens the page", async () => {
        const wrapper = mountView();
        await nameInput(wrapper).setValue("  Atlas  ");
        await wrapper.find('input[placeholder="Add DOI link here"]').setValue(" 10.1/x ");
        await wrapper.find('input[placeholder="Add attribution here"]').setValue(" Lab ");
        await wrapper.find("textarea").setValue("Described");
        const [cover, map, rds] = [file("c.png"), file("m.csv"), file("d.rds")];
        pick(wrapper, "Cover", cover);
        pick(wrapper, "Tissue Map", map);
        pick(wrapper, "Upload .rds", [rds]);
        await nextTick();
        await wrapper.findAll("textarea")[1]!.setValue("  first version  ");
        await saveButton(wrapper).trigger("click");
        await flushPromises();

        expect(fn("dataset", "addDataset")).toHaveBeenCalledWith({
            name: "Atlas",
            url: "atlas",
            description: "Described",
            doi: "10.1/x",
            attribution: "Lab",
            plots: [],
            owner: "u1",
            visibility: DatasetVisibility.PRIVATE,
        });
        expect(fn("file", "uploadFile").mock.calls).toEqual([
            ["new-id", FileTypes.COVER, cover],
            ["new-id", FileTypes.TISSUE_PLOT, map],
            ["new-id", FileTypes.RDS, rds, "first version"],
        ]);
        expect(mocks.push).toHaveBeenCalledWith("/dataset/atlas");
    });

    it("saves without uploading when no files were picked", async () => {
        const wrapper = mountView();
        await nameInput(wrapper).setValue("Atlas");
        (wrapper.findAllComponents({ name: "VSelect" }).find((s) => s.props("multiple"))!.vm as { $emit: (event: string, value: unknown) => void }).$emit(
            "update:modelValue",
            [DatasetPlots.UMAP]
        );
        await nextTick();
        await saveButton(wrapper).trigger("click");
        await flushPromises();
        expect(fn("file", "uploadFile")).not.toHaveBeenCalled();
        expect(mocks.push).toHaveBeenCalledWith("/dataset/atlas");
    });

    it.each([
        [409, { error: "dup" }, "The url is already in use by another dataset."],
        [400, { error: "Name is too long" }, "Unable to save the dataset. Name is too long"],
        [400, {}, "Please try again."],
        [500, {}, "Please try again."],
    ])("explains a failed save (status %i)", async (status, data, message) => {
        fn("dataset", "addDataset").mockRejectedValue(new AxiosError("fail", "ERR", undefined, undefined, { status, data } as never));
        const wrapper = mountView();
        pick(wrapper, "Tissue Map", file("m.csv"));
        await nameInput(wrapper).setValue("Atlas");
        await nextTick();
        await saveButton(wrapper).trigger("click");
        await flushPromises();
        expect(wrapper.find(".v-alert").text()).toContain(message);
        expect(mocks.push).not.toHaveBeenCalled();
        expect(fn("file", "uploadFile")).not.toHaveBeenCalled();
        // the button is usable again
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("a failed upload leaves the saved dataset's edit page open, and the retry updates instead of creating", async () => {
        fn("file", "uploadFile").mockRejectedValueOnce(new Error("Disk full."));
        const wrapper = mountView();
        pick(wrapper, "Tissue Map", file("m.csv"));
        await nameInput(wrapper).setValue("Atlas");
        await nextTick();
        await saveButton(wrapper).trigger("click");
        await flushPromises();
        expect(mocks.replace).toHaveBeenCalledWith("/dataset/atlas/edit");
        expect(mocks.push).not.toHaveBeenCalled();
        expect(wrapper.find(".v-alert").text()).toContain("The dataset was saved, but a file could not be uploaded. Disk full.");

        // the router would now show the edit route; the same form instance keeps the id and must not create a second dataset
        mocks.route.params = { datasetURL: "atlas" };
        await saveButton(wrapper).trigger("click");
        await flushPromises();
        expect(fn("dataset", "addDataset")).toHaveBeenCalledTimes(1);
    });

    it("shows the progress of the upload in progress", async () => {
        const wrapper = mountView();
        expect(text(wrapper)).not.toContain("Uploading data.rds");
        (mocks.file as { uploading: unknown }).uploading = { label: "Uploading data.rds", fraction: 0.456 };
        await nextTick();
        expect(text(wrapper)).toContain("Uploading data.rds: 46%");
    });
});

describe("EditDatasetView: editing", () => {
    const open = async (found: IDataset | null = makeDataset()) => {
        mocks.route.params = { datasetURL: "root-atlas" };
        fn("dataset", "getByUrl").mockResolvedValue(found);
        const wrapper = mountView();
        await flushPromises();
        return wrapper;
    };

    it("loads the dataset into the form, with the owner fixed and no tissue map required", async () => {
        const wrapper = await open();
        expect(fn("dataset", "getByUrl")).toHaveBeenCalledWith("root-atlas");
        expect(fn("permission", "fetchMine")).toHaveBeenCalledWith("u1");
        expect((nameInput(wrapper).element as HTMLInputElement).value).toBe("Root atlas");
        expect((urlInput(wrapper).element as HTMLInputElement).value).toBe("root-atlas");
        expect(saveButton(wrapper).text()).toBe("Save Changes");
        expect(saveButton(wrapper).attributes("disabled")).toBeUndefined();
        expect(text(wrapper)).not.toContain("A tissue map is required");
        expect(wrapper.findAllComponents({ name: "VSelect" }).find((s) => !s.props("multiple"))!.props("disabled")).toBe(true);
    });

    it("does not rewrite the url when the name changes", async () => {
        const wrapper = await open();
        await nameInput(wrapper).setValue("Renamed");
        expect((urlInput(wrapper).element as HTMLInputElement).value).toBe("root-atlas");
    });

    it("saves the changes to the existing dataset and uploads a new .rds with its notes", async () => {
        const found = makeDataset();
        const wrapper = await open(found);
        await nameInput(wrapper).setValue("Renamed");
        const rds = file("v2.rds");
        pick(wrapper, "Upload .rds", rds);
        await nextTick();
        await wrapper.findAll("textarea")[1]!.setValue("fixed labels");
        await saveButton(wrapper).trigger("click");
        await flushPromises();
        expect(fn("dataset", "editDataset")).toHaveBeenCalledWith("d1", {
            name: "Renamed",
            url: "root-atlas",
            description: "About roots",
            doi: "10.1/abc",
            attribution: "Brady Lab",
            plots: [DatasetPlots.UMAP],
        });
        expect(fn("dataset", "addDataset")).not.toHaveBeenCalled();
        expect(fn("file", "uploadFile")).toHaveBeenCalledWith("d1", FileTypes.RDS, rds, "fixed labels");
        expect(mocks.push).toHaveBeenCalledWith("/dataset/root-atlas");
        expect(found.name).toBe("Root atlas"); // the cached dataset was not edited in place
    });

    it("reports a dataset that does not exist", async () => {
        const wrapper = await open(null);
        expect(wrapper.find(".v-alert").text()).toContain("Dataset not found");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("sends a viewer without edit access to the dataset page", async () => {
        fn("permission", "canEdit").mockReturnValue(false);
        await open();
        expect(mocks.replace).toHaveBeenCalledWith("/dataset/root-atlas");
    });

    it("reports a failure to load", async () => {
        mocks.route.params = { datasetURL: "root-atlas" };
        fn("dataset", "getByUrl").mockRejectedValue(new Error("offline"));
        const wrapper = mountView();
        await flushPromises();
        expect(wrapper.find(".v-alert").text()).toContain("Unable to load the dataset");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("warns when someone else changed the dataset, and can load their version or keep the user's", async () => {
        const wrapper = await open();
        await nameInput(wrapper).setValue("My edit");
        (mocks.dataset as { currentDataset: IDataset }).currentDataset = makeDataset({ name: "Their edit" });
        await flushPromises();
        expect(text(wrapper)).toContain("Someone else changed this dataset");
        const button = (label: string) => wrapper.findAll("button").find((b) => b.text() === label)!;

        await button("Keep mine").trigger("click");
        expect(text(wrapper)).not.toContain("Someone else changed");
        expect((nameInput(wrapper).element as HTMLInputElement).value).toBe("My edit");

        (mocks.dataset as { currentDataset: IDataset }).currentDataset = makeDataset({ name: "Third edit" });
        await flushPromises();
        await button("Load their version").trigger("click");
        expect((nameInput(wrapper).element as HTMLInputElement).value).toBe("Third edit");
        expect(text(wrapper)).not.toContain("Someone else changed");
    });

    it("does not warn about a push that changes nothing the form edits", async () => {
        const wrapper = await open();
        (mocks.dataset as { currentDataset: IDataset }).currentDataset = makeDataset({ status: DatasetStatus.PROCESSING });
        await flushPromises();
        expect(text(wrapper)).not.toContain("Someone else changed");
    });

    it("follows a url change made by someone else", async () => {
        await open();
        (mocks.dataset as { currentDataset: IDataset }).currentDataset = makeDataset({ url: "new-url" });
        await flushPromises();
        expect(mocks.replace).toHaveBeenCalledWith("/dataset/new-url/edit");
    });

    it("blocks saving once the dataset is deleted while the form is open", async () => {
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = makeDataset();
        const wrapper = await open();
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = null;
        await flushPromises();
        expect(text(wrapper)).toContain("This dataset was deleted or is no longer available to you");
        expect(saveButton(wrapper).attributes("disabled")).toBeDefined();
    });

    it("goes back to the dataset page when edit access is lost while the form is open", async () => {
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = makeDataset();
        await open();
        fn("permission", "canEdit").mockReturnValue(false);
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = makeDataset();
        await flushPromises();
        expect(mocks.replace).toHaveBeenCalledWith("/dataset/root-atlas");
    });
});

describe("EditDatasetView: deleting", () => {
    const open = async () => {
        mocks.route.params = { datasetURL: "root-atlas" };
        fn("dataset", "getByUrl").mockResolvedValue(makeDataset());
        const wrapper = mountView();
        await flushPromises();
        return wrapper;
    };

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("has no delete button while creating", async () => {
        const wrapper = mountView();
        await flushPromises();
        expect(deleteButton(wrapper)).toBeUndefined();
    });

    it("puts the delete button on the left of the save button, in the same row", async () => {
        const wrapper = await open();
        const del = deleteButton(wrapper)!;
        const save = saveButton(wrapper);
        expect(del).toBeDefined();
        expect(del.element.closest(".v-row")).toBe(save.element.closest(".v-row"));
        const buttons = [...del.element.closest(".v-row")!.querySelectorAll("button")];
        expect(buttons.indexOf(del.element as HTMLButtonElement)).toBeLessThan(buttons.indexOf(save.element as HTMLButtonElement));
    });

    it("is disabled until the dataset has loaded", async () => {
        mocks.route.params = { datasetURL: "root-atlas" };
        let finish: (d: IDataset) => void = () => {};
        fn("dataset", "getByUrl").mockReturnValue(new Promise<IDataset>((resolve) => (finish = resolve)));
        const wrapper = mountView();
        await flushPromises();
        expect(deleteButton(wrapper)!.attributes("disabled")).toBeDefined();
        finish(makeDataset());
        await flushPromises();
        expect(deleteButton(wrapper)!.attributes("disabled")).toBeUndefined();
    });

    it("asks for confirmation and deletes nothing until it is given", async () => {
        const wrapper = await open();
        await deleteButton(wrapper)!.trigger("click");
        await flushPromises();
        expect(document.body.textContent).toContain("Delete Root atlas? This cannot be undone.");
        expect(fn("dataset", "removeDataset")).not.toHaveBeenCalled();
        dialogButton("Cancel")!.click();
        await flushPromises();
        expect(fn("dataset", "removeDataset")).not.toHaveBeenCalled();
        expect(mocks.push).not.toHaveBeenCalled();
    });

    it("deletes the dataset once confirmed and goes home, without the 'was deleted' warning", async () => {
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = makeDataset();
        // The store drops the open dataset as part of the delete
        fn("dataset", "removeDataset").mockImplementation(async () => {
            (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = null;
        });
        const wrapper = await open();
        await deleteButton(wrapper)!.trigger("click");
        await flushPromises();
        dialogButton("Delete")!.click();
        await flushPromises();
        expect(fn("dataset", "removeDataset")).toHaveBeenCalledWith("d1");
        expect(mocks.push).toHaveBeenCalledWith("/home");
        expect(text(wrapper)).not.toContain("was deleted or is no longer available");
    });

    it("stays on the form with an error when the delete fails", async () => {
        fn("dataset", "removeDataset").mockRejectedValue(new Error("boom"));
        const wrapper = await open();
        await deleteButton(wrapper)!.trigger("click");
        await flushPromises();
        dialogButton("Delete")!.click();
        await flushPromises();
        expect(text(wrapper)).toContain("Unable to delete the dataset. Please try again.");
        expect(mocks.push).not.toHaveBeenCalled();
        expect(deleteButton(wrapper)!.attributes("disabled")).toBeUndefined();
    });

    it("is disabled once the dataset was deleted by someone else while the form is open", async () => {
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = makeDataset();
        const wrapper = await open();
        (mocks.dataset as { currentDataset: IDataset | null }).currentDataset = null;
        await flushPromises();
        expect(deleteButton(wrapper)!.attributes("disabled")).toBeDefined();
    });
});

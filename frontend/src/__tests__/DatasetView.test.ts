// Component tests for the dataset page: loading and errors, what each viewer sees (Edit, Data, Try again), the processing status
// and the Generate Plots flow with the Shiny iframe (the stores, API and router are mocked)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { DatasetStatus, DatasetVisibility, type IDataset } from "@commons/dataset";
import DatasetView from "@src/views/DatasetView.vue";
import { datasetApi } from "@src/api/dataset";

// Reactive stand-ins for the route and the stores, created by the mock factories (they need vue, which vi.hoisted cannot import)
const h = vi.hoisted(() => ({
    route: null as unknown as { params: { datasetURL?: string } },
    router: { push: vi.fn(), replace: vi.fn() },
    auth: null as unknown as { isLoggedIn: boolean; user: { id: string } },
    datasets: null as unknown as {
        currentDataset: IDataset | null;
        getByUrl: ReturnType<typeof vi.fn>;
        reprocessDataset: ReturnType<typeof vi.fn>;
    },
    permissions: null as unknown as {
        fetchMine: ReturnType<typeof vi.fn>;
        canEdit: ReturnType<typeof vi.fn>;
        canDownload: ReturnType<typeof vi.fn>;
    },
    files: null as unknown as { downloading: boolean; downloadRds: ReturnType<typeof vi.fn> },
}));
vi.mock("vue-router", async () => {
    const { reactive } = await import("vue");
    h.route = reactive({ params: {} as { datasetURL?: string } });
    return { useRoute: () => h.route, useRouter: () => h.router };
});
vi.mock("@src/stores/auth", async () => {
    const { reactive } = await import("vue");
    h.auth = reactive({ isLoggedIn: false, user: { id: "" } });
    return { useAuthStore: () => h.auth };
});
vi.mock("@src/stores/dataset", async () => {
    const { reactive } = await import("vue");
    h.datasets = reactive({ currentDataset: null, getByUrl: vi.fn(), reprocessDataset: vi.fn() });
    return { useDatasetStore: () => h.datasets };
});
vi.mock("@src/stores/permission", async () => {
    const { reactive } = await import("vue");
    h.permissions = reactive({ fetchMine: vi.fn(), canEdit: vi.fn(), canDownload: vi.fn() });
    return { usePermissionStore: () => h.permissions };
});
vi.mock("@src/stores/file", async () => {
    const { reactive } = await import("vue");
    h.files = reactive({ downloading: false, downloadRds: vi.fn() });
    return { useFileStore: () => h.files };
});
vi.mock("@src/api/dataset", () => ({ datasetApi: { getViewerUrl: vi.fn() } }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const dataset = (over: Partial<IDataset> = {}) =>
    ({
        id: "d1",
        name: "Root atlas",
        owner: "u1",
        ownerName: "Ada Lovelace",
        url: "root-atlas",
        description: "Single cell roots",
        doi: "",
        attribution: "",
        visibility: DatasetVisibility.PUBLIC,
        status: DatasetStatus.READY,
        statusMessage: null,
        ...over,
    }) as IDataset;

const httpError = (status: number, data: object = {}) =>
    new AxiosError("failed", "ERR_BAD_RESPONSE", undefined, undefined, { status, data } as never);

// The store's lookup: finds `found` and makes it the current dataset, like the real one
const find = (found: IDataset | null) =>
    h.datasets.getByUrl.mockImplementation(async () => {
        h.datasets.currentDataset = found;
        return found;
    });

const mounted: ReturnType<typeof mount>[] = [];
const render = async () => {
    const wrapper = mount(DatasetView, { global: { plugins: [createVuetify()] }, attachTo: document.body });
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
};
type Wrapper = Awaited<ReturnType<typeof render>>;
const button = (wrapper: Wrapper, text: string) => wrapper.findAll("button").find((b) => b.text().includes(text));
const alerts = (wrapper: Wrapper) => wrapper.findAll(".v-alert").map((a) => a.text());

beforeEach(() => {
    vi.resetAllMocks();
    h.route.params.datasetURL = "root-atlas";
    h.datasets.currentDataset = null;
    h.auth.isLoggedIn = false;
    h.auth.user = { id: "u1" };
    h.files.downloading = false;
    h.permissions.fetchMine.mockResolvedValue(undefined);
    h.permissions.canEdit.mockReturnValue(false);
    h.permissions.canDownload.mockReturnValue(false);
    find(dataset());
});
afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

describe("loading", () => {
    it("shows a spinner until the dataset has loaded, then the dataset", async () => {
        let finish!: (d: IDataset) => void;
        h.datasets.getByUrl.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finish = (d) => {
                        h.datasets.currentDataset = d;
                        resolve(d);
                    };
                })
        );
        const wrapper = await render();
        expect(wrapper.find(".v-progress-circular").exists()).toBe(true);
        expect(wrapper.find("h1").exists()).toBe(false);
        finish(dataset());
        await flushPromises();
        expect(wrapper.find(".v-progress-circular").exists()).toBe(false);
        expect(wrapper.find("h1").text()).toBe("Root atlas");
        expect(h.datasets.getByUrl).toHaveBeenCalledWith("root-atlas");
    });

    it("says so when no dataset has that url", async () => {
        find(null);
        expect(alerts(await render())).toEqual(["Dataset not found"]);
    });

    it("says so when the dataset cannot be loaded", async () => {
        h.datasets.getByUrl.mockRejectedValue(new Error("offline"));
        expect(alerts(await render())).toEqual(["Unable to load the dataset. Please try again."]);
    });

    it("does not look anything up on a route without a slug", async () => {
        h.route.params.datasetURL = undefined;
        await render();
        expect(h.datasets.getByUrl).not.toHaveBeenCalled();
    });

    it("loads the viewer's permissions only when they are logged in", async () => {
        await render();
        expect(h.permissions.fetchMine).not.toHaveBeenCalled();
        h.auth.isLoggedIn = true;
        await render();
        expect(h.permissions.fetchMine).toHaveBeenCalledWith("u1");
    });

    it("still shows the dataset, with a warning, when the permissions cannot be loaded", async () => {
        h.auth.isLoggedIn = true;
        h.permissions.fetchMine.mockRejectedValue(new Error("offline"));
        const wrapper = await render();
        expect(wrapper.find("h1").text()).toBe("Root atlas");
        expect(alerts(wrapper)[0]).toContain("Unable to load your permissions");
    });

    it("reloads when the url slug changes", async () => {
        const wrapper = await render();
        find(dataset({ id: "d2", name: "Leaf atlas", url: "leaf-atlas" }));
        h.route.params.datasetURL = "leaf-atlas";
        await flushPromises();
        expect(h.datasets.getByUrl).toHaveBeenLastCalledWith("leaf-atlas");
        expect(wrapper.find("h1").text()).toBe("Leaf atlas");
    });

    it("ignores the answer of an earlier slug that arrives late", async () => {
        const resolvers: Record<string, (d: IDataset | null) => void> = {};
        h.datasets.getByUrl.mockImplementation((url: string) => new Promise((resolve) => (resolvers[url] = resolve)));
        const wrapper = await render();
        h.route.params.datasetURL = "leaf-atlas";
        await nextTick();
        h.datasets.currentDataset = dataset({ id: "d2", name: "Leaf atlas", url: "leaf-atlas" });
        resolvers["leaf-atlas"]!(h.datasets.currentDataset);
        await flushPromises();
        resolvers["root-atlas"]!(null); // the slow first lookup finds nothing, but must not report it
        await flushPromises();
        expect(wrapper.find("h1").text()).toBe("Leaf atlas");
        expect(alerts(wrapper)).toEqual([]);
    });
});

describe("dataset details", () => {
    it("shows the name, author, description and attribution", async () => {
        find(dataset({ attribution: "Brady Lab 2025" }));
        const text = (await render()).text();
        expect(text).toContain("Root atlas");
        expect(text).toContain("Author: Ada Lovelace");
        expect(text).toContain("Single cell roots");
        expect(text).toContain("Attribution: Brady Lab 2025");
    });

    it("falls back to the owner id and leaves out an empty attribution", async () => {
        find(dataset({ ownerName: undefined, owner: "u9" }));
        const text = (await render()).text();
        expect(text).toContain("Author: u9");
        expect(text).not.toContain("Attribution");
    });

    it("links a bare DOI through doi.org and keeps a full URL as it is", async () => {
        find(dataset({ doi: "10.1000/xyz" }));
        let link = (await render()).find("a");
        expect(link.attributes("href")).toBe("https://doi.org/10.1000/xyz");
        expect(link.text()).toBe("10.1000/xyz");
        expect(link.attributes("rel")).toBe("noopener noreferrer");
        find(dataset({ doi: "HTTPS://doi.org/10.1000/xyz" }));
        link = (await render()).find("a");
        expect(link.attributes("href")).toBe("HTTPS://doi.org/10.1000/xyz");
    });

    it("shows no DOI line without a DOI", async () => {
        expect((await render()).text()).not.toContain("DOI");
    });
});

describe("actions by access", () => {
    it("shows neither Edit nor Data to a viewer without those rights", async () => {
        const wrapper = await render();
        expect(button(wrapper, "Edit")).toBeUndefined();
        expect(button(wrapper, "Data")).toBeUndefined();
    });

    it("asks the permission store about this dataset", async () => {
        await render();
        expect(h.permissions.canEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
        expect(h.permissions.canDownload).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));
    });

    it("lets an editor open the edit page", async () => {
        h.permissions.canEdit.mockReturnValue(true);
        const wrapper = await render();
        await button(wrapper, "Edit")!.trigger("click");
        expect(h.router.push).toHaveBeenCalledWith("/dataset/root-atlas/edit");
    });

    it("starts the download of the data file", async () => {
        h.permissions.canDownload.mockReturnValue(true);
        const wrapper = await render();
        await button(wrapper, "Data")!.trigger("click");
        expect(h.files.downloadRds).toHaveBeenCalledWith("d1");
        expect(alerts(wrapper)).toEqual([]);
    });

    it.each([
        [404, "This dataset has no data file yet."],
        [500, "Unable to start the download. Please try again."],
    ])("explains a failed download (%i)", async (status, message) => {
        h.permissions.canDownload.mockReturnValue(true);
        h.files.downloadRds.mockRejectedValue(httpError(status));
        const wrapper = await render();
        await button(wrapper, "Data")!.trigger("click");
        await flushPromises();
        expect(alerts(wrapper)).toEqual([message]);
    });

    it("lets the error about a download be closed", async () => {
        h.permissions.canDownload.mockReturnValue(true);
        h.files.downloadRds.mockRejectedValue(new Error("x"));
        const wrapper = await render();
        await button(wrapper, "Data")!.trigger("click");
        await flushPromises();
        await wrapper.find(".v-alert .v-alert__close button").trigger("click");
        expect(alerts(wrapper)).toEqual([]);
    });
});

describe("processing status", () => {
    it("tells that the data is being processed, and does not allow plots yet", async () => {
        find(dataset({ status: DatasetStatus.PROCESSING }));
        const wrapper = await render();
        expect(alerts(wrapper)[0]).toContain("is being processed");
        expect(button(wrapper, "Generate Plots")!.attributes("disabled")).toBeDefined();
    });

    it("tells that processing failed and shows the reason, without a retry for those who cannot edit", async () => {
        find(dataset({ status: DatasetStatus.FAILED, statusMessage: "Error: out of memory" }));
        const wrapper = await render();
        expect(alerts(wrapper)[0]).toContain("could not be processed");
        expect(alerts(wrapper)[0]).toContain("Error: out of memory");
        expect(button(wrapper, "Try again")).toBeUndefined();
        expect(button(wrapper, "Generate Plots")!.attributes("disabled")).toBeDefined();
    });

    it("lets an editor try again", async () => {
        h.permissions.canEdit.mockReturnValue(true);
        find(dataset({ status: DatasetStatus.FAILED }));
        const wrapper = await render();
        await button(wrapper, "Try again")!.trigger("click");
        await flushPromises();
        expect(h.datasets.reprocessDataset).toHaveBeenCalledWith("d1");
        expect(alerts(wrapper)).toHaveLength(1);
    });

    it.each([
        [409, { error: "Already processing" }, "Already processing"],
        [409, {}, "The plot data cannot be rebuilt right now."],
        [500, {}, "Unable to start processing. Please try again."],
    ])("explains a failed retry (%i)", async (status, data, message) => {
        h.permissions.canEdit.mockReturnValue(true);
        h.datasets.reprocessDataset.mockRejectedValue(httpError(status, data));
        find(dataset({ status: DatasetStatus.FAILED }));
        const wrapper = await render();
        await button(wrapper, "Try again")!.trigger("click");
        await flushPromises();
        expect(alerts(wrapper)[0]).toBe(message);
    });

    it("shows no status message for a ready dataset", async () => {
        expect(alerts(await render())).toEqual([]);
    });
});

describe("plots", () => {
    it("opens the viewer in an iframe at the ticket URL, and replaces the button", async () => {
        vi.mocked(datasetApi.getViewerUrl).mockResolvedValue("/shiny/root-atlas/?viewer_ticket=t");
        const wrapper = await render();
        expect(wrapper.find("iframe").exists()).toBe(false);
        await button(wrapper, "Generate Plots")!.trigger("click");
        await flushPromises();
        expect(datasetApi.getViewerUrl).toHaveBeenCalledWith("d1");
        const frame = wrapper.find("iframe");
        expect(frame.attributes("src")).toBe("/shiny/root-atlas/?viewer_ticket=t");
        expect(frame.attributes("referrerpolicy")).toBe("same-origin");
        expect(button(wrapper, "Generate Plots")).toBeUndefined();
    });

    it.each([
        [503, "The plot viewer is not available right now."],
        [409, "The data for this dataset is not ready yet."],
        [500, "Unable to open the plot viewer. Please try again."],
    ])("explains a viewer that cannot be opened (%i), and keeps the button", async (status, message) => {
        vi.mocked(datasetApi.getViewerUrl).mockRejectedValue(httpError(status));
        const wrapper = await render();
        await button(wrapper, "Generate Plots")!.trigger("click");
        await flushPromises();
        expect(alerts(wrapper)).toEqual([message]);
        expect(wrapper.find("iframe").exists()).toBe(false);
        expect(button(wrapper, "Generate Plots")).toBeDefined();
    });

    it("closes the viewer when the plot data stops being ready, and offers the button again", async () => {
        vi.mocked(datasetApi.getViewerUrl).mockResolvedValue("/shiny/root-atlas/?viewer_ticket=t");
        const wrapper = await render();
        await button(wrapper, "Generate Plots")!.trigger("click");
        await flushPromises();
        h.datasets.currentDataset = dataset({ status: DatasetStatus.PROCESSING });
        await flushPromises();
        expect(wrapper.find("iframe").exists()).toBe(false);
        h.datasets.currentDataset = dataset({ status: DatasetStatus.READY });
        await flushPromises();
        expect(wrapper.find("iframe").exists()).toBe(false);
        expect(button(wrapper, "Generate Plots")!.attributes("disabled")).toBeUndefined();
    });

    describe("height reported by the viewer", () => {
        const open = async () => {
            vi.mocked(datasetApi.getViewerUrl).mockResolvedValue("/shiny/root-atlas/?viewer_ticket=t");
            const wrapper = await render();
            await button(wrapper, "Generate Plots")!.trigger("click");
            await flushPromises();
            const frame = wrapper.find("iframe");
            const send = async (data: unknown, source: Window | null = (frame.element as HTMLIFrameElement).contentWindow) => {
                window.dispatchEvent(new MessageEvent("message", { data, source }));
                await nextTick();
            };
            return { frame, send };
        };

        it("grows the iframe to the reported height, within limits", async () => {
            const { frame, send } = await open();
            expect(frame.attributes("style") ?? "").not.toContain("height");
            await send({ type: "viewer-height", height: 1234.4 });
            expect(frame.attributes("style")).toContain("height: 1234px");
            await send({ type: "viewer-height", height: 10 });
            expect(frame.attributes("style")).toContain("height: 300px");
            await send({ type: "viewer-height", height: 99999 });
            expect(frame.attributes("style")).toContain("height: 6000px");
        });

        it("ignores other messages, bad heights and messages from other windows", async () => {
            const { frame, send } = await open();
            await send({ type: "other", height: 800 });
            await send({ type: "viewer-height", height: "800" });
            await send({ type: "viewer-height", height: Infinity });
            await send(null);
            await send({ type: "viewer-height", height: 800 }, window);
            expect(frame.attributes("style") ?? "").not.toContain("height");
        });

        it("stops listening when the page is left", async () => {
            const { frame, send } = await open();
            const wrapper = mounted.at(-1)!;
            const element = frame.element as HTMLIFrameElement;
            const source = element.contentWindow;
            wrapper.unmount();
            await send({ type: "viewer-height", height: 800 }, source);
            expect(element.style.height).toBe("");
        });
    });
});

describe("changes while the page is open", () => {
    it("says so when the dataset disappears (deleted or no longer visible)", async () => {
        const wrapper = await render();
        h.datasets.currentDataset = null;
        await flushPromises();
        expect(alerts(wrapper)).toEqual(["This dataset was deleted or is no longer available to you."]);
    });

    it("follows a changed url slug of the open dataset", async () => {
        await render();
        h.datasets.currentDataset = dataset({ url: "new-slug" });
        await flushPromises();
        expect(h.router.replace).toHaveBeenCalledWith("/dataset/new-slug");
    });

    it("does not redirect when the slug is unchanged", async () => {
        await render();
        h.datasets.currentDataset = dataset({ description: "edited" });
        await flushPromises();
        expect(h.router.replace).not.toHaveBeenCalled();
    });
});

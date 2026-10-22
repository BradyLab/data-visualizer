// Component tests for the home page: the list of dataset cards, the New Dataset button and the "no datasets" banner (stores mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { createVuetify } from "vuetify";
import { DatasetVisibility, type IDataset } from "@commons/dataset";
import HomeView from "@src/views/HomeView.vue";

const h = vi.hoisted(() => ({
    auth: { canCreateDatasets: false },
    store: { datasets: [] as IDataset[], fetchDatasets: vi.fn() },
}));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => h.auth }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => h.store }));
// The cover has its own tests (and would ask the file store for an image)
vi.mock("@src/components/DatasetCover.vue", () => ({
    default: { props: ["datasetId", "height"], template: '<div class="cover" :data-id="datasetId"></div>' },
}));

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
        description: "",
        attribution: "Brady Lab 2025",
        visibility: DatasetVisibility.PRIVATE,
        ...over,
    }) as IDataset;

// A real router, so the cards render as real links; its push is watched
const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:rest(.*)*", component: { template: "<div />" } }],
});
const push = vi.spyOn(router, "push");

const render = async () => {
    const wrapper = mount(HomeView, { global: { plugins: [createVuetify(), router] } });
    await flushPromises();
    return wrapper;
};
const newButton = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.findAll("button").find((b) => b.text().includes("New Dataset"));

beforeEach(() => {
    vi.clearAllMocks();
    h.auth.canCreateDatasets = false;
    h.store.datasets = [];
    h.store.fetchDatasets.mockResolvedValue(undefined);
});

describe("HomeView", () => {
    it("reloads the datasets when the page opens", async () => {
        await render();
        expect(h.store.fetchDatasets).toHaveBeenCalledTimes(1);
    });

    it("shows the New Dataset button only to users who may create datasets, and goes to the new dataset page", async () => {
        expect(newButton(await render())).toBeUndefined();
        h.auth.canCreateDatasets = true;
        const wrapper = await render();
        await newButton(wrapper)!.trigger("click");
        expect(push).toHaveBeenCalledWith("/dataset/new");
    });

    it("says there are no datasets once the list has loaded empty", async () => {
        const wrapper = await render();
        expect(wrapper.find(".v-alert").text()).toContain("You don't have access to any datasets.");
    });

    it("does not show the banner while the list is loading", async () => {
        h.store.fetchDatasets.mockReturnValue(new Promise(() => {}));
        expect((await render()).find(".v-alert").exists()).toBe(false);
    });

    it("does not show the banner when the list failed to load", async () => {
        h.store.fetchDatasets.mockRejectedValue(new Error("offline"));
        expect((await render()).find(".v-alert").exists()).toBe(false);
    });

    it("shows a card per dataset linking to its page, with the cover of that dataset", async () => {
        h.store.datasets = [dataset(), dataset({ id: "d2", url: "leaf-atlas", name: "Leaf atlas" })];
        const wrapper = await render();
        expect(wrapper.find(".v-alert").exists()).toBe(false);
        const cards = wrapper.findAll(".v-card");
        expect(cards).toHaveLength(2);
        expect(cards[0]!.text()).toContain("Root atlas");
        expect(cards[0]!.find(".cover").attributes("data-id")).toBe("d1");
        expect(cards[1]!.text()).toContain("Leaf atlas");
        expect(wrapper.findAll("a").map((a) => a.attributes("href"))).toEqual(["/dataset/root-atlas", "/dataset/leaf-atlas"]);
    });

    it("names the author by display name, falling back to the owner id", async () => {
        h.store.datasets = [dataset(), dataset({ id: "d2", url: "b", ownerName: undefined, owner: "u9" })];
        const text = (await render()).findAll(".v-card").map((c) => c.text());
        expect(text[0]).toContain("Author: Ada Lovelace");
        expect(text[1]).toContain("Author: u9");
    });

    it("shows the attribution of public datasets only", async () => {
        h.store.datasets = [dataset({ visibility: DatasetVisibility.PUBLIC }), dataset({ id: "d2", url: "b" })];
        const cards = (await render()).findAll(".v-card");
        expect(cards[0]!.text()).toContain("Attribution: Brady Lab 2025");
        expect(cards[1]!.text()).not.toContain("Attribution");
    });

    it("shows the description when there is one", async () => {
        h.store.datasets = [dataset({ description: "Single cell roots" }), dataset({ id: "d2", url: "b" })];
        const cards = (await render()).findAll(".v-card");
        expect(cards[0]!.text()).toContain("Single cell roots");
        expect(cards[1]!.find(".v-card-text").exists()).toBe(false);
    });
});

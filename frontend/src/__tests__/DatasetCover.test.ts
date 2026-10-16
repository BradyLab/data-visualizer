// Component tests for DatasetCover: the cover comes from the file store, with a fallback block when there is none
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import DatasetCover from "@src/components/DatasetCover.vue";
import { useFileStore } from "@src/stores/file";
import { fileApi } from "@src/api/file";

vi.mock("@src/api/file", () => ({ fileApi: { getCover: vi.fn() } }));
// TODOB04: this mock has off() and socket, which the real socket store does not expose (it returns connected, socketId, reconnects, connect, disconnect, on)
vi.mock("@src/stores/socket", () => ({ useSocketStore: () => ({ on: vi.fn(), socket: null }) }));

// ResizeObserver is missing in jsdom and v-img uses it
vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const render = () => mount(DatasetCover, { props: { datasetId: "d1", height: 120 }, global: { plugins: [createVuetify()] } });

beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
});

describe("DatasetCover", () => {
    it("asks the file store for the cover on mount", () => {
        vi.mocked(fileApi.getCover).mockResolvedValue(null);
        render();
        expect(fileApi.getCover).toHaveBeenCalledWith("d1");
    });

    it("shows the fallback block, sized by height, when the dataset has no cover", async () => {
        vi.mocked(fileApi.getCover).mockResolvedValue(null);
        const wrapper = render();
        await vi.waitFor(() => expect(useFileStore().covers["d1"]).toBeNull());
        const fallback = wrapper.find(".cover-fallback");
        expect(fallback.exists()).toBe(true);
        expect((fallback.element as HTMLElement).style.height).toBe("120px");
    });

    it("keeps the fallback when the cover request fails", async () => {
        vi.mocked(fileApi.getCover).mockRejectedValue(new Error("nope"));
        const wrapper = render();
        await vi.waitFor(() => expect(fileApi.getCover).toHaveBeenCalled());
        expect(wrapper.find(".cover-fallback").exists()).toBe(true);
    });

    it("renders the image once a cover is cached", async () => {
        // Never answers, so the pending request cannot overwrite the cover set below
        vi.mocked(fileApi.getCover).mockReturnValue(new Promise(() => {}));
        const wrapper = render();
        useFileStore().covers["d1"] = "blob:cover";
        await wrapper.vm.$nextTick();
        expect(wrapper.find(".cover-fallback").exists()).toBe(false);
        expect(wrapper.findComponent({ name: "VImg" }).exists()).toBe(true);
    });
});

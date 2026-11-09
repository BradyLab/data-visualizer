// Component tests for the Plantmap viewer page: pasted text and chosen files are drawn, problems are shown as alerts, the legend highlights, and
// the accessible names (picture description, table, announcement) are present
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import PlantmapView from "@src/views/PlantmapView.vue";
import { announcement } from "@src/utils/announce";

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const CSV = [
    '"ROI.name","ROI.id","point","x","y"',
    ...[1, 2].flatMap((id) =>
        [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
        ].map(([x, y], i) => `"${id === 1 ? "Epidermis" : "Cortex"}",${id},${i + 1},${x! + id * 2},${y}`)
    ),
].join("\n");

const render = () => mount(PlantmapView, { global: { plugins: [createVuetify()] }, attachTo: document.body });
const paste = async (wrapper: ReturnType<typeof render>, text: string) => {
    await wrapper.find("textarea").setValue(text);
    await wrapper
        .findAll("button")
        .find((b) => b.text() === "Draw pasted text")!
        .trigger("click");
    await flushPromises();
};

beforeEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
});

describe("PlantmapView", () => {
    it("has a main heading and labeled inputs and shows nothing before a map is drawn", () => {
        const wrapper = render();
        expect(wrapper.find("h1").text()).toBe("PLANTMAP VIEWER");
        expect(wrapper.find('label[for="plantmap-file"]').exists()).toBe(true);
        expect(wrapper.find("svg").exists()).toBe(false);
    });

    it("draws pasted text: a polygon per outline, a legend entry per name, a described picture and a table", async () => {
        const wrapper = render();
        await paste(wrapper, CSV);
        expect(wrapper.findAll("svg polygon")).toHaveLength(2);
        const svg = wrapper.find("svg");
        expect(svg.attributes("role")).toBe("img");
        const ids = svg.attributes("aria-labelledby")!.split(" ");
        expect(ids).toHaveLength(2);
        expect(svg.find(`[id="${ids[1]}"]`).text()).toContain("2 outlines in 2 color-coded names: Epidermis, Cortex");
        expect(wrapper.findAll(".plantmap-legend button").map((b) => b.text())).toEqual(["Epidermis (1)", "Cortex (1)"]);
        expect(wrapper.findAll("tbody tr")).toHaveLength(2);
        expect(wrapper.find("caption").exists()).toBe(true);
    });

    it("announces the result politely for screen readers", async () => {
        vi.useFakeTimers();
        const wrapper = render();
        await paste(wrapper, CSV);
        await vi.advanceTimersByTimeAsync(100);
        expect(announcement.value).toBe("Drew 2 outlines with 2 names from the pasted text.");
    });

    it("shows a problem in an alert and removes an earlier map", async () => {
        const wrapper = render();
        await paste(wrapper, CSV);
        await paste(wrapper, "a,b\n1,2");
        expect(wrapper.find(".v-alert").text()).toContain("missing these columns");
        expect(wrapper.find("svg").exists()).toBe(false);
        await paste(wrapper, "   ");
        expect(wrapper.find(".v-alert").text()).toBe("Paste the CSV text first.");
    });

    it("lists warnings without hiding the map", async () => {
        const wrapper = render();
        await paste(wrapper, CSV + '\n"Cortex",2,5,x,1');
        expect(wrapper.find("svg").exists()).toBe(true);
        expect(wrapper.text()).toContain("1 row was skipped");
    });

    it("highlights the outlines of a legend name with a pressed button, and lets go on a second press", async () => {
        const wrapper = render();
        await paste(wrapper, CSV);
        const [epidermis] = wrapper.findAll(".plantmap-legend button");
        await epidermis!.trigger("click");
        expect(epidermis!.attributes("aria-pressed")).toBe("true");
        const opacity = () => wrapper.findAll("svg polygon").map((p) => p.attributes("fill-opacity"));
        expect(opacity()).toEqual(["0.85", "0.15"]);
        await epidermis!.trigger("click");
        expect(epidermis!.attributes("aria-pressed")).toBe("false");
        expect(opacity()).toEqual(["0.85", "0.85"]);
    });

    it("shows names on the shapes only when asked, hidden from screen readers (the table has them)", async () => {
        const wrapper = render();
        await paste(wrapper, CSV);
        expect(wrapper.findAll("svg text")).toHaveLength(0);
        await wrapper.find('input[type="checkbox"]').setValue(true);
        expect(wrapper.findAll("svg text").map((t) => t.text())).toEqual(["Epidermis", "Cortex"]);
        expect(wrapper.find("svg g[aria-hidden='true']").exists()).toBe(true);
    });

    it("draws a chosen file and says which one", async () => {
        const wrapper = render();
        const input = wrapper.find('input[type="file"]');
        const file = new File([CSV], "root.csv", { type: "text/csv" });
        Object.defineProperty(input.element, "files", { value: [file] });
        await input.trigger("change");
        await flushPromises();
        expect(wrapper.findAll("svg polygon")).toHaveLength(2);
        expect(wrapper.text()).toContain("Showing: root.csv");
    });

    it("clears the map and the inputs", async () => {
        const wrapper = render();
        await paste(wrapper, CSV);
        await wrapper
            .findAll("button")
            .find((b) => b.text() === "Clear")!
            .trigger("click");
        expect(wrapper.find("svg").exists()).toBe(false);
        expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("");
    });
});

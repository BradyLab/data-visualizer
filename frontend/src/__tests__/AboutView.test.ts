// Component tests for the About page: the saved or default text, and the admin-only Markdown editor (the API and auth store are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { PageSlug } from "@commons/page";
import AboutView from "@src/views/AboutView.vue";

const fake = vi.hoisted(() => ({
    auth: null as never as { isAdmin: boolean },
    api: { getPage: vi.fn(), savePage: vi.fn() },
}));

vi.mock("@src/stores/auth", () => ({ useAuthStore: () => fake.auth }));
vi.mock("@src/api/page", () => ({ pageApi: fake.api }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);

const page = (content: string) => ({ slug: PageSlug.ABOUT, content, updatedAt: null });
const render = async () => {
    const wrapper = mount(AboutView, { global: { plugins: [createVuetify()] }, attachTo: document.body });
    await flushPromises();
    return wrapper;
};
const button = (wrapper: Awaited<ReturnType<typeof render>>, text: string) =>
    wrapper.findAll("button").find((b) => b.text() === text);

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    fake.auth = reactive({ isAdmin: false });
    fake.api.getPage.mockResolvedValue(page(""));
    fake.api.savePage.mockImplementation(async (_slug: PageSlug, content: string) => page(content));
});

describe("AboutView", () => {
    it("has the page heading and shows the default text until a page is saved", async () => {
        const wrapper = await render();
        expect(fake.api.getPage).toHaveBeenCalledWith(PageSlug.ABOUT);
        expect(wrapper.find("h1").text()).toBe("ABOUT");
        expect(wrapper.find(".markdown-body").text()).toContain("interactive plots");
    });

    it("shows the saved text as formatted Markdown, with headings below the page's h1", async () => {
        fake.api.getPage.mockResolvedValue(page("# Our lab\n\nWe study **roots**."));
        const wrapper = await render();
        expect(wrapper.find(".markdown-body h2").text()).toBe("Our lab");
        expect(wrapper.find(".markdown-body strong").text()).toBe("roots");
        expect(wrapper.findAll("h1")).toHaveLength(1);
    });

    it("offers no Edit button to anyone but an admin", async () => {
        expect(button(await render(), "Edit")).toBeUndefined();
    });

    it("keeps the default text and a warning, with Edit switched off, when the page cannot be loaded; Retry loads it again", async () => {
        fake.auth.isAdmin = true;
        fake.api.getPage.mockRejectedValueOnce(new Error("down"));
        const wrapper = await render();
        expect(wrapper.find(".v-alert").text()).toContain("couldn't load the latest version");
        expect(wrapper.find(".markdown-body").text()).toContain("interactive plots");
        expect(button(wrapper, "Edit")!.attributes("disabled")).toBeDefined();
        fake.api.getPage.mockResolvedValue(page("Back again"));
        await button(wrapper, "Retry")!.trigger("click");
        await flushPromises();
        expect(wrapper.find(".v-alert").exists()).toBe(false);
        expect(wrapper.find(".markdown-body").text()).toBe("Back again");
        expect(button(wrapper, "Edit")!.attributes("disabled")).toBeUndefined();
    });

    describe("as an admin", () => {
        beforeEach(() => {
            fake.auth.isAdmin = true;
            fake.api.getPage.mockResolvedValue(page("Saved text"));
        });

        const open = async () => {
            const wrapper = await render();
            await button(wrapper, "Edit")!.trigger("click");
            await flushPromises();
            return wrapper;
        };
        const editor = (wrapper: Awaited<ReturnType<typeof render>>) => wrapper.find("textarea");

        it("opens the editor with the saved text, focused, next to a preview", async () => {
            const wrapper = await open();
            expect(editor(wrapper).element.value).toBe("Saved text");
            expect(document.activeElement).toBe(editor(wrapper).element);
            expect(wrapper.find('[role="region"] .markdown-body').text()).toBe("Saved text");
            expect(button(wrapper, "Edit")).toBeUndefined();
        });

        it("updates the preview as the text is typed", async () => {
            const wrapper = await open();
            await editor(wrapper).setValue("## Hello");
            expect(wrapper.find('[role="region"] h3').text()).toBe("Hello");
        });

        it("saves the text, shows it, and puts focus back on Edit", async () => {
            const wrapper = await open();
            await editor(wrapper).setValue("New **text**");
            await wrapper.find("form").trigger("submit");
            await flushPromises();
            expect(fake.api.savePage).toHaveBeenCalledWith(PageSlug.ABOUT, "New **text**");
            expect(wrapper.find("textarea").exists()).toBe(false);
            expect(wrapper.find(".markdown-body strong").text()).toBe("text");
            expect(wrapper.find(".v-alert").text()).toContain("was saved");
            expect(document.activeElement).toBe(button(wrapper, "Edit")!.element);
        });

        it("saving an empty text brings back the default text", async () => {
            const wrapper = await open();
            await editor(wrapper).setValue("");
            await wrapper.find("form").trigger("submit");
            await flushPromises();
            expect(wrapper.find(".markdown-body").text()).toContain("interactive plots");
        });

        it("stays open with the text intact, and says so, when the save fails", async () => {
            fake.api.savePage.mockRejectedValue(new Error("no"));
            const wrapper = await open();
            await editor(wrapper).setValue("Unsaved work");
            await wrapper.find("form").trigger("submit");
            await flushPromises();
            expect(wrapper.find(".v-alert").text()).toContain("Unable to save the page");
            expect(editor(wrapper).element.value).toBe("Unsaved work");
        });

        it("Cancel discards the changes", async () => {
            const wrapper = await open();
            await editor(wrapper).setValue("Thrown away");
            await button(wrapper, "Cancel")!.trigger("click");
            await flushPromises();
            expect(fake.api.savePage).not.toHaveBeenCalled();
            expect(wrapper.find(".markdown-body").text()).toBe("Saved text");
        });

        it("the formatting buttons wrap the selected text, or add a placeholder when nothing is selected", async () => {
            const wrapper = await open();
            const box = editor(wrapper).element;
            box.setSelectionRange(0, 5);
            await wrapper.find('button[aria-label="Bold"]').trigger("click");
            await flushPromises();
            expect(box.value).toBe("**Saved** text");
            await editor(wrapper).setValue("");
            await wrapper.find('button[aria-label="Link"]').trigger("click");
            await flushPromises();
            expect(box.value).toBe("[link text](https://)");
            await editor(wrapper).setValue("one\ntwo");
            box.setSelectionRange(0, 7);
            await wrapper.find('button[aria-label="Bulleted list"]').trigger("click");
            await flushPromises();
            expect(box.value).toBe("- one\n- two");
        });

        it("names the text box and the toolbar", async () => {
            const wrapper = await open();
            expect(wrapper.find('[role="toolbar"]').attributes("aria-label")).toBe("Formatting");
            expect(wrapper.find("label").text()).toContain("About page text (Markdown)");
        });
    });
});

// Component tests for the page shell: header menus, footer, the layout's warnings, and the small shared pieces (logo, links, 404 page)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, reactive } from "vue";
import { flushPromises, mount, RouterLinkStub } from "@vue/test-utils";
import { createVuetify } from "vuetify";
import { VApp } from "vuetify/components";
import { HELP_URL } from "@src/interfaces/general";
import AppDefault from "@src/layouts/AppDefault.vue";
import AppFooter from "@src/layouts/AppFooter.vue";
import AppHeader from "@src/layouts/AppHeader.vue";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";
import NotFoundView from "@src/views/NotFoundView.vue";
import { announce } from "@src/utils/announce";

type Fake = {
    push: ReturnType<typeof vi.fn>;
    route: { meta: Record<string, unknown> };
    auth: { isLoggedIn: boolean; canCreateDatasets: boolean; restoreFailed: boolean; logout: ReturnType<typeof vi.fn> };
    datasets: { datasets: { url: string; name: string }[]; loadFailed: boolean; fetchDatasets: ReturnType<typeof vi.fn> };
};
const fake = vi.hoisted(() => ({}) as Fake);

vi.mock("vue-router", () => ({ useRouter: () => ({ push: fake.push }), useRoute: () => fake.route }));
vi.mock("@src/stores/auth", () => ({ useAuthStore: () => fake.auth }));
vi.mock("@src/stores/dataset", () => ({ useDatasetStore: () => fake.datasets }));

vi.stubGlobal(
    "ResizeObserver",
    class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
);
vi.stubGlobal("visualViewport", { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} });

const global = { plugins: [createVuetify()], stubs: { RouterLink: RouterLinkStub } };
// Header and layout need a v-app around them
const inApp = (component: object, stubs: Record<string, unknown> = {}) =>
    mount(
        defineComponent({
            render: () => h(VApp, null, { default: () => h(component) }),
        }),
        { global: { ...global, stubs: { ...global.stubs, ...stubs } }, attachTo: document.body }
    );

// Opens a menu by clicking its activator and returns the items it shows (menus are teleported to the body)
const menuItems = async (activator: { trigger: (e: string) => Promise<void> }) => {
    await activator.trigger("click");
    await flushPromises();
    return [...document.body.querySelectorAll<HTMLElement>(".v-overlay-container .v-list-item")];
};

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    fake.push = vi.fn();
    fake.route = { meta: {} };
    fake.auth = reactive({ isLoggedIn: false, canCreateDatasets: false, restoreFailed: false, logout: vi.fn().mockResolvedValue(undefined) });
    fake.datasets = reactive({ datasets: [{ url: "brain", name: "Brain" }, { url: "liver", name: "Liver" }], loadFailed: false, fetchDatasets: vi.fn().mockResolvedValue(undefined) });
});

describe("LayoutHelper", () => {
    it("renders the ABOUT link to /about and a FEEDBACK label", () => {
        const wrapper = mount(defineComponent({ render: () => h("div", null, [h(LayoutHelper)]) }), { global });
        expect(wrapper.findComponent(RouterLinkStub).props("to")).toBe("/about");
        expect(wrapper.text().replace(/\s+/g, " ")).toBe("| ABOUT | FEEDBACK");
    });
});

describe("BradyLabLogo", () => {
    it("is a link that takes the user home", async () => {
        const wrapper = mount(BradyLabLogo, { global });
        expect(wrapper.find("img").attributes("alt")).toBe("Brady Lab, home");
        expect(wrapper.findComponent(RouterLinkStub).props("to")).toBe("/home");
    });
});

describe("NotFoundView", () => {
    it("says the page does not exist and links home", () => {
        const wrapper = mount(NotFoundView, { global });
        expect(wrapper.text()).toContain("404");
        expect(wrapper.text()).toContain("Page not found");
        const link = wrapper.find("a");
        expect(link.exists()).toBe(true);
        expect(link.text()).toBe("Back to home");
    });
});

describe("AppFooter", () => {
    it("shows the help link and the shared links", () => {
        const wrapper = mount(AppFooter, { global });
        const help = wrapper.find(`a[href="${HELP_URL}"]`);
        expect(help.text()).toBe("HELP (opens in new tab)");
        expect(help.attributes("target")).toBe("_blank");
        expect(wrapper.text()).toContain("ABOUT");
        expect(wrapper.find("img").exists()).toBe(true);
    });

    it("is hidden on routes that ask for it", () => {
        fake.route = { meta: { hideFooter: true } };
        expect(mount(AppFooter, { global }).find("footer").exists()).toBe(false);
    });
});

describe("AppHeader", () => {
    it("lists the datasets in the DATASETS menu and opens the chosen one", async () => {
        const wrapper = inApp(AppHeader);
        const items = await menuItems(wrapper.findAll(".v-app-bar .v-col button").find((d) => d.text().includes("DATASETS"))!);
        expect(items.map((i) => i.textContent!.trim())).toEqual(["Brain", "Liver"]);
        items[1]!.click();
        expect(fake.push).toHaveBeenCalledWith("/dataset/liver");
    });

    it("offers New Dataset only to those who may create datasets", async () => {
        let wrapper = inApp(AppHeader);
        let items = await menuItems(wrapper.findAll(".v-app-bar .v-col button").find((d) => d.text().includes("DATASETS"))!);
        expect(items.map((i) => i.textContent!.trim())).not.toContain("New Dataset");
        wrapper.unmount();
        document.body.innerHTML = "";
        fake.auth.canCreateDatasets = true;
        wrapper = inApp(AppHeader);
        items = await menuItems(wrapper.findAll(".v-app-bar .v-col button").find((d) => d.text().includes("DATASETS"))!);
        const create = items.find((i) => i.textContent!.includes("New Dataset"))!;
        create.click();
        expect(fake.push).toHaveBeenCalledWith("/dataset/new");
    });

    it("offers LOG IN to a logged-out visitor", async () => {
        const wrapper = inApp(AppHeader);
        const items = await menuItems(wrapper.find(".v-toolbar__append button"));
        expect(items.map((i) => i.textContent!.trim())).toEqual(["LOG IN"]);
        items[0]!.click();
        expect(fake.push).toHaveBeenCalledWith("/login");
    });

    it("offers SETTINGS and LOG OUT to a logged-in user, and logging out goes home", async () => {
        fake.auth.isLoggedIn = true;
        const wrapper = inApp(AppHeader);
        const items = await menuItems(wrapper.find(".v-toolbar__append button"));
        expect(items.map((i) => i.textContent!.trim())).toEqual(["SETTINGS", "LOG OUT"]);
        items[0]!.click();
        expect(fake.push).toHaveBeenCalledWith("/settings");
        items[1]!.click();
        await flushPromises();
        expect(fake.auth.logout).toHaveBeenCalled();
        expect(fake.push).toHaveBeenLastCalledWith("/home");
    });

    it("names the icon-only account menu button", () => {
        expect(inApp(AppHeader).find(".v-toolbar__append button").attributes("aria-label")).toBe("Account menu");
    });

    it("links to the help document", () => {
        expect(inApp(AppHeader).find(`a[href="${HELP_URL}"]`).text()).toBe("HELP (opens in new tab)");
    });
});

describe("AppDefault", () => {
    const stubs = {
        AppHeader: { template: "<header class='stub-header' />" },
        AppFooter: { template: "<footer class='stub-footer' />" },
        "router-view": { template: "<section class='stub-view' />" },
    };

    it("starts with a skip link that moves focus to the main content", async () => {
        const wrapper = inApp(AppDefault, stubs);
        const skip = wrapper.find("a.skip-link");
        expect(skip.text()).toBe("Skip to main content");
        expect(skip.attributes("href")).toBe("#main");
        await skip.trigger("click");
        expect(document.activeElement).toBe(wrapper.find("main#main").element);
    });

    it("has a polite live region for announcements", async () => {
        vi.useFakeTimers();
        const wrapper = inApp(AppDefault, stubs);
        announce("Moved to the home page");
        await vi.advanceTimersByTimeAsync(100);
        const region = wrapper.find('[role="status"]');
        expect(region.attributes("aria-live")).toBe("polite");
        expect(region.text()).toBe("Moved to the home page");
        vi.useRealTimers();
    });

    it("renders the header, the routed view and the footer without warnings when all is well", () => {
        const wrapper = inApp(AppDefault, stubs);
        expect(wrapper.find(".v-main .stub-view").exists()).toBe(true);
        expect(wrapper.find(".v-alert").exists()).toBe(false);
    });

    it("warns when the session could not be restored, and Reload reloads the page", async () => {
        const reload = vi.fn();
        const original = window.location;
        vi.stubGlobal("location", { ...original, reload });
        fake.auth.restoreFailed = true;
        const wrapper = inApp(AppDefault, stubs);
        expect(wrapper.find(".v-alert").text()).toContain("couldn't restore your session");
        await wrapper.findAll(".v-alert button").find((b) => b.text() === "Reload")!.trigger("click");
        expect(reload).toHaveBeenCalled();
        vi.stubGlobal("location", original);
    });

    it("warns when the datasets could not be loaded, and Retry loads them again, ignoring a second failure", async () => {
        fake.datasets.loadFailed = true;
        fake.datasets.fetchDatasets.mockRejectedValue(new Error("down"));
        const wrapper = inApp(AppDefault, stubs);
        expect(wrapper.find(".v-alert").text()).toContain("couldn't load the datasets");
        await wrapper.findAll(".v-alert button").find((b) => b.text() === "Retry")!.trigger("click");
        await flushPromises();
        expect(fake.datasets.fetchDatasets).toHaveBeenCalled();
    });
});

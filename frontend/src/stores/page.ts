// Pinia store wrapping the page API calls (the editable text pages, such as About), so views never call the API directly
import { defineStore } from "pinia";
import type { IPage, PageSlug } from "@commons/page";
import { pageApi } from "@src/api/page";

export const usePageStore = defineStore("page", () => {
    /** Fetches the page; rejects if the request fails (the caller decides what to show) */
    const getPage = (slug: PageSlug): Promise<IPage> => pageApi.getPage(slug);

    /** Replaces the page's Markdown and returns it (admins only); rejects if the request fails */
    const savePage = (slug: PageSlug, content: string): Promise<IPage> => pageApi.savePage(slug, content);

    return { getPage, savePage };
});

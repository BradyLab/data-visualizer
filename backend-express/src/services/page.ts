// Database access for Pages (the Markdown text of the editable pages)
import { Pages } from "@src/models/page.ts";
import { PageSlug } from "@commons/page.ts";

/** Finds a page by slug, or null if it has never been saved */
export const getBySlug = (slug: PageSlug) => {
    console.log("[PAGE SERVICE] Fetching page...");
    return Pages.findByPk(slug);
};

/** Saves the page's content, creating the row the first time, and returns the saved page */
export const save = async (slug: PageSlug, content: string) => {
    console.log("[PAGE SERVICE] Saving page...");
    const existing = await Pages.findByPk(slug);
    if (existing) return existing.update({ content });
    return Pages.create({ slug, content, updatedAt: null });
};

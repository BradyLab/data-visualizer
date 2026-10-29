// Request handlers for the editable pages; thin wrappers that call the page service and shape the HTTP response
import { Request, Response } from "express";
import * as service from "@src/services/page.ts";
import { diff, logActivity } from "@src/services/activity.ts";
import { ActivityType } from "@commons/activity.ts";
import { MAX_PAGE_LENGTH, PageSlug } from "@commons/page.ts";

// Valid values for the :slug route param
const SLUGS: string[] = Object.values(PageSlug);

/**
 * GET /pages/:slug : returns the page (200 with { slug, content, updatedAt }). A page nobody has saved yet comes back with
 * empty content and a null updatedAt, so the frontend can show its built-in text; 404 for a slug that is not an editable page
 */
export const get = async (req: Request, res: Response) => {
    console.log("[PAGE CONTROLLER] Attempting to get page...");
    const slug = req.params.slug as string;
    if (!SLUGS.includes(slug)) return res.status(404).json({ error: "Page not found" });
    const page = await service.getBySlug(slug as PageSlug);
    res.status(200).json({ slug, content: page?.content ?? "", updatedAt: page?.updatedAt ?? null });
};

/**
 * PUT /pages/:slug with { content } : replaces the page's Markdown (200 with the saved page) and logs the change. Admin only, which the router enforces.
 * 404 for a slug that is not an editable page; 400 if content is not a string or is longer than MAX_PAGE_LENGTH
 */
export const update = async (req: Request, res: Response) => {
    console.log("[PAGE CONTROLLER] Attempting to update page...");
    const slug = req.params.slug as string;
    if (!SLUGS.includes(slug)) return res.status(404).json({ error: "Page not found" });
    const content = req.body?.content;
    if (typeof content !== "string") return res.status(400).json({ error: "content must be text" });
    if (content.length > MAX_PAGE_LENGTH)
        return res.status(400).json({ error: `content must be at most ${MAX_PAGE_LENGTH} characters` });
    const before = (await service.getBySlug(slug as PageSlug))?.content ?? "";
    const page = await service.save(slug as PageSlug, content);
    // Saving the text it already has is not a change, so it is not logged
    const changes = diff({ content: before }, { content: page.content }, ["content"]);
    if (changes) await logActivity(res, ActivityType.PAGE_UPDATED, { slug, changes });
    res.status(200).json({ slug, content: page.content, updatedAt: page.updatedAt });
};

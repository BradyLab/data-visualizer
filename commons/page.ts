// Shared types for editable pages (currently only the About page); used by both the frontend and backend
import type { Timestamp } from "./general.ts";

// The pages whose content can be edited; the value is the URL segment (GET/PUT /pages/<slug>) and the primary key of the Pages table
export enum PageSlug {
    ABOUT = "about",
}

// Longest page content (in characters) the backend accepts; keeps one request from storing an enormous page
export const MAX_PAGE_LENGTH = 50000;

// A page as stored in the Pages table; content is Markdown
export interface IPage {
    slug: PageSlug;
    content: string;
    // Null while the page has never been saved (the frontend then shows its built-in text)
    updatedAt: Timestamp | null;
}

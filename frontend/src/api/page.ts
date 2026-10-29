// Axios client for the backend /pages endpoints
import axios from "axios";
import type { IPage, PageSlug } from "@commons/page";
import { apis } from "@commons/general";
import { baseURL } from "@src/interfaces/general";

export const pageApi = {
    /** GET /pages/:slug : returns the page; one nobody has saved yet has empty content and a null updatedAt */
    async getPage(slug: PageSlug): Promise<IPage> {
        const response = await axios.get<IPage>(`${baseURL}/${apis.PAGE}/${slug}`);
        return response.data;
    },

    /** PUT /pages/:slug : replaces the page's Markdown and returns it (admins only; rejects with a 403 error for anyone else) */
    async savePage(slug: PageSlug, content: string): Promise<IPage> {
        const response = await axios.put<IPage>(`${baseURL}/${apis.PAGE}/${slug}`, { content });
        return response.data;
    },
};

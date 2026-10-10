// Shared dataset types used by both the frontend and backend
import type { Timestamp } from "./general.ts";

// Plot types a dataset can offer; values are the display labels (also stored in the DB enum)
export enum DatasetPlots {
    UMAP = "UMAP",
    DOT = "DotPlot",
    TISSUE = "TissuePlot",
    PCA = "PCA",
    VIOLIN = "ViolinPlot",
    HEATMAP = "Heatmap",
}

// Whether a dataset is listed publicly or only for permitted users (stored in the DB enum)
export enum DatasetVisibility {
    PUBLIC = "PUBLIC",
    PRIVATE = "PRIVATE",
}

// A dataset record as stored in the Datasets table
export interface IDataset {
    id: string;
    name: string;
    owner: string;
    // Display name of the owner; filled in by the backend on responses, not stored in the Datasets table
    ownerName?: string;
    url: string;
    description: string;
    doi: string;
    attribution: string;
    treatments: string[];
    plots: DatasetPlots[];
    visibility: DatasetVisibility;
    createdAt: Timestamp;
    updatedAt: Timestamp | null;
}

// Url slugs that would collide with fixed frontend routes under /dataset/ (e.g. /dataset/new is the create page)
export const RESERVED_DATASET_SLUGS = ["new"];

// Turns a name into a url slug: lowercase letters/digits separated by single dashes
export const slugify = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

// Returns why a dataset url is not a usable slug, or null if it is fine; used by the form and enforced by the backend model
export const datasetUrlError = (url: string): string | null => {
    if (!url) return "Url is required";
    if (url !== slugify(url)) return "Url may only contain lowercase letters, digits and single dashes";
    if (RESERVED_DATASET_SLUGS.includes(url)) return `"${url}" is reserved and cannot be used as a url`;
    return null;
};

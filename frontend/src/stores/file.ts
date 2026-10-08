// Pinia store for dataset files: cached cover images, the upload in progress, and data file downloads (wraps the file API calls)
import { ref } from "vue";
import { defineStore } from "pinia";
import { FileTypes } from "@commons/file";
import { fileApi } from "@src/api/file";

export const useFileStore = defineStore("file", () => {
    // Cover image object URL per dataset id; null means the dataset has no cover, a missing key means not loaded yet
    const covers = ref<Record<string, string | null>>({});
    // Cover requests in flight, so several components asking for the same cover share one request
    const pendingCovers = new Map<string, Promise<void>>();
    // Bumped by clear() so a cover that finishes loading for the previous viewer is thrown away
    let generation = 0;

    // The file being uploaded: its label and how much has been sent (0 to 1); null when nothing is uploading
    const uploading = ref<{ label: string; fraction: number } | null>(null);
    // True while a data file download is being started
    const downloading = ref(false);

    // Frees a cached cover (the browser keeps the image data in memory until its object URL is revoked) and forgets it, so it is loaded again on demand
    function dropCover(datasetId: string) {
        const url = covers.value[datasetId];
        if (url) URL.revokeObjectURL(url);
        delete covers.value[datasetId];
    }

    /** Loads a dataset's cover into `covers` unless it is already loaded or loading; rejects if the request fails (nothing is cached then, so a later call retries) */
    function loadCover(datasetId: string) {
        if (datasetId in covers.value) return Promise.resolve();
        const existing = pendingCovers.get(datasetId);
        if (existing) return existing;
        const started = generation;
        const request = fileApi
            .getCover(datasetId)
            .then((blob) => {
                if (started === generation) covers.value[datasetId] = blob ? URL.createObjectURL(blob) : null;
            })
            .finally(() => pendingCovers.delete(datasetId));
        pendingCovers.set(datasetId, request);
        return request;
    }

    /**
     * Uploads a file to a dataset and tracks its progress in `uploading`. A new cover replaces the cached one (shown by DatasetCover
     * as soon as it reloads). The backend assigns the version number; updates (notes on what changed) is only accepted for RDS files
     */
    async function uploadFile(datasetId: string, type: FileTypes, file: File, updates?: string) {
        const progress = { label: type === FileTypes.COVER ? "Uploading cover photo" : "Uploading .rds file", fraction: 0 };
        uploading.value = progress;
        try {
            await fileApi.uploadFile(datasetId, type, file, updates, (fraction) => (progress.fraction = fraction));
            if (type === FileTypes.COVER) dropCover(datasetId);
        } finally {
            uploading.value = null;
        }
    }

    /** Starts the browser's download of a dataset's current .rds file; rejects with a 404 axios error if there is none, 403 without download access */
    async function downloadRds(datasetId: string) {
        downloading.value = true;
        try {
            await fileApi.downloadRds(datasetId);
        } finally {
            downloading.value = false;
        }
    }

    /** Forgets every cached cover (what a viewer may see depends on who they are, so call on login and logout) */
    function clear() {
        generation++;
        pendingCovers.clear();
        Object.keys(covers.value).forEach(dropCover);
    }

    return { covers, uploading, downloading, loadCover, uploadFile, downloadRds, clear };
});

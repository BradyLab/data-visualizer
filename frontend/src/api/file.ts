// Resumable file uploads to the backend /files/upload endpoint (tus protocol, https://tus.io)
import axios, { isAxiosError } from "axios";
import { DetailedError, Upload } from "tus-js-client";
import { apis } from "@commons/general";
import { FileTypes } from "@commons/file";
import { baseURL } from "@src/interfaces/general";

// Size of each request body; large files are sent in pieces so a dropped connection only costs the current piece,
// and so proxies with a body size limit are not hit by one giant request
const CHUNK_SIZE = 64 * 1024 * 1024;

export const fileApi = {
    /**
     * Uploads a file to a dataset in chunks, retrying a failed chunk a few times before giving up, and resolves when the backend has stored it.
     * The backend assigns the next version number; updates (notes on what changed) is only accepted for RDS files.
     * onProgress receives the share uploaded so far (0 to 1). Rejects with an Error whose message is the backend's reason when it has one
     */
    uploadFile(
        datasetId: string,
        type: FileTypes,
        file: File,
        updates?: string,
        onProgress?: (fraction: number) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const metadata: Record<string, string> = { dataset_id: datasetId, type, filename: file.name };
            if (updates) metadata.updates = updates;
            const upload = new Upload(file, {
                endpoint: `${baseURL}/${apis.FILE}/upload`,
                metadata,
                chunkSize: CHUNK_SIZE,
                retryDelays: [0, 3000, 5000, 10000, 20000],
                // A finished upload must not be mistaken for a resumable one if the same file is uploaded again as a new version
                storeFingerprintForResuming: false,
                // Read the token per request so a refreshed login is picked up
                onBeforeRequest: (req) => {
                    const token = axios.defaults.headers.common["Authorization"];
                    if (typeof token === "string") req.setHeader("Authorization", token);
                },
                onProgress: (sent, total) => onProgress?.(total ? sent / total : 1),
                onSuccess: () => resolve(),
                onError: (err) => {
                    const body = err instanceof DetailedError ? err.originalResponse?.getBody().trim() : "";
                    reject(new Error(body || err.message));
                },
            });
            upload.start();
        });
    },

    /** GET /files/current/:datasetId/COVER/content : the dataset's current cover image, or null if it has none (other errors still reject) */
    async getCover(datasetId: string): Promise<Blob | null> {
        try {
            const response = await axios.get<Blob>(`${baseURL}/${apis.FILE}/current/${datasetId}/${FileTypes.COVER}/content`, {
                responseType: "blob",
            });
            return response.data;
        } catch (e) {
            if (isAxiosError(e) && e.response?.status === 404) return null;
            throw e;
        }
    },

    /**
     * Starts the browser's download of the dataset's current .rds file. A download cannot carry the login header, so a short-lived
     * token is requested first and put in the link; the browser then streams the file itself (large files never pass through the page).
     * Rejects with a 404 axios error if there is no .rds file, or 403 without download access
     */
    async downloadRds(datasetId: string): Promise<void> {
        const path = `${baseURL}/${apis.FILE}/current/${datasetId}/${FileTypes.RDS}`;
        const response = await axios.post<{ token: string }>(`${path}/download-token`);
        const link = document.createElement("a");
        link.href = `${path}/content?token=${encodeURIComponent(response.data.token)}`;
        link.click();
    },
};

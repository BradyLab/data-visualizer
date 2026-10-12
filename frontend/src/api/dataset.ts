// Axios client for the backend /datasets endpoints
import axios, { isAxiosError } from "axios";
import type { IDataset } from "@commons/dataset";
import { apis } from "@commons/general";
import { type CreateDatasetPayload, type UpdateDatasetPayload } from "@src/interfaces/dataset";
import { baseOrigin, baseURL } from "@src/interfaces/general";

export const datasetApi = {
    /** GET /datasets : returns all datasets */
    async getDatasets(): Promise<IDataset[]> {
        const response = await axios.get<IDataset[]>(`${baseURL}/${apis.DATASET}`);
        return response.data;
    },

    /** GET /datasets/:id : returns one dataset, or null if it does not exist (other errors still reject) */
    async getDataset(id: string): Promise<IDataset | null> {
        try {
            const response = await axios.get<IDataset>(`${baseURL}/${apis.DATASET}/${id}`);
            return response.data;
        } catch (e) {
            if (isAxiosError(e) && e.response?.status === 404) return null;
            throw e;
        }
    },

    /** GET /datasets/byURL/:url : returns the dataset with this url slug, or null if it does not exist (other errors still reject) */
    async getDatasetByUrl(url: string): Promise<IDataset | null> {
        try {
            const response = await axios.get<IDataset>(`${baseURL}/${apis.DATASET}/byURL/${encodeURIComponent(url)}`);
            return response.data;
        } catch (e) {
            if (isAxiosError(e) && e.response?.status === 404) return null;
            throw e;
        }
    },

    /**
     * POST /datasets/:id/viewer : asks for a short-lived ticket and returns the full URL of the dataset's Shiny viewer, to use as an iframe src.
     * Optional query parameters (e.g. plots) are added after the ticket. The URL is on the backend origin, which sets the viewer cookie
     */
    async getViewerUrl(id: string, params: Record<string, string> = {}): Promise<string> {
        const response = await axios.post<{ url: string }>(`${baseURL}/${apis.DATASET}/${id}/viewer`);
        const url = new URL(response.data.url, baseOrigin);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        return url.toString();
    },

    /** POST /datasets/:id/reprocess : rebuilds the plot data from the current data file (e.g. after a failure); returns the dataset, now PROCESSING */
    async reprocessDataset(id: string): Promise<IDataset> {
        const response = await axios.post<IDataset>(`${baseURL}/${apis.DATASET}/${id}/reprocess`);
        return response.data;
    },

    /** POST /datasets : creates a dataset and returns it */
    async createDataset(payload: CreateDatasetPayload): Promise<IDataset> {
        const response = await axios.post<IDataset>(`${baseURL}/${apis.DATASET}`, payload);
        return response.data;
    },

    /** PUT /datasets/:id : updates a dataset and returns it */
    async updateDataset(id: string, payload: UpdateDatasetPayload): Promise<IDataset> {
        const response = await axios.put<IDataset>(`${baseURL}/${apis.DATASET}/${id}`, payload);
        return response.data;
    },

    /** DELETE /datasets/:id : deletes a dataset */
    async deleteDataset(id: string): Promise<void> {
        await axios.delete(`${baseURL}/${apis.DATASET}/${id}`);
    },
};

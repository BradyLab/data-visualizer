// Axios client for the backend /datasets endpoints
import axios from "axios";
import type { IDataset } from "@commons/dataset";
import { apis } from "@commons/general";
import { type CreateDatasetPayload, type UpdateDatasetPayload } from "@src/interfaces/dataset";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

export const datasetApi = {
    /** GET /datasets : returns all datasets */
    async getDatasets(): Promise<IDataset[]> {
        const response = await axios.get<IDataset[]>(`${baseURL}/${apis.DATASET}`);
        return response.data;
    },

    /** GET /datasets/:id : returns one dataset (rejects with a 404 error if it does not exist) */
    async getDataset(id: string): Promise<IDataset> {
        const response = await axios.get<IDataset>(`${baseURL}/${apis.DATASET}/${id}`);
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

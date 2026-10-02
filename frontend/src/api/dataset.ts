// Axios client for the backend /datasets endpoints
import axios from "axios";
import type { IDataset } from "@commons/dataset";
import { apis } from "@commons/general";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

export const datasetApi = {
    /** GET /datasets : returns all datasets */
    async getDatasets(): Promise<IDataset[]> {
        const response = await axios.get<IDataset[]>(`${baseURL}/${apis.DATASET}`);
        return response.data;
    },
};

// Axios client for the backend /permissions endpoints
import axios from "axios";
import type { IPermission } from "@commons/permissions";
import { apis } from "@commons/general";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

export const permissionApi = {
    /** GET /permissions : returns all permissions */
    async getPermissions(): Promise<IPermission[]> {
        const response = await axios.get<IPermission[]>(`${baseURL}/${apis.PERMISSION}`);
        return response.data;
    },

    /** GET /permissions/byUser/:userId : returns all permissions of one user */
    async getByUser(userId: string): Promise<IPermission[]> {
        const response = await axios.get<IPermission[]>(`${baseURL}/${apis.PERMISSION}/byUser/${userId}`);
        return response.data;
    },

    /** GET /permissions/byDataset/:datasetId : returns all permissions on one dataset */
    async getByDataset(datasetId: string): Promise<IPermission[]> {
        const response = await axios.get<IPermission[]>(`${baseURL}/${apis.PERMISSION}/byDataset/${datasetId}`);
        return response.data;
    },
};

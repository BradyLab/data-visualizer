// Axios client for the backend /permissions endpoints
import axios from "axios";
import type { IPermission, PermissionOptions } from "@commons/permissions";
import { apis } from "@commons/general";
import { type CreatePermissionPayload } from "@src/interfaces/permission";
import { baseURL } from "@src/interfaces/general";

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

    /** GET /permissions/:userId/:datasetId : returns one permission (rejects with a 404 error if it does not exist) */
    async getPermission(userId: string, datasetId: string): Promise<IPermission> {
        const response = await axios.get<IPermission>(`${baseURL}/${apis.PERMISSION}/${userId}/${datasetId}`);
        return response.data;
    },

    /** POST /permissions : grants a permission and returns it (re-grants a previously revoked one) */
    async createPermission(payload: CreatePermissionPayload): Promise<IPermission> {
        const response = await axios.post<IPermission>(`${baseURL}/${apis.PERMISSION}`, payload);
        return response.data;
    },

    /** PUT /permissions/:userId/:datasetId : changes the access level of a permission and returns it */
    async updatePermission(userId: string, datasetId: string, perm: PermissionOptions): Promise<IPermission> {
        const response = await axios.put<IPermission>(`${baseURL}/${apis.PERMISSION}/${userId}/${datasetId}`, { perm });
        return response.data;
    },

    /** DELETE /permissions/:userId/:datasetId : revokes a permission */
    async deletePermission(userId: string, datasetId: string): Promise<void> {
        await axios.delete(`${baseURL}/${apis.PERMISSION}/${userId}/${datasetId}`);
    },
};

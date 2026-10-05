// Axios client for the backend /users endpoints
import axios from "axios";
import type { IUser } from "@commons/user";
import { apis } from "@commons/general";
import { type UpdateUserPayload, type InviteUserPayload } from "@src/interfaces/user";
import { baseURL } from "@src/interfaces/general";

export const userApi = {
    /** GET /users : returns all users */
    async getUsers(): Promise<IUser[]> {
        const response = await axios.get<IUser[]>(`${baseURL}/${apis.USER}`);
        return response.data;
    },

    /** GET /users/:id : returns one user (rejects with a 404 error if it does not exist) */
    async getUser(id: string): Promise<IUser> {
        const response = await axios.get<IUser>(`${baseURL}/${apis.USER}/${id}`);
        return response.data;
    },

    /** POST /users : creates a user and returns it */
    // Users are created by invitation (name, email, role); the server sets status, which starts as INVITED
    async createUser(payload: InviteUserPayload): Promise<IUser> {
        const response = await axios.post<IUser>(`${baseURL}/${apis.USER}`, payload);
        return response.data;
    },

    /** PUT /users/:id : updates a user and returns it */
    async updateUser(id: string, payload: UpdateUserPayload): Promise<IUser> {
        const response = await axios.put<IUser>(`${baseURL}/${apis.USER}/${id}`, payload);
        return response.data;
    },

    /** DELETE /users/:id : deletes a user */
    async deleteUser(id: string): Promise<void> {
        await axios.delete(`${baseURL}/${apis.USER}/${id}`);
    },
};

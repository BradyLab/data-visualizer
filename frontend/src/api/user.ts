// Axios client for the backend /users endpoints
import axios from "axios";
import type { IUser } from "@commons/user";
import { apis } from "@commons/general";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

// Fields the server generates itself and the client never sends
type ServerFields = "id" | "createdAt" | "updatedAt" | "deletedAt";

/** Payload for creating a user */
export type CreateUserPayload = Omit<IUser, ServerFields>;

/** Payload for updating a user; any subset of the editable fields */
export type UpdateUserPayload = Partial<CreateUserPayload>;

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
    async createUser(payload: CreateUserPayload): Promise<IUser> {
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

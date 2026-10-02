// Axios client for the backend /auth endpoints
import axios from "axios";
import type { ILoginRequest, ILoginResponse, IUser } from "@commons/user";
import { apis } from "@commons/general";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;

export const authApi = {
    /** POST /auth/login : returns a token and the user, rejects with a 401 error for bad credentials */
    async login(credentials: ILoginRequest): Promise<ILoginResponse> {
        const response = await axios.post<ILoginResponse>(`${baseURL}/${apis.AUTH}/login`, credentials);
        return response.data;
    },

    /** POST /auth/logout : tells the backend the user is logging out (the token is sent via the axios Authorization header) */
    async logout(): Promise<void> {
        await axios.post(`${baseURL}/${apis.AUTH}/logout`);
    },

    /** POST /auth/change-password : changes the logged-in user's password; rejects with a 403 error if the old password is wrong */
    async changePassword(oldPassword: string, newPassword: string): Promise<void> {
        await axios.post(`${baseURL}/${apis.AUTH}/change-password`, { oldPassword, newPassword });
    },

    /** GET /auth/me : returns the user for the current token (sent via the axios Authorization header) */
    async me(): Promise<IUser> {
        const response = await axios.get<IUser>(`${baseURL}/${apis.AUTH}/me`);
        return response.data;
    },
};

// Axios client for the backend /auth endpoints
import axios from "axios";
import type { ILoginRequest, ILoginResponse, IUser } from "@commons/user";
import { apis } from "@commons/general";
import { baseURL } from "@src/interfaces/general";

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

    /** POST /auth/change-password : changes the logged-in user's password and returns a fresh token (older ones are revoked); rejects with a 403 error if the old password is wrong */
    // socketId is this tab's websocket connection: the backend ends the user's other sessions but keeps that one
    async changePassword(oldPassword: string, newPassword: string, socketId?: string | null): Promise<string> {
        const response = await axios.post<{ token: string }>(
            `${baseURL}/${apis.AUTH}/change-password`,
            { oldPassword, newPassword },
            { headers: socketId ? { "X-Socket-Id": socketId } : {} }
        );
        return response.data.token;
    },

    /** GET /auth/me : returns the user for the current token (sent via the axios Authorization header) */
    async me(): Promise<IUser> {
        const response = await axios.get<IUser>(`${baseURL}/${apis.AUTH}/me`);
        return response.data;
    },
};

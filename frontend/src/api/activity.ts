// Axios client for the backend /activities endpoints
import axios from "axios";
import type { IActivity } from "@commons/activity";
import { apis } from "@commons/general";

// Backend origin plus optional API path prefix; both come from Vite env vars with a local-dev fallback
const baseURL = `${import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3001"}${import.meta.env.VITE_API_PATH ?? ""}`;



export const activityApi = {
    /** GET /activities : returns all activities */
    async getActivities(): Promise<IActivity[]> {
        const response = await axios.get<IActivity[]>(`${baseURL}/${apis.ACTIVITY}`);
        return response.data;
    },

    /** GET /activities/byUser/:userId : returns one user's activities, newest first */
    async getByUser(userId: string): Promise<IActivity[]> {
        const response = await axios.get<IActivity[]>(`${baseURL}/${apis.ACTIVITY}/byUser/${userId}`);
        return response.data;
    },

    /** GET /activities/:id : returns one activity (rejects with a 404 error if it does not exist) */
    async getActivity(id: string): Promise<IActivity> {
        const response = await axios.get<IActivity>(`${baseURL}/${apis.ACTIVITY}/${id}`);
        return response.data;
    },
};

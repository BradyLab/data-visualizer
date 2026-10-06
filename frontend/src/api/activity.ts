// Axios client for the backend /activities endpoints
import axios from "axios";
import type { IActivity } from "@commons/activity";
import { apis } from "@commons/general";
import { baseURL } from "@src/interfaces/general";

export const activityApi = {
    /** GET /activities : returns all activities */
    // Read-only API: the backend exposes no create/update/delete for activities
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

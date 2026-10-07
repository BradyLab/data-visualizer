// Axios client for the backend /activities endpoints
import axios from "axios";
import type { ActivityType, IActivity, IActivityPage } from "@commons/activity";
import { apis } from "@commons/general";
import { baseURL } from "@src/interfaces/general";

// Filters (any of the users, any of the types; omitted or empty means no filter) and the page to fetch
export interface ActivityQuery {
    user_id?: string[];
    type?: ActivityType[];
    limit: number;
    offset: number;
}

export const activityApi = {
    /** GET /activities : returns one page of activities (newest first) matching any of the given users and types, with the total */
    // Read-only API: the backend exposes no create/update/delete for activities
    // Lists go out comma-separated, which is how the backend reads them
    async getActivities(query: ActivityQuery): Promise<IActivityPage> {
        const params = {
            user_id: query.user_id?.join(",") || undefined,
            type: query.type?.join(",") || undefined,
            limit: query.limit,
            offset: query.offset,
        };
        const response = await axios.get<IActivityPage>(`${baseURL}/${apis.ACTIVITY}`, { params });
        return response.data;
    },

    /** GET /activities/byUser/:userId : returns one page of a user's activities, newest first, with the total */
    async getByUser(userId: string, page: { limit: number; offset: number }): Promise<IActivityPage> {
        const response = await axios.get<IActivityPage>(`${baseURL}/${apis.ACTIVITY}/byUser/${userId}`, { params: page });
        return response.data;
    },

    /** GET /activities/:id : returns one activity (rejects with a 404 error if it does not exist) */
    async getActivity(id: string): Promise<IActivity> {
        const response = await axios.get<IActivity>(`${baseURL}/${apis.ACTIVITY}/${id}`);
        return response.data;
    },
};

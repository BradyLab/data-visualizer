// Pinia store holding the activity log and wrapping the activity API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IActivity } from "@commons/activity";
import { activityApi, type ActivityQuery } from "@src/api/activity";
import { useSocketStore } from "@src/stores/socket";
import { SocketEvent } from "@commons/socket";

export const useActivityStore = defineStore("activity", () => {
    const activities = ref<IActivity[]>([]);
    const userActivities = ref<IActivity[]>([]);
    // How many activities match the last fetchActivities filters, across all pages
    const total = ref(0);
    // The filters and page of the last fetchActivities, so a pushed activity can be matched against them
    let lastQuery: ActivityQuery | null = null;
    // The same for fetchByUser
    let lastUserQuery: { userId: string; page: { limit: number; offset: number } } | null = null;

    /** Loads one page of activities matching the filters into the store, replacing what was there */
    async function fetchActivities(query: ActivityQuery) {
        lastQuery = query;
        const page = await activityApi.getActivities(query);
        activities.value = page.rows;
        total.value = page.total;
    }

    /** Loads one page of one user's activities into the store, replacing what was there */
    async function fetchByUser(userId: string, page: { limit: number; offset: number }) {
        lastUserQuery = { userId, page };
        userActivities.value = (await activityApi.getByUser(userId, page)).rows;
    }

    /** Returns the cached activity with this id (from either the loaded page or the per-user list), or null if not loaded */
    function getById(id: string) {
        return activities.value.find((a) => a.id === id) ?? userActivities.value.find((a) => a.id === id) ?? null;
    }

    // A new activity was logged (admins only). If the admin is looking at a list it belongs to, it counts toward the total, and on
    // the first page (newest first) it is shown right away; on later pages it only changes the page count, so the rows don't shift under the reader
    // The per-user list follows the same rule: a new activity of that user appears at the top of its first page
    useSocketStore().on(SocketEvent.ACTIVITY_CREATED, ({ activity }) => {
        const own = lastUserQuery;
        if (
            own &&
            own.page.offset === 0 &&
            activity.user_id === own.userId &&
            !userActivities.value.some((a) => a.id === activity.id)
        )
            userActivities.value = [activity, ...userActivities.value].slice(0, own.page.limit);

        const query = lastQuery;
        if (!query || activities.value.some((a) => a.id === activity.id)) return;
        if (query.user_id?.length && !(activity.user_id && query.user_id.includes(activity.user_id))) return;
        if (query.type?.length && !query.type.includes(activity.type)) return;
        total.value++;
        if (query.offset === 0) activities.value = [activity, ...activities.value].slice(0, query.limit);
    });

    return { activities, userActivities, total, fetchActivities, fetchByUser, getById };
});

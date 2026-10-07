// Pinia store holding the activity log and wrapping the activity API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IActivity } from "@commons/activity";
import { activityApi, type ActivityQuery } from "@src/api/activity";

export const useActivityStore = defineStore("activity", () => {
    const activities = ref<IActivity[]>([]);
    const userActivities = ref<IActivity[]>([]);
    // How many activities match the last fetchActivities filters, across all pages
    const total = ref(0);

    /** Loads one page of activities matching the filters into the store, replacing what was there */
    async function fetchActivities(query: ActivityQuery) {
        const page = await activityApi.getActivities(query);
        activities.value = page.rows;
        total.value = page.total;
    }

    /** Loads one page of one user's activities into the store, replacing what was there */
    async function fetchByUser(userId: string, page: { limit: number; offset: number }) {
        userActivities.value = (await activityApi.getByUser(userId, page)).rows;
    }

    /** Returns the cached activity with this id (from either the loaded page or the per-user list), or null if not loaded */
    function getById(id: string) {
        return activities.value.find((a) => a.id === id) ?? userActivities.value.find((a) => a.id === id) ?? null;
    }

    return { activities, userActivities, total, fetchActivities, fetchByUser, getById };
});

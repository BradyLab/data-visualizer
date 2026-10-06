// Pinia store holding the activity log and wrapping the activity API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IActivity } from "@commons/activity";
import { activityApi } from "@src/api/activity";

export const useActivityStore = defineStore("activity", () => {
    const activities = ref<IActivity[]>([]);
    const userActivities = ref<IActivity[]>([]);

    /** Loads all activities from the backend into the store */
    async function fetchActivities() {
        activities.value = await activityApi.getActivities();
    }

    /** Loads only one user's activities into the store, replacing what was there */
    async function fetchByUser(userId: string) {
        userActivities.value = await activityApi.getByUser(userId);
    }

    /** Returns the cached activity with this id (from either the full or the per-user list), or null if not loaded */
    function getById(id: string) {
        return activities.value.find((a) => a.id === id) ?? userActivities.value.find((a) => a.id === id) ?? null;
    }

    return { activities, userActivities, fetchActivities, fetchByUser, getById };
});

// Pinia store holding the activity log and wrapping the activity API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IActivity } from "@commons/activity";
import { activityApi } from "@src/api/activity";

export const useActivityStore = defineStore("activity", () => {
    const activities = ref<IActivity[]>([]);

    /** Loads all activities from the backend into the store */
    async function fetchActivities() {
        activities.value = await activityApi.getActivities();
    }

    return { activities, fetchActivities };
});

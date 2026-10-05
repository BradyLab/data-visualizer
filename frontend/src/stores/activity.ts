// Pinia store holding the activity log and wrapping the activity API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IActivity } from "@commons/activity";
import { activityApi } from "@src/api/activity";
import { type CreateActivityPayload } from "@src/interfaces/activity";

export const useActivityStore = defineStore("activity", () => {
    const activities = ref<IActivity[]>([]);

    /** Loads all activities from the backend into the store */
    async function fetchActivities() {
        activities.value = await activityApi.getActivities();
    }

    /** Loads only one user's activities into the store, replacing what was there */
    async function fetchByUser(userId: string) {
        activities.value = await activityApi.getByUser(userId);
    }

    /** Returns the cached activity with this id, or null if not loaded */
    function getById(id: string) {
        return activities.value.find((a) => a.id === id) ?? null;
    }

    /** Records an activity and adds it to the front of the store (the log is newest first) */
    async function addActivity(payload: CreateActivityPayload) {
        const activity = await activityApi.createActivity(payload);
        activities.value.unshift(activity);
        return activity;
    }

    return { activities, fetchActivities, fetchByUser, getById, addActivity };
});

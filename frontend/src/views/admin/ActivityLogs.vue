<script setup lang="ts">
// Admin-only activity log page: table of recorded events with their type, user name and JSON data
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ActivityType } from "@commons/activity";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { useActivityStore } from "@src/stores/activity";

const route = useRoute();
const auth = useAuthStore();
const userStore = useUserStore();
const activityStore = useActivityStore();

// Table columns: activity type, user name, and the JSON data
const headers = [
    { title: "ACTIVITY TYPE", key: "type" },
    { title: "USER", key: "userName" },
    { title: "DATA", key: "data", sortable: false },
];

// Selected filter values; an empty list means no filter on that field
const typeFilter = ref<ActivityType[]>([]);
// The user filter can be preset with a ?user=<id> query param (e.g. from the User Management page)
const userFromQuery = () => (typeof route.query.user === "string" ? [route.query.user] : []);
const userFilter = ref<string[]>(userFromQuery());
// The router reuses this component when only the query changes, so re-apply the preset whenever ?user= changes
watch(
    () => route.query.user,
    () => (userFilter.value = userFromQuery())
);
const typeOptions = Object.values(ActivityType);

// Display names for the activity types; a Record over the whole enum, so adding a type without a label fails type-checking
const typeLabels: Record<ActivityType, string> = {
    [ActivityType.INVITE_USER]: "User Invited",
    [ActivityType.USER_JOINED]: "User Joined",
    [ActivityType.USER_UPDATED]: "User Updated",
    [ActivityType.USER_DEACTIVATED]: "User Deactivated",
    [ActivityType.USER_REACTIVATED]: "User Reactivated",
    [ActivityType.USER_DELETED]: "User Deleted",
    [ActivityType.PERM_GRANTED]: "Permission Granted",
    [ActivityType.PERM_REVOKED]: "Permission Revoked",
    [ActivityType.DATASET_CREATED]: "Dataset Created",
    [ActivityType.DATASET_UPDATED]: "Dataset Updated",
    [ActivityType.DATASET_DELETED]: "Dataset Deleted",
    [ActivityType.FILE_UPLOADED]: "File Uploaded",
    [ActivityType.FILE_DOWNLOADED]: "File Downloaded",
    [ActivityType.FILE_DELETED]: "File Deleted",
};

// Shows the user's name, falling back to the id if the user isn't loaded
const userName = (id: string | null) => (id ? (userStore.getById(id)?.name ?? id) : "Deleted user");

// Activities matching any selected type and any selected user, where set, with the user's name added for display and sorting
const filteredActivities = computed(() =>
    activityStore.activities
        .filter(
            (a) =>
                (!typeFilter.value.length || typeFilter.value.includes(a.type)) &&
                (!userFilter.value.length || (a.user_id !== null && userFilter.value.includes(a.user_id)))
        )
        .map((a) => ({ ...a, userName: userName(a.user_id) }))
);

// Ids of activities whose JSON data is expanded past the preview
const expanded = ref<string[]>([]);
const PREVIEW_LINES = 3;

// Pretty-printed JSON for an activity's data
// lineCount decides whether it is long enough to need the expand/collapse behaviour
const formatData = (data: Record<string, unknown>) => JSON.stringify(data, null, 2);
const lineCount = (data: Record<string, unknown>) => formatData(data).split("\n").length;

// Expands or collapses one activity's data
function toggleExpanded(id: string) {
    expanded.value = expanded.value.includes(id) ? expanded.value.filter((e) => e !== id) : [...expanded.value, id];
}

// Load the log (and users, for the filter names) once we know the viewer is an admin
onMounted(async () => {
    if (auth.isAdmin) await Promise.all([activityStore.fetchActivities(), userStore.fetchUsers()]);
});
</script>

<template>
    <v-container v-if="auth.isAdmin">
        <div class="d-flex align-center mb-4">
            <h1 class="text-h6 font-weight-bold">ACTIVITY LOGS</h1>
        </div>

        <!-- Filter menu: each item opens a submenu of values; picking one sets the filter and shows a chip -->
        <v-row class="align-center mb-2">
            <v-menu>
                <template #activator="{ props }">
                    <v-btn v-bind="props" prepend-icon="mdi-filter-variant">Filter</v-btn>
                </template>
                <v-list>
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>Activity Type</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="typeFilter" select-strategy="leaf">
                                <v-list-item v-for="type in typeOptions" :key="type" :title="typeLabels[type]" :value="type">
                                    <template #prepend="{ isSelected }">
                                        <v-icon
                                            :icon="isSelected ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                                        ></v-icon>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </v-list-item>
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>User</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="userFilter" select-strategy="leaf">
                                <v-list-item v-for="user in userStore.users" :key="user.id" :title="user.name" :value="user.id">
                                    <template #prepend="{ isSelected }">
                                        <v-icon
                                            :icon="isSelected ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"
                                        ></v-icon>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </v-list-item>
                </v-list>
            </v-menu>
        </v-row>

        <!-- Active filters (only shown when there are any); closing a chip removes that value -->
        <div v-if="typeFilter.length || userFilter.length" class="d-flex flex-wrap ga-2 mb-3">
            <v-chip
                v-for="type in typeFilter"
                :key="type"
                closable
                color="primary"
                @click:close="typeFilter = typeFilter.filter((t) => t !== type)"
            >
                Type: {{ typeLabels[type] }}
            </v-chip>
            <v-chip
                v-for="id in userFilter"
                :key="id"
                closable
                color="primary"
                @click:close="userFilter = userFilter.filter((u) => u !== id)"
            >
                User: {{ userName(id) }}
            </v-chip>
        </div>

        <v-data-table :headers="headers" :items="filteredActivities" item-value="id">
            <!-- Type shown by its display name -->
            <template #item.type="{ item }">{{ typeLabels[item.type] }}</template>

            <!-- JSON data: shows the first few lines; click to expand or collapse when there is more -->
            <template #item.data="{ item }">
                <pre
                    class="py-2"
                    :style="{
                        cursor: lineCount(item.data) > PREVIEW_LINES ? 'pointer' : 'default',
                        ...(expanded.includes(item.id)
                            ? {}
                            : {
                                  display: '-webkit-box',
                                  '-webkit-box-orient': 'vertical',
                                  '-webkit-line-clamp': PREVIEW_LINES,
                                  overflow: 'hidden',
                              }),
                    }"
                    :title="lineCount(item.data) > PREVIEW_LINES ? 'Click to expand or collapse' : undefined"
                    @click="lineCount(item.data) > PREVIEW_LINES && toggleExpanded(item.id)"
                    >{{ formatData(item.data) }}</pre>
            </template>
        </v-data-table>
    </v-container>
</template>

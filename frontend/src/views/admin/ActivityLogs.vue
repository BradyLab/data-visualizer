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

// Table columns: activity type, user name, and the JSON data (not sortable: the server returns pages newest first)
const headers = [
    { title: "ACTIVITY TYPE", key: "type", sortable: false },
    { title: "USER", key: "userName", sortable: false },
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

// The current page of activities (already filtered by the server), with the user's name added for display
const pageActivities = computed(() => activityStore.activities.map((a) => ({ ...a, userName: userName(a.user_id) })));

// Paging state; the server returns one page at a time since the log grows without bound
const page = ref(1);
const itemsPerPage = ref(25);
const loading = ref(false);
// Counts requests so a slow, outdated response never overwrites a newer one
let latestRequest = 0;

// Loads the current page for the selected filters
async function load() {
    const request = ++latestRequest;
    loading.value = true;
    try {
        await activityStore.fetchActivities({
            user_id: userFilter.value,
            type: typeFilter.value,
            limit: itemsPerPage.value,
            offset: (page.value - 1) * itemsPerPage.value,
        });
    } finally {
        if (request === latestRequest) loading.value = false;
    }
}

// Changing a filter or the page size starts again from the first page; changing the page only reloads
watch([typeFilter, userFilter, itemsPerPage], () => {
    if (page.value === 1) load();
    else page.value = 1;
});
watch(page, load);

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

// Load the first page (and users, for the filter names); the router guard keeps everyone but admins off this page
onMounted(() => Promise.all([load(), userStore.fetchUsers()]));
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

        <!-- Server-side paging: each page and filter change fetches from the backend -->
        <v-data-table-server
            v-model:page="page"
            v-model:items-per-page="itemsPerPage"
            :headers="headers"
            :items="pageActivities"
            :items-length="activityStore.total"
            :loading="loading"
            item-value="id"
        >
            <template v-slot:item="{ item: activity }">
                <tr>
                    <td>{{ typeLabels[activity.type] }}</td>
                    <td>{{ activity.userName }}</td>
                    <td>
                        <pre
                            class="py-2"
                            :style="{
                                cursor: lineCount(activity.data) > PREVIEW_LINES ? 'pointer' : 'default',
                                ...(expanded.includes(activity.id)
                                    ? {}
                                    : {
                                          display: '-webkit-box',
                                          '-webkit-box-orient': 'vertical',
                                          '-webkit-line-clamp': PREVIEW_LINES,
                                          overflow: 'hidden',
                                      }),
                            }"
                            :title="lineCount(activity.data) > PREVIEW_LINES ? 'Click to expand or collapse' : undefined"
                            @click="lineCount(activity.data) > PREVIEW_LINES && toggleExpanded(activity.id)"
                            >{{ formatData(activity.data) }}</pre>
                    </td>
                </tr>
            </template>
        </v-data-table-server>
    </v-container>
</template>

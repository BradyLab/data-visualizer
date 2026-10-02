<script setup lang="ts">
// Admin-only activity log page: table of recorded events with their type, user id and JSON data
import { computed, onMounted, ref, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ActivityType } from "@commons/activity";
import { UserRoles } from "@commons/user";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { useActivityStore } from "@src/stores/activity";

const router = useRouter();
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
const userFilter = ref<string[]>(typeof route.query.user === "string" ? [route.query.user] : []);
const typeOptions = Object.values(ActivityType);

// Shows the user's name, falling back to the id if the user isn't loaded
const userName = (id: string) => userStore.getById(id)?.name ?? id;

// Activities matching any selected type and any selected user, where set, with the user's name added for display and sorting
const filteredActivities = computed(() =>
    activityStore.activities
        .filter(
            (a) =>
                (!typeFilter.value.length || typeFilter.value.includes(a.type)) &&
                (!userFilter.value.length || userFilter.value.includes(a.user_id))
        )
        .map((a) => ({ ...a, userName: userName(a.user_id) }))
);

// Ids of activities whose JSON data is expanded past the preview
const expanded = ref<string[]>([]);
const PREVIEW_LINES = 3;

// Pretty-printed JSON for an activity's data
const formatData = (data: Record<string, unknown>) => JSON.stringify(data, null, 2);
const lineCount = (data: Record<string, unknown>) => formatData(data).split("\n").length;

// Expands or collapses one activity's data
function toggleExpanded(id: string) {
    expanded.value = expanded.value.includes(id) ? expanded.value.filter((e) => e !== id) : [...expanded.value, id];
}

const isAdmin = computed(() => auth.user.role === UserRoles.ADMIN);

// Only admins may view this page; everyone else is sent home.
// A saved token with a GUEST user means the session is still being restored on page load, so wait for it.
watchEffect(() => {
    const restoring = auth.isLoggedIn && auth.user.role === UserRoles.GUEST;
    if (!isAdmin.value && !restoring) router.replace("/home");
});

// Load the log (and users, for the filter names) once we know the viewer is an admin
onMounted(async () => {
    if (isAdmin.value) await Promise.all([activityStore.fetchActivities(), userStore.fetchUsers()]);
});
</script>

<template>
    <v-container v-if="isAdmin">
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
                                <v-list-item v-for="type in typeOptions" :key="type" :title="type" :value="type">
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
                Type: {{ type }}
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

<script setup lang="ts">
// Permission management page: table of who holds which permission on which dataset.
// Admins (implicit edit access) see every dataset and permission; other users only see datasets they hold EDIT permission on,
// and are redirected home if they have none.
import { computed, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UserRoles } from "@commons/user";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const userStore = useUserStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();

// Table columns: user, dataset, permission level, and an actions column for the buttons
const headers = [
    { title: "USER", key: "userName" },
    { title: "DATASET", key: "datasetName" },
    { title: "PERMISSION", key: "perm" },
    { title: "", key: "actions", sortable: false, align: "end" as const },
];

const isAdmin = computed(() => auth.user.role === UserRoles.ADMIN);

// Selected filter values (user ids and dataset ids); an empty list means no filter on that field
// The user filter can be preset with a ?user=<id> query param (e.g. from the User Management page)
const userFilter = ref<string[]>(typeof route.query.user === "string" ? [route.query.user] : []);
const datasetFilter = ref<string[]>([]);

// Datasets the viewer may see: all for admins, otherwise only those they can edit
const visibleDatasets = computed(() =>
    isAdmin.value ? datasetStore.datasets : datasetStore.datasets.filter((d) => permissionStore.editableDatasetIds.includes(d.id))
);

// Permission rows joined with user and dataset details, limited to the selected filters.
// Admins have implicit edit access everywhere, so they see every permission; others only see permissions on visible datasets.
const rows = computed(() => {
    const visibleIds = new Set(visibleDatasets.value.map((d) => d.id));
    return permissionStore.permissions
        .filter(
            (p) =>
                (isAdmin.value || visibleIds.has(p.dataset_id)) &&
                (!userFilter.value.length || userFilter.value.includes(p.user_id)) &&
                (!datasetFilter.value.length || datasetFilter.value.includes(p.dataset_id))
        )
        .map((p) => ({
            key: `${p.user_id}:${p.dataset_id}`,
            userId: p.user_id,
            datasetId: p.dataset_id,
            userName: userStore.getById(p.user_id)?.name ?? p.user_id,
            email: userStore.getById(p.user_id)?.email ?? "",
            datasetName: visibleDatasets.value.find((d) => d.id === p.dataset_id)?.name ?? p.dataset_id,
            perm: p.perm,
        }));
});

// Display names for the filter chips
const userName = (id: string) => userStore.getById(id)?.name ?? id;
const datasetName = (id: string) => visibleDatasets.value.find((d) => d.id === id)?.name ?? id;

// Logged-out visitors are sent home. A saved token with no user yet means the session is still being restored.
watchEffect(() => {
    if (!auth.isLoggedIn) router.replace("/home");
});

// Load the data once the real user is known (the id is empty until login / session restore finishes)
// TODOE03: isAdmin is read when the id changes; if the role is set separately from the id, a restored admin may be fetched as a non-admin and redirected home
watch(
    () => auth.user.id,
    async (id) => {
        if (!id) return;
        await Promise.all([
            userStore.fetchUsers(),
            datasetStore.fetchDatasets(),
            permissionStore.fetchVisible(id, isAdmin.value),
        ]);
        // Non-admins without edit access to any dataset have nothing to manage here
        if (!isAdmin.value && !permissionStore.editableDatasetIds.length) router.replace("/home");
    },
    { immediate: true }
);

// TODO: open a new-permission flow and call the backend
function newPermission() {
    console.log("TODO: new permission");
}

// TODO: edit this permission
function edit(userId: string, datasetId: string) {
    console.log("TODO: edit permission for", userId, datasetId);
}
</script>

<template>
    <v-container v-if="auth.user.id">
        <div class="d-flex align-center mb-4">
            <h1 class="text-h6 font-weight-bold">PERMISSION MANAGEMENT</h1>
        </div>

        <!-- Filter menu: each item opens a submenu of values; picking one sets the filter and shows a chip -->
        <v-row class="align-center mb-2">
            <v-menu>
                <template #activator="{ props }">
                    <v-btn v-bind="props" prepend-icon="mdi-filter-variant">Filter</v-btn>
                </template>
                <v-list>
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
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>Dataset</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="datasetFilter" select-strategy="leaf">
                                <v-list-item
                                    v-for="dataset in visibleDatasets"
                                    :key="dataset.id"
                                    :title="dataset.name"
                                    :value="dataset.id"
                                >
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
            <v-spacer></v-spacer>
            <!-- TODO: wire up to the new permission flow -->
            <v-btn prepend-icon="mdi-plus" @click="newPermission">New Permission</v-btn>
        </v-row>

        <!-- Active filters (only shown when there are any); closing a chip removes that value -->
        <div v-if="userFilter.length || datasetFilter.length" class="d-flex flex-wrap ga-2 mb-3">
            <v-chip
                v-for="id in userFilter"
                :key="id"
                closable
                color="primary"
                @click:close="userFilter = userFilter.filter((u) => u !== id)"
            >
                User: {{ userName(id) }}
            </v-chip>
            <v-chip
                v-for="id in datasetFilter"
                :key="id"
                closable
                color="primary"
                @click:close="datasetFilter = datasetFilter.filter((d) => d !== id)"
            >
                Dataset: {{ datasetName(id) }}
            </v-chip>
        </div>

        <v-data-table :headers="headers" :items="rows" item-value="key">
            <template #item.actions="{ item }">
                <!-- TODO: wire up to a popup for editing this permission -->
                <v-btn prepend-icon="mdi-pencil" @click="edit(item.userId, item.datasetId)">Edit</v-btn>
            </template>
        </v-data-table>
    </v-container>
</template>

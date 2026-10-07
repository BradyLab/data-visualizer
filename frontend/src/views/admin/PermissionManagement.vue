<script setup lang="ts">
// Permission management page: table of who holds which permission on which dataset.
// Admins see every dataset and permission; other users only see datasets they own (the dataset's owner column), since
// only owners may see who a dataset is shared with, and are redirected home if they own none.
import { computed, ref, watch, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { useDatasetStore } from "@src/stores/dataset";
import { UserStatus } from "@commons/user";
import { grantablePermissions, type PermissionOptions } from "@commons/permissions";
import { usePermissionStore } from "@src/stores/permission";
import NewPermissionDialog from "@src/components/NewPermissionDialog.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const userStore = useUserStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();

// Table columns: user, role, status, dataset, permission level (changed in place with a dropdown), and an actions column for the delete button
const headers = [
    { title: "USER", key: "userName" },
    { title: "ROLE", key: "role" },
    { title: "STATUS", key: "status" },
    { title: "DATASET", key: "datasetName" },
    { title: "PERMISSION", key: "perm" },
    { title: "", key: "actions", sortable: false, align: "end" as const },
];

// Selected filter values (user ids and dataset ids); an empty list means no filter on that field
// The user filter can be preset with a ?user=<id> query param (e.g. from the User Management page)
const userFromQuery = () => (typeof route.query.user === "string" ? [route.query.user] : []);
const userFilter = ref<string[]>(userFromQuery());
// The router reuses this component when only the query changes, so re-apply the preset whenever ?user= changes
watch(
    () => route.query.user,
    () => (userFilter.value = userFromQuery())
);
const datasetFilter = ref<string[]>([]);

// Chip colour for a user status: red when deactivated, amber while invited
const statusColor = (status: string) =>
    status === UserStatus.INACTIVE ? "error" : status === UserStatus.INVITED ? "warning" : undefined;

// Status and role of each user by id; absent for users who aren't loaded
const statusOf = (id: string) => userStore.names.find((u) => u.id === id)?.status;
const roleOf = (id: string) => userStore.names.find((u) => u.id === id)?.role;

// Whether rows of deactivated users are included (hidden by default, since they can no longer log in)
const showInactive = ref(false);
// A user filter that names a deactivated user (e.g. from ?user=) switches deactivated users on, or their rows would be hidden
// Also runs once the names load, since the status of the filtered user isn't known before then
watch(
    [userFilter, () => userStore.names],
    () => {
        if (userFilter.value.some((id) => statusOf(id) === UserStatus.INACTIVE)) showInactive.value = true;
    },
    { immediate: true }
);

// Datasets the viewer may manage: all for admins, otherwise only those they own
const visibleDatasets = computed(() => datasetStore.datasets.filter((d) => permissionStore.canManage(d)));

// Permission rows joined with user and dataset details, limited to the selected filters.
// Rows of deactivated users are left out unless showInactive is on.
// Admins see every permission; others only see permissions on the datasets they manage.
const rows = computed(() => {
    return permissionStore.adminPermissions
        .filter(
            (p) =>
                (showInactive.value || statusOf(p.user_id) !== UserStatus.INACTIVE) &&
                (!userFilter.value.length || userFilter.value.includes(p.user_id)) &&
                (!datasetFilter.value.length || datasetFilter.value.includes(p.dataset_id))
        )
        .map((p) => ({
            key: `${p.user_id}:${p.dataset_id}`,
            userId: p.user_id,
            datasetId: p.dataset_id,
            userName: userStore.nameOf(p.user_id),
            role: roleOf(p.user_id) ?? "",
            status: statusOf(p.user_id) ?? "",
            datasetName: visibleDatasets.value.find((d) => d.id === p.dataset_id)?.name ?? p.dataset_id,
            perm: p.perm,
        }));
});

// Users offered in the user filter: deactivated users only when they are being shown
const filterUsers = computed(() =>
    userStore.names.filter((u) => showInactive.value || u.status !== UserStatus.INACTIVE)
);

// Display names for the filter chips
// They fall back to the raw id if the user or dataset isn't in the loaded lists
const userName = (id: string) => userStore.nameOf(id);
const datasetName = (id: string) => visibleDatasets.value.find((d) => d.id === id)?.name ?? id;

// Visitors without a login are sent home (also covers logging out while on this page).
// Checks the token rather than isLoggedIn, which is also false while a saved session is still being restored
// (token set, user id empty); the route guard already keeps logged-out visitors from getting here at all
watchEffect(() => {
    if (!auth.token) router.replace("/home");
});

// Message shown when the datasets or permissions could not be loaded
const error = ref<string | null>(null);

// Load the data once the real user is known (the id is empty until login / session restore finishes)
watch(
    () => auth.user.id,
    async (id) => {
        if (!id) return;
        error.value = null;
        try {
            await Promise.all([
                // Only used for names and the user filter, so a failure just leaves ids showing instead of names
                userStore.fetchNames().catch(() => {}),
                datasetStore.fetchDatasets(),
                permissionStore.fetchMine(id),
            ]);
            // Needs the datasets and the viewer's own permissions, which decide which datasets they manage
            await permissionStore.fetchManaged(
                visibleDatasets.value.map((d) => d.id),
                auth.isAdmin
            );
        } catch {
            // No redirect here: an empty list after a failure doesn't mean the viewer lacks access
            error.value = "Unable to load permissions. Please try again.";
            return;
        }
        // Non-admins who own no dataset have nothing to manage here
        if (!auth.isAdmin && !visibleDatasets.value.length) router.replace("/home");
    },
    { immediate: true }
);

// Whether the new-permission popup is open
const newPermissionOpen = ref(false);

// Levels offered in a row's dropdown: only those the row's user may hold (the rule the backend enforces)
// Empty if the user's role isn't loaded, in which case the level is shown as plain text
const optionsFor = (userId: string) => {
    const user = userStore.names.find((u) => u.id === userId);
    return user ? grantablePermissions(user.role) : [];
};

// Key of the row whose change is being saved, so its dropdown is disabled meanwhile
const savingKey = ref<string | null>(null);

// Saves a new level for a row; on failure the dropdown snaps back to the stored level (the store is only updated on success)
async function changePerm(row: { key: string; userId: string; datasetId: string; perm: PermissionOptions }, perm: PermissionOptions) {
    if (perm === row.perm) return;
    savingKey.value = row.key;
    error.value = null;
    try {
        await permissionStore.editPermission(row.userId, row.datasetId, perm);
    } catch {
        error.value = "Unable to change the permission. Please try again.";
    } finally {
        savingKey.value = null;
    }
}

// The row awaiting delete confirmation (null = the confirm popup is closed) and whether the delete is in flight
const toDelete = ref<{ userId: string; datasetId: string; userName: string; datasetName: string } | null>(null);
const deleting = ref(false);

// Revokes the confirmed row's permission and closes the popup; on failure the popup closes and the page shows an error
async function confirmDelete() {
    if (!toDelete.value) return;
    deleting.value = true;
    error.value = null;
    try {
        await permissionStore.removePermission(toDelete.value.userId, toDelete.value.datasetId);
    } catch {
        error.value = "Unable to delete the permission. Please try again.";
    } finally {
        deleting.value = false;
        toDelete.value = null;
    }
}
</script>

<template>
    <v-container v-if="auth.user.id">
        <h1 class="text-h6 font-weight-bold">PERMISSIONS MANAGEMENT</h1>
        <v-alert v-if="error" type="error" variant="tonal" closable class="my-4" @click:close="error = null">{{ error }}</v-alert>

        <!-- Filter menu: each item opens a submenu of values; picking one sets the filter and shows a chip -->
        <v-row class="align-center mb-2">
            <v-menu :close-on-content-click="false">
                <template #activator="{ props }">
                    <v-btn v-bind="props" prepend-icon="mdi-filter-variant">Filter</v-btn>
                </template>
                <v-list>
                    <v-list-item append-icon="mdi-chevron-right">
                        <v-list-item-title>User</v-list-item-title>
                        <v-menu activator="parent" submenu open-on-hover :close-on-content-click="false" location="end">
                            <v-list v-model:selected="userFilter" select-strategy="leaf">
                                <v-list-item v-for="user in filterUsers" :key="user.id" :title="user.name" :value="user.id">
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
                    <v-divider></v-divider>
                    <v-list-item @click="showInactive = !showInactive">
                        <template #prepend>
                            <v-icon :icon="showInactive ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'"></v-icon>
                        </template>
                        <v-list-item-title>Show deactivated users</v-list-item-title>
                    </v-list-item>
                </v-list>
            </v-menu>
            <v-spacer></v-spacer>
            <v-btn prepend-icon="mdi-plus" @click="newPermissionOpen = true">New Permission</v-btn>
        </v-row>

        <!-- Active filters (only shown when there are any); closing a chip removes that value -->
        <div v-if="userFilter.length || datasetFilter.length || showInactive" class="d-flex flex-wrap ga-2 mb-3">
            <v-chip v-if="showInactive" closable color="primary" @click:close="showInactive = false">
                Including deactivated users
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
            <template #item.status="{ item }">
                <v-chip v-if="item.status" size="small" :color="statusColor(item.status)">
                    {{ item.status }}
                </v-chip>
            </template>
            <template #item.perm="{ item }">
                <v-select
                    v-if="optionsFor(item.userId).length"
                    :model-value="item.perm"
                    :items="optionsFor(item.userId)"
                    :disabled="savingKey === item.key"
                    :loading="savingKey === item.key"
                    :clearable="false"
                    density="compact"
                    variant="outlined"
                    hide-details
                    max-width="180"
                    @update:model-value="changePerm(item, $event)"
                ></v-select>
                <span v-else>{{ item.perm }}</span>
            </template>
            <template #item.actions="{ item }">
                <v-btn
                    icon="mdi-delete"
                    variant="text"
                    aria-label="Delete permission"
                    :disabled="savingKey === item.key"
                    @click="toDelete = item"
                ></v-btn>
            </template>
        </v-data-table>

        <!-- Cannot be dismissed while the delete is in flight -->
        <v-dialog :model-value="!!toDelete" max-width="480" :persistent="deleting" @update:model-value="toDelete = null">
            <v-card class="pa-4">
                <v-card-title>Delete Permission</v-card-title>
                <v-card-text>
                    Remove {{ toDelete?.userName }}'s access to {{ toDelete?.datasetName }}? This cannot be undone.
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <!-- TODOC05: color="white" is likely invisible on a light card background -->
                    <v-btn :disabled="deleting" color="white" @click="toDelete = null">Cancel</v-btn>
                    <v-btn :loading="deleting" color="error" variant="tonal" @click="confirmDelete">Delete</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <NewPermissionDialog v-model="newPermissionOpen" :datasets="visibleDatasets" />
    </v-container>
</template>

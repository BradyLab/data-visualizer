<script setup lang="ts">
// Settings page view: user settings (name, plus a change password popup) and an admin section with per-dataset
// visibility switches and edit buttons, plus links to the management pages the user is allowed to see
import { useRouter } from "vue-router";
import { computed, onMounted, ref, watch } from "vue";
import { UserStatus } from "@commons/user";
import { DatasetVisibility, type IDataset } from "@commons/dataset";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { usePermissionStore } from "@src/stores/permission";
import { useDatasetStore } from "@src/stores/dataset";
import ChangePasswordDialog from "@src/components/ChangePasswordDialog.vue";

// Router instance used for programmatic navigation
const router = useRouter();

// Auth store (login state and current user), user store (saving changes), permission store (edit access)
const auth = useAuthStore();
const userStore = useUserStore();
const permissionStore = usePermissionStore();
const datasetStore = useDatasetStore();

// Sets a dataset public or private; the switch follows the store, so a failed save leaves it unchanged
// (the switch reports null when it is cleared, which is treated the same as off, i.e. private)
const visibilityError = ref<string | null>(null);
async function setVisibility(dataset: IDataset, isPublic: boolean | null) {
    visibilityError.value = null;
    try {
        await datasetStore.editDataset(dataset.id, {
            visibility: isPublic ? DatasetVisibility.PUBLIC : DatasetVisibility.PRIVATE,
        });
    } catch {
        visibilityError.value = `Unable to change the visibility of ${dataset.name}. Please try again.`;
    }
}

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
}

// Dataset list for the admin section; if the request fails the list is simply empty (the login requirement is the route guard's job)
onMounted(() => {
    datasetStore.fetchDatasets().catch(() => {});
});

// Admins see every management page; others only see Permissions, and only if they own some dataset
const canManagePermissions = computed(() => auth.isAdmin || datasetStore.datasets.some((d) => permissionStore.canManage(d)));

// Load the user's own permissions and fill the name field for the current user (the id is empty once they log out)
const name = ref("");

// Vuetify validation rule factory: fails on empty or whitespace-only input
const required = (label: string) => (v: string) => !!v?.trim() || `${label} is required`;

// --- Name ---
const nameForm = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const nameSaving = ref(false);
const nameMessage = ref<{ type: "success" | "error"; text: string } | null>(null);

// Saves the new name and updates the logged-in user
async function saveName() {
    if (!(await nameForm.value?.validate())?.valid) return;
    nameSaving.value = true;
    nameMessage.value = null;
    try {
        auth.user = await userStore.editUser(auth.user.id, { name: name.value.trim() });
        nameMessage.value = { type: "success", text: "Name updated." };
    } catch {
        nameMessage.value = { type: "error", text: "Unable to update your name. Please try again." };
    } finally {
        nameSaving.value = false;
    }
}

// --- Password ---
const passwordDialogOpen = ref(false);
// Invited users must replace their default password, so the popup opens whenever the user is INVITED
watch(
    () => auth.user.status,
    (status) => {
        if (status === UserStatus.INVITED) passwordDialogOpen.value = true;
    },
    { immediate: true }
);
</script>

<template>
    <v-container class="px-12">
        <h1 class="text-h6 font-weight-bold mb-4">SETTINGS</h1>

        <!-- User settings: change name and password -->
        <h2 v-if="canManagePermissions" class="text-subtitle-1 font-weight-bold mb-2">USER SETTINGS</h2>
        <v-form ref="nameForm" @submit.prevent="saveName">
            <v-row class="mb-6 mx-4">
                <v-col cols="12" md="6">
                    <v-text-field v-model="name" label="Name" :rules="[required('Name')]" />
                    <v-alert v-if="nameMessage" :type="nameMessage.type" variant="tonal" density="compact" class="mb-3">
                        {{ nameMessage.text }}
                    </v-alert>
                </v-col>
                <v-col>
                    <v-btn class="mt-3" :loading="nameSaving" @click="saveName">Save Name</v-btn>
                </v-col>
            </v-row>
        </v-form>

        <v-row class="mb-6 mx-4">
            <v-col cols="12" md="6">
                <v-btn @click="passwordDialogOpen = true">Change Password</v-btn>
            </v-col>
        </v-row>

        <!-- Admin section: links to the management pages (dataset list with visibility switches follows) -->
        <h2 v-if="canManagePermissions" class="text-subtitle-1 font-weight-bold mb-2">ADMIN</h2>
        <v-row v-if="canManagePermissions" class="mb-6 mx-4">
            <v-col v-if="auth.isAdmin" cols="auto">
                <v-btn prepend-icon="mdi-account-multiple-outline" @click="router.push({ name: 'user-mgmt' })">
                    User Management
                </v-btn>
            </v-col>
            <v-col cols="auto">
                <v-btn prepend-icon="mdi-shield-key-outline" @click="router.push({ name: 'permissions' })">
                    Permission Management
                </v-btn>
            </v-col>
            <v-col v-if="auth.isAdmin" cols="auto">
                <v-btn prepend-icon="mdi-history" @click="router.push({ name: 'activity-logs' })">Activity Logs</v-btn>
            </v-col>
        </v-row>

        <!-- One row per dataset: name (links to the dataset), private/public switch, and edit button -->
        <!-- Only admins see this list and the visibility error above it -->
        <v-alert
            v-if="auth.isAdmin && visibilityError"
            type="error"
            variant="tonal"
            closable
            class="mb-4 mx-4"
            @click:close="visibilityError = null"
        >
            {{ visibilityError }}
        </v-alert>
        <template v-if="auth.isAdmin">
            <v-row v-for="dataset in datasetStore.datasets" :key="dataset.url" align="center" class="mx-4">
                <v-col @click="navTo('/dataset/' + dataset.url)">{{ dataset.name }}</v-col>
                <v-col cols="auto" class="d-flex align-center">
                    <span class="mr-2">Private</span>
                    <v-switch
                        :model-value="dataset.visibility === DatasetVisibility.PUBLIC"
                        @update:model-value="(value) => setVisibility(dataset, value)"
                        color="primary"
                        density="compact"
                        inset
                        hide-details
                    ></v-switch>
                    <span class="ml-2">Public</span>
                </v-col>
                <v-col cols="auto">
                    <v-btn prepend-icon="mdi-pencil-outline" @click="router.push(`/dataset/${dataset.url}/edit`)">
                        Edit Dataset
                    </v-btn>
                </v-col>
            </v-row>
        </template>

        <ChangePasswordDialog v-model="passwordDialogOpen" />
    </v-container>
</template>

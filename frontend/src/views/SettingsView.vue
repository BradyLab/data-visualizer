<script setup lang="ts">
// Settings page view: user settings (name, plus a change password popup) and an admin section with per-dataset
// visibility switches and edit buttons, plus links to the management pages the user is allowed to see
import { useRouter } from "vue-router";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { UserStatus } from "@commons/user";
import { DatasetVisibility, type IDataset } from "@commons/dataset";
import { useAuthStore } from "@src/stores/auth";
import { useUserStore } from "@src/stores/user";
import { usePermissionStore } from "@src/stores/permission";
import { useDatasetStore } from "@src/stores/dataset";
import ChangePasswordDialog from "@src/components/ChangePasswordDialog.vue";
import { validateForm } from "@src/utils/validateForm";

// Router instance used for programmatic navigation
const router = useRouter();

// Auth store (login state and current user), user store (saving changes), permission store (edit access), dataset store (admin list)
const auth = useAuthStore();
const userStore = useUserStore();
const permissionStore = usePermissionStore();
const datasetStore = useDatasetStore();

// A public dataset needs a DOI and an attribution. Switching one on without them opens a popup that names what is missing and offers the edit
// page or cancelling (the switch follows the store, so the dataset simply stays private)
const missingPublicFields = (dataset: IDataset) => [
    ...(dataset.doi.trim() ? [] : ["DOI"]),
    ...(dataset.attribution.trim() ? [] : ["attribution"]),
];
const incomplete = ref<{ dataset: IDataset; missing: string[] } | null>(null);
// The switch shows its own flipped state until its value changes, so a refused flip re-creates that dataset's switch (it is keyed on this)
const switchResets = ref<Record<string, number>>({});
const incompleteOpen = computed({
    get: () => incomplete.value !== null,
    set: (open: boolean) => {
        if (open) return;
        const id = incomplete.value?.dataset.id;
        incomplete.value = null;
        // The re-created switch is a new element, so give it back the focus the popup took from the old one
        if (id) nextTick(() => document.getElementById(`visibility-${id}`)?.focus());
    },
});
function editIncomplete() {
    const dataset = incomplete.value?.dataset;
    incomplete.value = null;
    if (dataset) router.push(`/dataset/${dataset.url}/edit`);
}

// Sets a dataset public or private; the switch follows the store, so a failed save leaves it unchanged
// (the switch reports null when it is cleared, which is treated the same as off, i.e. private)
const visibilityError = ref<string | null>(null);
async function setVisibility(dataset: IDataset, isPublic: boolean | null) {
    visibilityError.value = null;
    const missing = isPublic ? missingPublicFields(dataset) : [];
    if (missing.length) {
        incomplete.value = { dataset, missing };
        switchResets.value[dataset.id] = (switchResets.value[dataset.id] ?? 0) + 1;
        return;
    }
    try {
        await datasetStore.editDataset(dataset.id, {
            visibility: isPublic ? DatasetVisibility.PUBLIC : DatasetVisibility.PRIVATE,
        });
    } catch {
        visibilityError.value = `Unable to change the visibility of ${dataset.name}. Please try again.`;
    }
}

// Dataset list for the admin section; if the request fails the list is simply empty (the login requirement is the route guard's job)
onMounted(() => {
    datasetStore.fetchDatasets().catch(() => {});
    permissionStore.fetchMine(auth.user.id).catch(() => {});
});

// Admins see every management page; others only see Permissions, and only if they own some dataset
const canManagePermissions = computed(() => auth.isAdmin || datasetStore.datasets.some((d) => permissionStore.canManage(d)));

// Value of the name field in the user settings form

// Vuetify validation rule factory: fails on empty or whitespace-only input
const required = (label: string) => (v: string) => !!v?.trim() || `${label} is required`;

// --- Name ---
const nameForm = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const nameSaving = ref(false);
const nameMessage = ref<{ type: "success" | "error"; text: string } | null>(null);

// Saves the new name and updates the logged-in user
async function saveName() {
    if (!(await validateForm(nameForm.value))) return;
    nameSaving.value = true;
    nameMessage.value = null;
    try {
        auth.user = await userStore.editUser(auth.user.id, { name: auth.user.name.trim() });
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
                    <v-text-field v-model="auth.user.name" label="Name" autocomplete="name" :rules="[required('Name')]" />
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
                    Permissions Management
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
                <v-col>
                    <RouterLink :to="'/dataset/' + dataset.url">{{ dataset.name }}</RouterLink>
                </v-col>
                <v-col cols="auto" class="d-flex align-center">
                    <span class="mr-2" aria-hidden="true">Private</span>
                    <v-switch
                        :id="`visibility-${dataset.id}`"
                        :key="switchResets[dataset.id] ?? 0"
                        :aria-label="`${dataset.name} is public`"
                        :model-value="dataset.visibility === DatasetVisibility.PUBLIC"
                        @update:model-value="(value) => setVisibility(dataset, value)"
                        color="primary"
                        density="compact"
                        inset
                        hide-details
                    ></v-switch>
                    <span class="ml-2" aria-hidden="true">Public</span>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        prepend-icon="mdi-pencil-outline"
                        @click="router.push(`/dataset/${dataset.url}/edit`)"
                        :aria-label="`Edit Dataset ${dataset.name}`"
                    >
                        Edit Dataset
                    </v-btn>
                </v-col>
            </v-row>
        </template>

        <!-- Shown when a dataset without a DOI or attribution is switched to public -->
        <v-dialog v-model="incompleteOpen" max-width="480" aria-labelledby="incomplete-title">
            <v-card class="pa-4">
                <v-card-title id="incomplete-title" tag="h2">Can't make this dataset public yet</v-card-title>
                <v-card-text>
                    A public dataset needs a DOI and an attribution. {{ incomplete?.dataset.name }} has no
                    {{ incomplete?.missing.join(" and ") }}. It stays private until you add
                    {{ incomplete?.missing.length === 1 ? "it" : "them" }} on the edit page.
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="white" @click="incompleteOpen = false">Cancel</v-btn>
                    <v-btn color="white" variant="tonal" @click="editIncomplete">Edit dataset</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <ChangePasswordDialog v-model="passwordDialogOpen" />
    </v-container>
</template>

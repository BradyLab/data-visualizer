<script setup lang="ts">
// Popup to grant a user access to a dataset: pick the user, the dataset and the access level; saves through the permission store
import { computed, ref, watch } from "vue";
import axios from "axios";
import { grantablePermissions, PermissionOptions } from "@commons/permissions";
import type { IDataset } from "@commons/dataset";
import { UserStatus } from "@commons/user";
import { usePermissionStore } from "@src/stores/permission";
import { useUserStore } from "@src/stores/user";

// v-model controls whether the popup is open
const open = defineModel<boolean>({ default: false });

// Datasets the viewer may share (chosen by the parent)
const props = defineProps<{ datasets: IDataset[] }>();

const permissionStore = usePermissionStore();
const userStore = useUserStore();

const userId = ref<string | null>(null);
const datasetId = ref<string | null>(null);
const perm = ref<PermissionOptions | null>(null);
const saving = ref(false);
const error = ref<string | null>(null);
const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);

// Users who can be granted something: not deactivated users, admins, nor the chosen dataset's owner, who already have full access to it
const grantableUsers = computed(() => {
    const owner = props.datasets.find((d) => d.id === datasetId.value)?.owner;
    return userStore.names.filter(
        (u) => u.status !== UserStatus.INACTIVE && grantablePermissions(u.role).length && u.id !== owner
    );
});

// Clear the chosen user if they are no longer offered (e.g. a dataset they own was picked afterwards)
watch(grantableUsers, (users) => {
    if (userId.value && !users.some((u) => u.id === userId.value)) userId.value = null;
});

// Only the levels the chosen user's role may hold (the same rule the backend enforces); none until a user is picked
const permOptions = computed(() => {
    const user = userStore.names.find((u) => u.id === userId.value);
    return user ? grantablePermissions(user.role) : [];
});

// Keep the level valid when the user changes: default to the lowest level their role allows
watch(permOptions, (options) => {
    if (!perm.value || !options.includes(perm.value)) perm.value = options[0] ?? null;
});

// Field rule: a selection is required
const required = (label: string) => (v: string | null) => !!v || `${label} is required`;

// Start with an empty form each time the popup opens
watch(open, (isOpen) => {
    if (!isOpen) return;
    userId.value = null;
    datasetId.value = null;
    perm.value = null;
    error.value = null;
});

// Validates the form, then grants the permission and closes the popup; shows an error and stays open if the request fails
async function submit() {
    if (!(await form.value?.validate())?.valid) return;
    saving.value = true;
    error.value = null;
    try {
        await permissionStore.addPermission({ user_id: userId.value!, dataset_id: datasetId.value!, perm: perm.value! });
        open.value = false;
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 409
                ? "This user already has a permission on this dataset. Edit the existing one instead."
                : "Unable to create the permission. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <!-- Cannot be dismissed while the request is in flight -->
    <v-dialog v-model="open" max-width="480" :persistent="saving">
        <v-card class="pa-4">
            <v-card-title>New Permission</v-card-title>
            <v-card-text class="px-4 pb-0">
                <v-form ref="form" @submit.prevent="submit">
                    <v-select
                        v-model="datasetId"
                        :items="datasets"
                        item-title="name"
                        item-value="id"
                        label="Dataset"
                        :rules="[required('Dataset')]"
                    ></v-select>
                    <v-select
                        v-model="userId"
                        :items="grantableUsers"
                        item-title="name"
                        item-value="id"
                        label="User"
                        :rules="[required('User')]"
                    ></v-select>
                    <v-select
                        v-model="perm"
                        :items="permOptions"
                        label="Permission"
                        :clearable="false"
                        :disabled="!userId"
                        :rules="[required('Permission')]"
                    ></v-select>
                </v-form>
                <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn :disabled="saving" color="white" @click="open = false">Cancel</v-btn>
                <v-btn :loading="saving" color="white" variant="tonal" @click="submit">Create</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

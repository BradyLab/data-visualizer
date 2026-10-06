<script setup lang="ts">
// Popup for an admin to edit a user's role and status; saves through the user store
import { ref, watch } from "vue";
import { ASSIGNABLE_ROLES, UserRoles, UserStatus, type IUser } from "@commons/user";
import { useUserStore } from "@src/stores/user";

const props = defineProps<{ user: IUser | null }>();
// v-model controls whether the popup is open
const open = defineModel<boolean>({ default: false });

const userStore = useUserStore();

// GUEST is the logged-out placeholder role, so it isn't offered for real users
const roleOptions = ASSIGNABLE_ROLES;
const statusOptions: UserStatus[] = Object.values(UserStatus).filter((s) => s !== UserStatus.INVITED);

const role = ref<UserRoles>(UserRoles.EXTERNAL);
const status = ref<UserStatus>(UserStatus.ACTIVE);
const saving = ref(false);
const error = ref<string | null>(null);

// Reset the form to the user's current values each time the popup opens
watch(open, (isOpen) => {
    if (!isOpen || !props.user) return;
    role.value = props.user.role;
    status.value = props.user.status;
    error.value = null;
});

// Saves the changed fields and closes the popup; shows an error and stays open if the request fails
async function save() {
    if (!props.user) return;
    saving.value = true;
    error.value = null;
    try {
        await userStore.editUser(props.user.id, { role: role.value, status: status.value });
        open.value = false;
    } catch {
        error.value = "Unable to save changes. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <v-dialog v-model="open" max-width="480" :persistent="saving">
        <v-card v-if="user" class="pa-4">
            <v-card-title>{{ user.name }} ({{ user.email }})</v-card-title>
            <v-card-text class="px-4 pb-0">
                <v-select v-model="role" :items="roleOptions" label="Role" :clearable="false"></v-select>
                <!-- Status of invited users is hidden: they become ACTIVE by changing their password -->
                <v-select
                    v-if="status !== UserStatus.INVITED"
                    v-model="status"
                    :items="statusOptions"
                    label="Status"
                    :clearable="false"
                ></v-select>
                <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn :disabled="saving" color="white" @click="open = false">Cancel</v-btn>
                <v-btn :loading="saving" color="white" variant="tonal" @click="save">Save</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

<script setup lang="ts">
// Popup for the logged-in user to change their password; asks for the old password too, which the backend verifies
import { computed, ref, watch } from "vue";
import axios from "axios";
import { authApi } from "@src/api/auth";
import { useAuthStore } from "@src/stores/auth";
import { UserStatus } from "@commons/user";

const auth = useAuthStore();

// Invited users must change the default password, so the popup cannot be dismissed until they do
const mustChange = computed(() => auth.user.status === UserStatus.INVITED);

// v-model controls whether the popup is open
const open = defineModel<boolean>({ default: false });

const oldPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const saving = ref(false);
const error = ref<string | null>(null);
const success = ref(false);
const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);

const required = (label: string) => (v: string) => !!v || `${label} is required`;
const matchesNew = (v: string) => v === newPassword.value || "Passwords do not match";
const notSameAsOld = (v: string) => v !== oldPassword.value || "New password must not equal old password";

// Start with an empty form each time the popup opens
watch(open, (isOpen) => {
    if (!isOpen) return;
    oldPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    error.value = null;
    success.value = false;
});

// Validates the form, then changes the password; shows a message either way and closes only via the buttons
async function submit() {
    if (success.value || !(await form.value?.validate())?.valid) return;
    saving.value = true;
    error.value = null;
    try {
        await authApi.changePassword(oldPassword.value, newPassword.value);
        success.value = true;
        // The backend activates invited users on their first password change
        if (auth.user.status === UserStatus.INVITED) auth.user = { ...auth.user, status: UserStatus.ACTIVE };
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 403
                ? "Old password is incorrect."
                : "Unable to change your password. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <v-dialog v-model="open" max-width="480" :persistent="saving || mustChange">
        <v-card class="pa-4">
            <v-card-title>Change Password</v-card-title>
            <v-card-text class="px-4 pb-0">
                <v-form ref="form" @submit.prevent="submit">
                    <v-text-field
                        v-model="oldPassword"
                        label="Old password"
                        type="password"
                        :clearable="false"
                        :rules="[required('Old password')]"
                    ></v-text-field>
                    <v-text-field
                        v-model="newPassword"
                        label="New password"
                        type="password"
                        :clearable="false"
                        :rules="[required('New password'), notSameAsOld]"
                    ></v-text-field>
                    <v-text-field
                        v-model="confirmPassword"
                        label="Confirm new password"
                        type="password"
                        :clearable="false"
                        :rules="[required('Confirmation'), matchesNew]"
                    ></v-text-field>
                </v-form>
                <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
                <v-alert v-if="success" type="success" variant="tonal" density="compact">Password updated.</v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn v-if="!mustChange" :disabled="saving" color="white" @click="open = false">{{
                    success ? "Close" : "Cancel"
                }}</v-btn>
                <v-btn v-if="!success" :loading="saving" color="white" variant="tonal" @click="submit">Change</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

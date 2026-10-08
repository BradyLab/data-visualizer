<script setup lang="ts">
// Popup for the logged-in user to change their password; asks for the old password too, which the backend verifies
import { computed, ref, watch } from "vue";
import axios from "axios";
import { authApi } from "@src/api/auth";
import { useAuthStore } from "@src/stores/auth";
import { UserStatus } from "@commons/user";
import { MIN_PASSWORD_LENGTH } from "@commons/general";

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

// Field rules; each returns true when valid or an error message when not
// The backend enforces the same minimum (and also rejects the default password, which the client cannot know)
const minLength = (v: string) => v.length >= MIN_PASSWORD_LENGTH || `Must be at least ${MIN_PASSWORD_LENGTH} characters`;
const required = (label: string) => (v: string) => !!v || `${label} is required`;
const matchesNew = (v: string) => v === newPassword.value || "Passwords do not match";
const notSameAsOld = (v: string) => v !== oldPassword.value || "New password must not equal old password";

// Editing the new password invalidates a confirmation typed earlier, so re-run the form rules
watch(newPassword, () => {
    if (confirmPassword.value) form.value?.validate();
});

// Likewise, editing the old password changes whether the new one matches it (notSameAsOld), so re-run the rules once a new password is typed
watch(oldPassword, () => {
    if (newPassword.value) form.value?.validate();
});

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
    // Ignore repeat submits (e.g. Enter key) once the change has gone through
    if (success.value || !(await form.value?.validate())?.valid) return;
    saving.value = true;
    error.value = null;
    try {
        const newToken = await authApi.changePassword(oldPassword.value, newPassword.value);
        success.value = true;
        // The old token stopped working with the password change, so switch to the fresh one
        auth.setToken(newToken);
        // The backend activates invited users on their first password change
        auth.markPasswordChanged();
    } catch (err) {
        const response = axios.isAxiosError(err) ? err.response : undefined;
        // 400 and 429 carry the backend's reason (e.g. new password is the default password, too many attempts)
        error.value =
            response?.status === 403
                ? "Old password is incorrect."
                : (response?.status === 400 || response?.status === 429) && typeof response.data?.error === "string"
                  ? response.data.error
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
                        :rules="[required('New password'), minLength, notSameAsOld]"
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

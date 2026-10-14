<script setup lang="ts">
// Popup for an admin to enter the name, email and role of a user to invite; sends the invite through the user store.
// Afterwards it shows the user's temporary password once (it is never emailed), for the admin to pass on over another channel
import { ref, watch } from "vue";
import axios from "axios";
import { ASSIGNABLE_ROLES, UserRoles } from "@commons/user";
import { useUserStore } from "@src/stores/user";
import { type InviteUserResult } from "@src/interfaces/user";

// v-model controls whether the popup is open
const open = defineModel<boolean>({ default: false });

const userStore = useUserStore();

// GUEST is the logged-out placeholder role, so it isn't offered for real users
const roleOptions = ASSIGNABLE_ROLES;

const name = ref("");
const email = ref("");
const role = ref<UserRoles>(UserRoles.EXTERNAL);
const saving = ref(false);
const error = ref<string | null>(null);
// Set once the invite went through; switches the popup from the form to the one-time password
const invited = ref<InviteUserResult | null>(null);
const copied = ref(false);
const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);

// Field rules: name required, email required and shaped like an address
const required = (label: string) => (v: string) => !!v?.trim() || `${label} is required`;
const validEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim()) || "Enter a valid email address";

// Start with an empty form each time the popup opens
watch(open, (isOpen) => {
    if (!isOpen) return;
    name.value = "";
    email.value = "";
    role.value = UserRoles.EXTERNAL;
    error.value = null;
    invited.value = null;
    copied.value = false;
});

// Validates the form, then sends the invite and shows the temporary password; shows an error and stays on the form if the request fails
async function submit() {
    if (!(await form.value?.validate())?.valid) return;
    saving.value = true;
    error.value = null;
    try {
        invited.value = await userStore.addUser({ name: name.value.trim(), email: email.value.trim(), role: role.value });
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 409
                ? "A user with that email already exists."
                : "Unable to send the invite. Please try again.";
    } finally {
        saving.value = false;
    }
}

// Copies the temporary password; if the browser refuses (e.g. no clipboard permission) the admin can still select it by hand
async function copyPassword() {
    try {
        await navigator.clipboard.writeText(invited.value?.temporaryPassword ?? "");
        copied.value = true;
    } catch {
        copied.value = false;
    }
}
</script>

<template>
    <!-- Cannot be dismissed while the invite request is in flight, or while the one-time password is showing -->
    <v-dialog v-model="open" max-width="480" :persistent="saving || !!invited">
        <v-card v-if="invited" class="pa-4">
            <v-card-title>User Invited</v-card-title>
            <v-card-text class="px-4 pb-0">
                <v-alert v-if="invited.emailSent" type="success" variant="tonal" density="compact" class="mb-4">
                    An email with a login link was sent to {{ invited.user.email }}.
                </v-alert>
                <v-alert v-else type="warning" variant="tonal" density="compact" class="mb-4">
                    The invite email could not be sent. Send {{ invited.user.name }} the login link yourself, along with the
                    password below.
                </v-alert>
                <p class="mb-2">
                    Give {{ invited.user.name }} this temporary password. They must replace it the first time they log in. <strong>It will not be shown again.</strong>
                </p>
                <v-text-field
                    :model-value="invited.temporaryPassword"
                    label="Temporary password"
                    readonly
                    :append-inner-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
                    @click:append-inner="copyPassword"
                ></v-text-field>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="white" variant="tonal" @click="open = false">Done</v-btn>
            </v-card-actions>
        </v-card>
        <v-card v-else class="pa-4">
            <v-card-title>Invite User</v-card-title>
            <v-card-text class="px-4 pb-0">
                <v-form ref="form" @submit.prevent="submit">
                    <v-text-field v-model="name" label="Name" :rules="[required('Name')]"></v-text-field>
                    <v-text-field
                        v-model="email"
                        label="Email"
                        type="email"
                        :rules="[required('Email'), validEmail]"
                    ></v-text-field>
                    <v-select v-model="role" :items="roleOptions" label="Role" :clearable="false"></v-select>
                </v-form>
                <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
            </v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn :disabled="saving" color="white" @click="open = false">Cancel</v-btn>
                <v-btn :loading="saving" color="white" variant="tonal" @click="submit">Invite</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>

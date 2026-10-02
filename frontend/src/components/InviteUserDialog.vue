<script setup lang="ts">
// Popup for an admin to enter the name, email and role of a user to invite; sends the invite through the user store
import { ref, watch } from "vue";
import axios from "axios";
import { UserRoles } from "@commons/user";
import { useUserStore } from "@src/stores/user";

// v-model controls whether the popup is open
const open = defineModel<boolean>({ default: false });

const userStore = useUserStore();

// GUEST is the logged-out placeholder role, so it isn't offered for real users
const roleOptions: UserRoles[] = Object.values(UserRoles).filter((r) => r !== UserRoles.GUEST);

const name = ref("");
const email = ref("");
const role = ref<UserRoles>(UserRoles.EXTERNAL);
const saving = ref(false);
const error = ref<string | null>(null);
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
});

// Validates the form, then sends the invite and closes the popup; shows an error and stays open if the request fails
async function submit() {
    if (!(await form.value?.validate())?.valid) return;
    saving.value = true;
    error.value = null;
    try {
        await userStore.inviteUser({ name: name.value.trim(), email: email.value.trim(), role: role.value });
        open.value = false;
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 409
                ? "A user with that email already exists."
                : "Unable to send the invite. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <v-dialog v-model="open" max-width="480" :persistent="saving">
        <v-card class="pa-4">
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

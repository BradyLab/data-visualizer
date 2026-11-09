<script setup lang="ts">
// Login page view: email and password form; logs in through the auth store and goes to the requested page (or home)
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@src/stores/auth";
import { UserStatus } from "@commons/user";
import { validateForm } from "@src/utils/validateForm";
import axios from "axios";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// Form field values
const email = ref("");
const password = ref("");

// Whether the password is shown as plain text (toggled by the eye icon)
const showPass = ref(false);

// Where to go once logged in: invited users go to settings to set a password, otherwise the page the route guard
// sent them from (?redirect=), or home. Only same-site paths are followed, so a crafted link can't send users elsewhere
const afterLogin = () => {
    if (auth.user.status === UserStatus.INVITED) return "/settings";
    const redirect = route.query.redirect;
    return typeof redirect === "string" && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/home";
};

// The v-form, used to run the field rules before logging in
const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const required = (label: string) => (v: string) => !!v || `${label} is required`;

// Submits the credentials; on success goes to afterLogin(), otherwise the store's error is shown
const submit = async () => {
    if (!(await validateForm(form.value))) return;
    if (!(await auth.login(email.value, password.value))) return;
    await router.push(afterLogin());
};

// "Forgot password?" dialog: asks the backend to email a new password to the address entered (the same answer is shown whether or not an account exists)
const resetOpen = ref(false);
const resetEmail = ref("");
const resetLoading = ref(false);
const resetDone = ref(false);
const resetError = ref("");

// Opens the dialog, starting from whatever was typed in the login form
const openReset = () => {
    resetEmail.value = email.value ?? "";
    resetDone.value = false;
    resetError.value = "";
    resetOpen.value = true;
};

// Sends the request; shows the confirmation, or an error (too many requests, or the server being unreachable)
const sendReset = async () => {
    const address = resetEmail.value?.trim();
    if (!address) {
        resetError.value = "Email address is required";
        return;
    }
    resetLoading.value = true;
    resetError.value = "";
    try {
        await auth.forgotPassword(address);
        resetDone.value = true;
    } catch (err) {
        resetError.value =
            axios.isAxiosError(err) && err.response?.data?.error
                ? err.response.data.error
                : "Could not send the request. Please try again.";
    } finally {
        resetLoading.value = false;
    }
};

// Already logged in: skip the login page
onMounted(() => {
    if (auth.isLoggedIn) router.push(afterLogin());
    auth.error = "";
});
</script>

<template>
    <!-- Login form -->
    <v-container class="d-flex justify-center" style="padding-top: 64px">
        <v-card class="pa-8" max-width="490" width="100%" variant="outlined" rounded="lg">
            <!-- Logo -->
            <v-row class="d-flex justify-center mb-6">
                <img src="@src/assets/BradyLabNewLogo.png" alt="Brady Lab logo" width="180" />
            </v-row>

            <h1 class="text-h6 text-center mb-4 visually-hidden">Log In</h1>

            <v-form ref="form" @submit.prevent="submit">
                <!-- Email input -->
                <v-row class="mt-2 mb-0">
                    <v-col>
                        <v-text-field
                            v-model="email"
                            type="email"
                            autocomplete="username"
                            prepend-inner-icon="mdi-email-outline"
                            label="Email Address"
                            :rules="[required('Email address')]"
                            clearable
                        ></v-text-field>
                    </v-col>
                </v-row>
                <!-- Password input with show/hide toggle -->
                <v-row class="my-0">
                    <v-col>
                        <v-text-field
                            v-model="password"
                            autocomplete="current-password"
                            prepend-inner-icon="mdi-lock-outline"
                            :type="showPass ? 'text' : 'password'"
                            label="Password"
                            :rules="[required('Password')]"
                            single-line
                            clearable
                        >
                            <template #append-inner>
                                <v-btn
                                    :icon="showPass ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                                    variant="text"
                                    size="small"
                                    density="comfortable"
                                    :aria-label="showPass ? 'Hide password' : 'Show password'"
                                    :aria-pressed="showPass"
                                    @click="showPass = !showPass"
                                ></v-btn>
                            </template>
                        </v-text-field>
                    </v-col>
                </v-row>

                <!-- Login error message and submit button -->
                <v-alert v-if="auth.error" type="error" variant="tonal" density="compact" class="mb-3">
                    {{ auth.error }}
                </v-alert>
                <v-btn type="submit" color="primary" block class="mb-2" :loading="auth.loading"> Log In </v-btn>
            </v-form>

            <!-- Password reset: the new password is emailed to the account's own address -->
            <v-row class="justify-center mb-3 mt-0">
                <v-btn variant="text" size="x-small" color="primary" data-test="forgot-password" @click="openReset">
                    Forgot password?
                </v-btn>
            </v-row>

            <v-row class="justify-center text-label-medium">Need an account? Reach out to the Brady Lab!</v-row>
        </v-card>

        <v-dialog v-model="resetOpen" max-width="440">
            <v-card class="pa-4" rounded="lg">
                <v-card-title>Reset your password</v-card-title>
                <v-card-text>
                    <template v-if="resetDone">
                        If an account exists for {{ resetEmail }}, a new password has been emailed to it. Log in with it, and you
                        will be asked to choose your own.
                    </template>
                    <v-form v-else @submit.prevent="sendReset">
                        <p class="mb-4">We will email a new password to the address on your account.</p>
                        <v-text-field
                            v-model="resetEmail"
                            type="email"
                            autocomplete="email"
                            prepend-inner-icon="mdi-email-outline"
                            label="Email Address"
                            :error-messages="resetError"
                        ></v-text-field>
                    </v-form>
                </v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn variant="text" color="on-primary" @click="resetOpen = false">{{
                        resetDone ? "Close" : "Cancel"
                    }}</v-btn>
                    <v-btn v-if="!resetDone" color="on-primary" variant="flat" :loading="resetLoading" @click="sendReset">
                        Email me a new password
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </v-container>
</template>

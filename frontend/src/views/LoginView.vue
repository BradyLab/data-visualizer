<script setup lang="ts">
// Login page view: email and password form; logs in through the auth store and goes to the home page
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@src/stores/auth";
import { UserStatus } from "@commons/user";

const auth = useAuthStore();
const router = useRouter();

// Form field values
const email = ref("");
const password = ref("");

// Whether the password is shown as plain text (toggled by the eye icon)
const showPass = ref(false);

// Submits the credentials; on success goes to the home page (invited users go to settings to set a password), otherwise the store's error is shown
const submit = async () => {
    if (!(await auth.login(email.value, password.value))) return;
    await router.push(auth.user.status === UserStatus.INVITED ? "/settings" : "/home");
};

// Already logged in: skip the login page
onMounted(() => {
    if (auth.isLoggedIn) router.push(auth.user.status === UserStatus.INVITED ? "/settings" : "/home");
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

            <v-form @submit.prevent="submit">
                <!-- Email input -->
                <v-row class="mt-2 mb-0" cols="12">
                    <v-col>
                        <div class="text-body-medium">Email Address</div>
                        <v-text-field
                            v-model="email"
                            type="email"
                            autocomplete="username"
                            prepend-inner-icon="mdi-email-outline"
                            label="Email Address"
                            single-line
                            clearable
                        ></v-text-field>
                    </v-col>
                </v-row>
                <!-- Password input with show/hide toggle -->
                <v-row class="my-0" cols="12">
                    <v-col>
                        <div class="text-body-medium">Password</div>
                        <v-text-field
                            v-model="password"
                            autocomplete="current-password"
                            prepend-inner-icon="mdi-lock-outline"
                            :append-inner-icon="showPass ? 'mdi-eye-outline' : 'mdi-eye-off-outline'"
                            :type="showPass ? 'text' : 'password'"
                            @click:append-inner="showPass = !showPass"
                            label="Password"
                            single-line
                            clearable
                        ></v-text-field>
                    </v-col>
                </v-row>

                <!-- Submit button and account note -->
                <v-alert v-if="auth.error" type="error" variant="tonal" density="compact" class="mb-3">
                    {{ auth.error }}
                </v-alert>
                <v-btn type="submit" color="primary" block class="mb-3" :loading="auth.loading" :disabled="!email || !password">
                    Log In
                </v-btn>
            </v-form>

            <v-row class="justify-center text-label-medium">Need an account? Reach out to the Brady Lab!</v-row>
        </v-card>
    </v-container>
</template>

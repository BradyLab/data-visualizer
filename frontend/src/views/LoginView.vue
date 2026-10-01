<script setup lang="ts">
// Login page view: email and password form (UI only; no authentication yet)
import { ref } from "vue";

// Whether the password is shown as plain text (toggled by the eye icon)
const showPass = ref(false);
</script>

<template>
    <!-- Login form UI; not connected to authentication yet -->
    <v-container class="d-flex justify-center" style="padding-top: 64px">
        <v-card class="pa-8" max-width="490" width="100%" variant="outlined" rounded="lg">
            <!-- Logo -->
            <v-row class="d-flex justify-center mb-6">
                <img src="@src/assets/BradyLabNewLogo.png" alt="Brady Lab logo" width="180" />
            </v-row>

            <!-- Email input -->
            <v-row class="mt-2 mb-0" cols="12">
                <v-col>
                    <div class="text-body-medium">Email Address</div>
                    <v-text-field
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
            <v-btn color="primary" block class="mb-3">Log In</v-btn>
            <v-row class="justify-center text-label-medium">Need an account? Reach out to the Brady Lab!</v-row>
        </v-card>
    </v-container>
</template>

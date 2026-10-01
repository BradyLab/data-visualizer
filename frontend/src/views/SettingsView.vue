<script setup lang="ts">
// Settings page view: new dataset / change password actions and per-dataset visibility controls (UI only for now)
// Placeholder dataset list (to be replaced by backend data)
import { datasets } from "@src/interfaces/datasetTest";
import { useRouter } from "vue-router";
import { onMounted } from "vue";
import { useAuthStore } from "@src/stores/auth";

// Router instance used for programmatic navigation
const router = useRouter();

// Auth store, used to check login state
const auth = useAuthStore();

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
}

// Settings requires a login; guests are redirected home
onMounted(() => {
    if (!auth.isLoggedIn) navTo("/home");
});
</script>

<template>
    <v-container class="px-12">
        <h1 class="text-h6 font-weight-bold mb-4">SETTINGS</h1>

        <!-- Account-level actions -->
        <v-row class="mb-6 mx-4">
            <v-col cols="auto">
                <v-btn color="primary" prepend-icon="mdi-plus" @click="navTo('/new')">New Dataset</v-btn>
            </v-col>
            <v-col cols="auto">
                <v-btn color="primary">Change Password</v-btn>
            </v-col>
        </v-row>

        <!-- One row per dataset: name (links to the dataset), private/public switch, and edit button -->
        <v-row v-for="dataset in datasets" align="center" class="mx-4">
            <v-col @click="navTo('/dataset/' + dataset.url)">{{ dataset.name }}</v-col>
            <v-col cols="auto" class="d-flex align-center">
                <span class="mr-2">Private</span>
                <v-switch :model-value="false" color="primary" density="compact" inset hide-details></v-switch>
                <span class="ml-2">Public</span>
            </v-col>
            <v-col cols="auto">
                <v-btn prepend-icon="mdi-pencil-outline">Edit Dataset</v-btn>
            </v-col>
        </v-row>
    </v-container>
</template>

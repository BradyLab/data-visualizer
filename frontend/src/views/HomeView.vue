<script setup lang="ts">
// Home page view: lists all datasets as clickable cards
// Placeholder dataset list (to be replaced by backend data)
import { datasets } from "../interfaces/datasetTest";
import { useRouter } from "vue-router";
import { useAuthStore } from "@src/stores/auth";

// Router instance used for programmatic navigation
const router = useRouter();

const auth = useAuthStore();

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <!-- Landing page: grid of dataset cards -->
    <v-container class="py-6">
        <!-- Welcome {{ auth.user.name }} -->
        <h1 class="text-h6 font-weight-bold mb-4">BRADY LAB DATASETS</h1>
        <v-row>
            <!-- One card per dataset; clicking opens the dataset page -->
            <v-col v-for="dataset in datasets" cols="3">
                <v-card @click="navTo('/dataset/' + dataset.url)">
                    <!-- Placeholder for the dataset's cover image -->
                    <div class="dataset-thumb"></div>
                    <v-card-item>
                        <v-card-title class="text-body-2 font-weight-bold">{{ dataset.name }}</v-card-title>
                        <v-card-subtitle>[description here]</v-card-subtitle>
                    </v-card-item>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

/* Temporary thumbnail block filled with the theme's primary color */
<style scoped>
.dataset-thumb {
    height: 110px;
    background-color: rgb(var(--v-theme-primary));
}
</style>

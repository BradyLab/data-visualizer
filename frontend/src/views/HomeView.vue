<script setup lang="ts">
// Home page view: lists all datasets as clickable cards
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";

// Router instance used for programmatic navigation
const router = useRouter();

// Auth store (only referenced by the commented-out welcome message in the template)
const auth = useAuthStore();

// Dataset store, loaded when the page opens so new or edited datasets show up
const datasetStore = useDatasetStore();
onMounted(() => {
    // If the request fails the grid is simply empty
    datasetStore.fetchDatasets().catch(() => {});
});

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
            <!-- The url slug is the unique key and the route param -->
            <v-col v-for="dataset in datasetStore.datasets" :key="dataset.url">
                <v-card @click="navTo('/dataset/' + dataset.url)">
                    <!-- Placeholder for the dataset's cover image -->
                    <div class="dataset-thumb"></div>
                    <v-card-item>
                        <v-card-title class="text-body-2 font-weight-bold">{{ dataset.name }}</v-card-title>
                        <v-card-subtitle>{{ dataset.description }}</v-card-subtitle>
                    </v-card-item>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped>
/* Temporary thumbnail block filled with the theme's primary color */
.dataset-thumb {
    height: 110px;
    background-color: rgb(var(--v-theme-primary));
}
</style>

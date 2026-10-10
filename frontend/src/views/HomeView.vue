<script setup lang="ts">
// Home page view: lists all datasets as clickable cards
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import DatasetCover from "@src/components/DatasetCover.vue";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { DatasetVisibility } from "@commons/dataset";

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
        <v-row class="align-center mt-5">
            <h1 class="text-h6 font-weight-bold my-0">BRADY LAB DATASETS</h1>
            <v-spacer />
            <v-btn v-if="auth.canCreateDatasets" class="align-center" @click="navTo('/dataset/new')">
                <template #prepend><v-icon>mdi-plus</v-icon></template>
                New Dataset
            </v-btn>
        </v-row>

        <v-row>
            <!-- One card per dataset; clicking opens the dataset page -->
            <!-- The url slug is the unique key and the route param -->
            <v-col cols="6" class="d-flex" v-for="dataset in datasetStore.datasets" :key="dataset.url">
                <v-card class="flex-grow-1 d-flex flex-column" @click="navTo('/dataset/' + dataset.url)">
                    <!-- Cover image, or a color block when the dataset has none -->
                    <DatasetCover :dataset-id="dataset.id" :height="110" />
                    <v-card-item>
                        <v-card-title class="text-body-2 font-weight-bold">{{ dataset.name }}</v-card-title>
                        <v-card-subtitle>
                            <div>Author: {{ dataset.ownerName ?? dataset.owner }}</div>
                            <div v-if="dataset.visibility === DatasetVisibility.PUBLIC">Attribution: {{ dataset.attribution }}</div>
                        </v-card-subtitle>
                        <v-card-text v-if="dataset.description" class="px-0 py-2">{{ dataset.description }}</v-card-text>
                        
                    </v-card-item>
                </v-card>
            </v-col>
        </v-row>
    </v-container>
</template>

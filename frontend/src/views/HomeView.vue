<script setup lang="ts">
import { datasets } from "../interfaces/datasetTest";
import { useRouter } from "vue-router";

const router = useRouter();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-container class="py-6">
        <h1 class="text-h6 font-weight-bold mb-4">BRADY LAB DATASETS</h1>
        <v-row>
            <v-col v-for="dataset in datasets" cols="3">
                <v-card @click="navTo('/dataset/' + dataset.url)">
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

<style scoped>
.dataset-thumb {
    height: 110px;
    background-color: rgb(var(--v-theme-primary));
}
</style>

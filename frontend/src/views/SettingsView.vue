<script setup lang="ts">
import { datasets } from "@src/interfaces/datasetTest";
import { useRouter } from "vue-router";

const router = useRouter();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-container class="px-12">
        <h1 class="text-h6 font-weight-bold mb-4">SETTINGS</h1>

        <v-row class="mb-6 mx-4">
            <v-col cols="auto">
                <v-btn color="primary" prepend-icon="mdi-plus" @click="navTo('/new')">New Dataset</v-btn>
            </v-col>
            <v-col cols="auto">
                <v-btn color="primary">Change Password</v-btn>
            </v-col>
        </v-row>

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

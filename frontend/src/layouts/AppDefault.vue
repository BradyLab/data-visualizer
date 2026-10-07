<script setup lang="ts">
// Main page layout: header on top, routed view in the middle, footer at the bottom
import Header from "@src/layouts/AppHeader.vue";
import Footer from "@src/layouts/AppFooter.vue";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";

const auth = useAuthStore();
const datasetStore = useDatasetStore();

// Tries the dataset list again; a failure shows up in datasetStore.loadFailed, so the rejection is ignored
const retryDatasets = () => datasetStore.fetchDatasets().catch(() => {});

// Retries the session restore by reloading the page
const reload = () => window.location.reload();
</script>

<template>
    <!-- Top navigation bar -->
    <Header></Header>
    <!-- Current page is rendered by the router here -->
    <v-main id="main">
        <!-- Shown when the saved login could not be restored (server unreachable); the token is kept, so reloading retries -->
        <v-alert v-if="auth.restoreFailed" type="warning" variant="tonal" class="ma-4" prominent>
            We couldn't restore your session because the server didn't respond properly. You may appear logged out.
            <template v-slot:append>
                <v-btn variant="outlined" @click="reload">Reload</v-btn>
            </template>
        </v-alert>
        <!-- Shown when the dataset list could not be loaded, since the DATASETS menu would otherwise just look empty -->
        <v-alert v-if="datasetStore.loadFailed" type="warning" variant="tonal" class="ma-4" prominent>
            We couldn't load the datasets, so the DATASETS menu may be empty or out of date.
            <template v-slot:append>
                <v-btn variant="outlined" @click="retryDatasets">Retry</v-btn>
            </template>
        </v-alert>
        <router-view />
    </v-main>
    <!-- Footer (hidden on routes with meta.hideFooter) -->
    <Footer></Footer>
</template>

<style scoped></style>

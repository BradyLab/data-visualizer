<script setup lang="ts">
// Root component: wraps the page layout in Vuetify's v-app
import { onMounted, watch } from "vue";
import Default from "@src/layouts/Default.vue";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";

// What a viewer may see depends on who they are, so when they log in or out (the user id changes) drop the
// permissions loaded for the previous viewer and reload the dataset list. Otherwise private datasets would stay
// visible after logging out, and a new login would keep showing the guest's list
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();
watch(
    () => auth.user.id,
    () => {
        permissionStore.clear();
        datasetStore.fetchDatasets().catch(() => {});
    }
);

onMounted(() => {
    permissionStore.clear();
    datasetStore.fetchDatasets().catch(() => {});
})
</script>

<template>
    <!-- v-app is required by Vuetify for theming and layout -->
    <v-app>
        <!-- Default layout contains the header, routed page content, and footer -->
        <Default></Default>
    </v-app>
</template>

<style scoped></style>

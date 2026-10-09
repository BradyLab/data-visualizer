<script setup lang="ts">
// Root component: wraps the page layout in Vuetify's v-app
import { onMounted, watch } from "vue";
import { useRouter } from "vue-router";
import AppDefault from "@src/layouts/AppDefault.vue";
import { useAuthStore } from "@src/stores/auth";
import { useFileStore } from "@src/stores/file";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { useSocketStore } from "@src/stores/socket";
import { useUserStore } from "@src/stores/user";

// What a viewer may see depends on who they are, so when they log in or out (the user id changes) drop the
// permissions and cover images loaded for the previous viewer and reload the dataset list. Otherwise private datasets would stay
// visible after logging out, and a new login would keep showing the guest's list
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();
const fileStore = useFileStore();
const router = useRouter();
// Creating the socket store opens the websocket while logged in (it follows the login token itself)
useSocketStore();
// The user store subscribes to the user events when it is created, and the viewer's own role, name or status changing live
// (and the end of their session) must be heard on every page, not only on the pages that happen to use the store
useUserStore();
watch(
    () => auth.user.id,
    () => {
        permissionStore.clear();
        fileStore.clear();
        datasetStore.fetchDatasets().catch(() => {});
    }
);

// An admin changing the viewer's role changes what they may see without a new login (the user store replaces the logged-in user on
// the pushed update): reload the permissions and the dataset list, and leave a page the new role may not open
watch([() => auth.user.id, () => auth.user.role], ([id], [previousId]) => {
    // A login or logout also changes the role, but the watch above already reloads everything for those
    if (id !== previousId || !auth.isLoggedIn) return;
    permissionStore.fetchMine(auth.user.id).catch(() => {});
    datasetStore.fetchDatasets().catch(() => {});
    const meta = router.currentRoute.value.meta;
    if ((meta.requiresAdmin && !auth.isAdmin) || (meta.requiresDatasetCreator && !auth.canCreateDatasets))
        router.push({ name: "home" });
});

// Initial load: the watch above only fires when the user changes, so load the dataset list once on startup
// A failed load is reported by the alert in the Default layout (datasetStore.loadFailed), so the rejection is ignored here and in the watch above
onMounted(() => {
    permissionStore.clear();
    datasetStore.fetchDatasets().catch(() => {});
});
</script>

<template>
    <!-- v-app is required by Vuetify for theming and layout -->
    <v-app>
        <!-- Default layout contains the header, routed page content, and footer -->
        <AppDefault></AppDefault>
    </v-app>
</template>

<style scoped></style>

<script setup lang="ts">
// Top app bar: logo, DATASETS menu, HELP/ABOUT/FEEDBACK links, and account menu
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";

// Router instance used for programmatic navigation
const router = useRouter();

// Auth store, used to switch the account menu items between logged in / out
const auth = useAuthStore();

// Dataset store, which populates the DATASETS menu
const datasetStore = useDatasetStore();
onMounted(() => {
    // If the request fails the menu is simply empty
    datasetStore.fetchDatasets().catch(() => {});
});

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
}

// Clears the session and sends the user back to the home page
async function logout() {
    await auth.logout();
    navTo("/home");
}
</script>

<template>
    <v-app-bar scroll-behavior="hide" app>
        <!-- Logo at the left of the app bar -->
        <template v-slot:prepend>
            <BradyLabLogo />
        </template>
        <!-- Navigation items -->
        <v-row class="align-center ml-2">
            <v-col cols="auto">
                <!-- Dropdown of datasets that opens on hover; each item links to its dataset page -->
                <v-menu open-on-hover open-on-click>
                    <template v-slot:activator="{ props }">
                        <div v-bind="props">DATASETS <v-icon>mdi-chevron-down</v-icon></div>
                    </template>

                    <v-list>
                        <v-list-item v-for="dataset in datasetStore.datasets" :key="dataset.url" @click="navTo('/dataset/' + dataset.url)">
                            {{ dataset.name }}
                        </v-list-item>
                    </v-list>
                </v-menu>
            </v-col>
            <v-col cols="auto"> | </v-col>
            <v-col cols="auto">
                <!-- Link to the help document (opens in a new tab) -->
                <a
                    href="https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.h5arv6ibis4c"
                    target="_blank"
                    :class="{ 'text-decoration-none': true }"
                    class="text-text"
                >
                    HELP
                </a>
            </v-col>
            <!-- ABOUT and FEEDBACK links shared with the footer -->
            <LayoutHelper />
        </v-row>

        <!-- Account menu at the right of the app bar -->
        <template v-slot:append>
            <v-menu open-on-hover>
                <template v-slot:activator="{ props }">
                    <div v-bind="props">
                        <v-icon>mdi-dots-vertical</v-icon>
                    </div>
                </template>

                <v-list>
                    <v-list-item v-if="!auth.isLoggedIn" @click="navTo('/login')"> LOG IN </v-list-item>
                    <v-list-item v-if="auth.isLoggedIn" @click="navTo('/settings')"> SETTINGS </v-list-item>
                    <v-list-item v-if="auth.isLoggedIn" @click="logout()"> LOG OUT </v-list-item>
                </v-list>
            </v-menu>
        </template>
    </v-app-bar>
</template>

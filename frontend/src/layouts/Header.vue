<script setup lang="ts">
// Top app bar: logo, DATASETS menu, HELP/ABOUT/FEEDBACK links, and account menu
import { useRouter } from "vue-router";
// Placeholder dataset list that populates the DATASETS menu
import { datasets } from "../interfaces/datasetTest";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";

// Router instance used for programmatic navigation
const router = useRouter();

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
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
                <v-menu open-on-hover>
                    <template v-slot:activator="{ props }">
                        <div v-bind="props">DATASETS <v-icon>mdi-chevron-down</v-icon></div>
                    </template>

                    <v-list>
                        <v-list-item v-for="dataset in datasets" @click="navTo('/dataset/' + dataset.url)">
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

                <!--    TODO: add bradylab signin/signup -->
                <v-list>
                    <v-list-item @click="navTo('/login')"> LOG IN </v-list-item>
                    <v-list-item @click="navTo('/settings')"> SETTINGS </v-list-item>
                    <!-- TODO Log out is not implemented yet -->
                    <v-list-item> LOG OUT </v-list-item>
                </v-list>
            </v-menu>
        </template>
    </v-app-bar>
</template>

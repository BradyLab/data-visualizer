<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { datasets } from "../interfaces/datasetTest";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";

const router = useRouter();
const route = useRoute();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-app-bar scroll-behavior="hide" app>
        <template v-slot:prepend>
            <BradyLabLogo/>
        </template>
        <v-row class="align-center ml-2">
            <v-col cols="auto">
                <v-menu open-on-hover>
                    <template v-slot:activator="{ props }">
                        <div v-bind="props">
                            DATASETS <v-icon>mdi-chevron-down</v-icon>
                        </div>
                    </template>

                    <v-list>
                        <v-list-item v-for="dataset in datasets" @click="navTo('/dataset/' + dataset.url)">
                            {{ dataset.name }}
                        </v-list-item>
                    </v-list>
                </v-menu>
            </v-col>
            <v-col cols="auto">
                |
            </v-col>
            <v-col cols="auto">
                <a 
                    href="https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.0#heading=h.pfplectqnb9t" 
                    target="_blank"
                    :class="{ 'text-decoration-none': true }"
                    class="text-text"
                >
                    HELP
                </a>
            </v-col>
            <LayoutHelper/>
            
        </v-row>

        <template v-slot:append>
            <v-menu open-on-hover>
                    <template v-slot:activator="{ props }">
                        <div v-bind="props">
                            <v-icon>mdi-dots-vertical</v-icon>
                        </div>
                    </template>

                    <!--    TODO: add bradylab signin/signup -->
                    <v-list>
                        <v-list-item @click="navTo('/login')">
                            LOG IN
                        </v-list-item>
                        <v-list-item @click="navTo('/settings')">
                            SETTINGS
                        </v-list-item>
                        <v-list-item>
                            LOG OUT
                        </v-list-item>
                    </v-list>
                </v-menu>
            
        </template>
    </v-app-bar>
</template>
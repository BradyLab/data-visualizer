<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";
// import { sports } from "@src/interfaces/sportsInfo";

const router = useRouter();
const route = useRoute();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-footer class="pa-0 pl-1" v-if="!route.meta.hideFooter">
        <v-container fluid class="pa-0">
            <v-row class="align-center">
                <BradyLabLogo/>
                <v-col cols="auto" class="ml-n4">
                    <a 
                        href="https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.h5arv6ibis4c" 
                        target="_blank"
                        :class="{ 'text-decoration-none': true }"
                        class="text-text"
                    >
                        HELP
                    </a>
                </v-col>
                <LayoutHelper/>
            </v-row>
        </v-container>
    </v-footer>
</template>

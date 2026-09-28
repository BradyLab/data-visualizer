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
    <v-footer class="pa-0 pl-1">
        <v-container fluid class="pa-0">
            <v-row class="align-center">
                <v-col class="cursor-pointer pa-0" cols="auto" @click="navTo('/home')">
                    <img alt="Brady Lab logo" class="logo" src="@src/assets/BradyLabNewLogo.png" width="100" height="59"/>
                </v-col>
                <v-col cols="auto" class="ml-n4">
                    HELP
                </v-col>
                <v-col cols="auto">
                    |
                </v-col>
                <v-col cols="auto">
                    ABOUT
                </v-col>
                <v-col cols="auto">
                    |
                </v-col>
                <v-col cols="auto">
                    FEEDBACK
                </v-col>
            </v-row>
        </v-container>
    </v-footer>
</template>

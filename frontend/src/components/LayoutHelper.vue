<script setup lang="ts">
import { useRouter } from "vue-router";

const router = useRouter();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-col cols="auto">
        |
    </v-col>
    <v-col cols="auto" @click="navTo('/about')">
        ABOUT
    </v-col>
    <v-col cols="auto">
        |
    </v-col>
    <v-col cols="auto">
        FEEDBACK
    </v-col>
</template>
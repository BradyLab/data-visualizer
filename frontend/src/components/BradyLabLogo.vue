<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";

const router = useRouter();

function navTo(route: string) {
    router.push(route);
}
</script>

<template>
    <v-col cols="auto" class="cursor-pointer" @click="navTo('/home')">
        <img alt="Brady Lab logo" class="logo" src="@src/assets/BradyLabNewLogo.png" width="100" height="59"/>
    </v-col>
</template>
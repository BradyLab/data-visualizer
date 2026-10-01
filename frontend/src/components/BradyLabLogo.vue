<script setup lang="ts">
// Brady Lab logo that returns the user to the home page when clicked
import { useRouter } from "vue-router";

const router = useRouter();
</script>

<template>
    <v-col cols="auto" class="cursor-pointer mt-2" @click="router.push('/home')">
        <img alt="Brady Lab logo" class="logo" src="@src/assets/BradyLabNewLogo.png" width="100" height="58" />
    </v-col>
</template>

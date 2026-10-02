<script setup lang="ts">
// Shared navigation items (ABOUT, FEEDBACK) used in both the header and the footer
import { useRouter } from "vue-router";

const router = useRouter();

// Navigate to the given route path
function navTo(route: string) {
    router.push(route);
}
</script>

<!-- Renders columns so it can be dropped inside a v-row; separators are plain text pipes -->
<template>
    <v-col cols="auto"> | </v-col>
    <v-col cols="auto" class="cursor-pointer"> 
        <RouterLink to="/about" class="text-text" :class="{ 'text-decoration-none': true }">ABOUT</RouterLink> 
    </v-col>
    <v-col cols="auto"> | </v-col>
    <!-- TODO FEEDBACK does not link anywhere yet, make similar to about -->
    <v-col cols="auto"> FEEDBACK </v-col>
</template>

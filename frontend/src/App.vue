<script setup lang="ts">
// Root component: wraps the page layout in Vuetify's v-app
import Default from "./layouts/Default.vue";
</script>

<template>
    <!-- v-app is required by Vuetify for theming and layout -->
    <v-app>
        <!-- Default layout contains the header, routed page content, and footer -->
        <Default></Default>
    </v-app>
</template>

<style scoped></style>

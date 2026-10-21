<script setup lang="ts">
// 404 page view, shown for any URL that matches no route (no logic)
</script>

<!-- Tells the visitor the page doesn't exist and links back to the home page -->
<template>
    <v-container class="text-center py-16">
        <h1 class="text-h2 mb-4">404</h1>
        <p class="text-h6 mb-6">Page not found</p>
        <v-btn color="primary" :to="{ name: 'home' }">Back to home</v-btn>
    </v-container>
</template>

<style scoped></style>

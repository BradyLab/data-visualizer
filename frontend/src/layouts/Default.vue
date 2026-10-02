<script setup lang="ts">
// Main page layout: header on top, routed view in the middle, footer at the bottom
import Header from "@src/layouts/Header.vue";
import Footer from "@src/layouts/Footer.vue";
</script>

<template>
    <!-- Top navigation bar -->
    <Header></Header>
    <!-- Current page is rendered by the router here -->
    <v-main id="main">
        <router-view />
    </v-main>
    <!-- Footer (hidden on routes with meta.hideFooter) -->
    <Footer></Footer>
</template>

<style scoped></style>

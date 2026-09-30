<script setup lang="ts">
import Header from "./Header.vue";
import Footer from "./Footer.vue";
</script>

<template>
    <Header></Header>
    <v-main id="main">
        <router-view />
    </v-main>
    <Footer></Footer>
</template>

<style scoped></style>

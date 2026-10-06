<script setup lang="ts">
// Main page layout: header on top, routed view in the middle, footer at the bottom
import Header from "@src/layouts/Header.vue";
import Footer from "@src/layouts/Footer.vue";
import { useAuthStore } from "@src/stores/auth";

const auth = useAuthStore();

// Retries the session restore by reloading the page
const reload = () => window.location.reload();
</script>

<template>
    <!-- Top navigation bar -->
    <Header></Header>
    <!-- Current page is rendered by the router here -->
    <v-main id="main">
        <!-- Shown when the saved login could not be restored (server unreachable); the token is kept, so reloading retries -->
        <v-alert v-if="auth.restoreFailed" type="warning" variant="tonal" class="ma-4" prominent>
            We couldn't restore your session because the server didn't respond properly. You may appear logged out.
            <template v-slot:append>
                <v-btn variant="outlined" @click="reload">Reload</v-btn>
            </template>
        </v-alert>
        <router-view />
    </v-main>
    <!-- Footer (hidden on routes with meta.hideFooter) -->
    <Footer></Footer>
</template>

<style scoped></style>

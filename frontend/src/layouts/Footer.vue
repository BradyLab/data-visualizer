<script setup lang="ts">
// Page footer: logo and HELP/ABOUT/FEEDBACK links; hidden on routes with meta.hideFooter
import { useRoute } from "vue-router";
import BradyLabLogo from "@src/components/BradyLabLogo.vue";
import LayoutHelper from "@src/components/LayoutHelper.vue";

// Current route, used to read meta.hideFooter
const route = useRoute();
</script>

<template>
    <!-- Footer is only rendered when the current route does not hide it -->
    <v-footer class="pa-0 pl-1" style="min-height: unset; height: auto" v-if="!route.meta.hideFooter">
        <v-container fluid class="pa-0">
            <v-row class="align-center">
                <!-- Logo (links to home) -->
                <BradyLabLogo />
                <v-col cols="auto" class="ml-n4">
                    <!-- Link to the help document (opens in a new tab) -->
                    <a
                        href="https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.h5arv6ibis4c"
                        target="_blank"
                        :class="{ 'text-decoration-none': true }"
                        class="text-text"
                    >
                        HELP
                    </a>
                </v-col>
                <!-- ABOUT and FEEDBACK links shared with the header -->
                <LayoutHelper />
            </v-row>
        </v-container>
    </v-footer>
</template>

<style scoped>
/* Keep the footer at its natural height instead of growing in a flex layout */
.v-footer {
    flex: 0 0 auto;
}
</style>

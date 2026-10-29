<script setup lang="ts">
// Brady Lab logo that returns the user to the home page when clicked
</script>

<template>
    <!-- A real link, so it can be reached and activated with the keyboard; its name is where it goes -->
    <v-col cols="auto" class="mt-2">
        <RouterLink to="/home" class="d-inline-block">
            <img alt="Brady Lab, home" class="logo" src="@src/assets/BradyLabNewLogo.png" width="100" height="58" />
        </RouterLink>
    </v-col>
</template>

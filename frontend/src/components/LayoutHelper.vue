<script setup lang="ts"></script>

<!-- Renders columns so it can be dropped inside a v-row; separators are plain text pipes -->
<template>
    <v-col cols="auto" aria-hidden="true"> | </v-col>
    <v-col cols="auto">
        <RouterLink to="/about" class="text-text text-decoration-none">ABOUT</RouterLink>
    </v-col>
    <v-col cols="auto" aria-hidden="true"> | </v-col>
    <!-- TODO FEEDBACK does not link anywhere yet, make similar to about -->
    <v-col cols="auto"> FEEDBACK </v-col>
</template>

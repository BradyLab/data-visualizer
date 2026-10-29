<script setup lang="ts"></script>

<!-- Renders columns so it can be dropped inside a v-row; separators are plain text pipes -->
<template>
    <v-col cols="auto" aria-hidden="true"> | </v-col>
    <v-col cols="auto">
        <RouterLink to="/about" class="text-text text-decoration-none">ABOUT</RouterLink>
    </v-col>
</template>

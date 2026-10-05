<script setup lang="ts"></script>

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

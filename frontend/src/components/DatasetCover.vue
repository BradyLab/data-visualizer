<script setup lang="ts">
// A dataset's cover image, cached in the file store (so it is fetched with the login header and covers of private datasets work).
// Datasets without a cover, or whose cover fails to load, show a block in the theme's primary color instead
import { computed, watch } from "vue";
import { useFileStore } from "@src/stores/file";

const props = defineProps<{ datasetId: string; height: number }>();
const fileStore = useFileStore();

// undefined until loaded, null when the dataset has no cover
const src = computed(() => fileStore.covers[props.datasetId]);

// Asks for the cover when the dataset changes, and again when the cached one was dropped (a new upload, or a login change)
// A failed request is ignored: the fallback block stays
watch(
    [() => props.datasetId, src],
    () => {
        if (src.value === undefined) fileStore.loadCover(props.datasetId).catch(() => {});
    },
    { immediate: true }
);
</script>

<template>
    <v-img v-if="src" :src="src" :height="height" cover></v-img>
    <div v-else class="cover-fallback" :style="{ height: `${height}px` }"></div>
</template>

<style scoped>
/* Shown while the cover loads and for datasets without one */
.cover-fallback {
    background-color: rgb(var(--v-theme-primary));
}
</style>

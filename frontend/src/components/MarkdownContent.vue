<script setup lang="ts">
// Shows Markdown text as formatted, sanitized HTML (see utils/markdown.ts)
import { computed } from "vue";
import { renderMarkdown } from "@src/utils/markdown";

const props = defineProps<{ source: string }>();
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
    <!-- The HTML is sanitized by renderMarkdown, so it is safe to insert -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="markdown-body" v-html="html"></div>
</template>

<style scoped>
/* Vuetify's reset removes the browser's default heading, list and link styling, so the rendered text brings its own */
.markdown-body {
    line-height: 1.6;
    overflow-wrap: anywhere;
}
.markdown-body :deep(h2) {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 1.5rem 0 0.75rem;
}
.markdown-body :deep(h3) {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 1.25rem 0 0.5rem;
}
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
    font-size: 1rem;
    font-weight: 700;
    margin: 1rem 0 0.5rem;
}
.markdown-body :deep(p),
.markdown-body :deep(ul),
.markdown-body :deep(ol),
.markdown-body :deep(blockquote),
.markdown-body :deep(pre),
.markdown-body :deep(table) {
    margin: 0 0 1rem;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
    padding-left: 1.5rem;
}
.markdown-body :deep(a) {
    color: rgb(var(--v-theme-primary));
    text-decoration: underline;
}
.markdown-body :deep(blockquote) {
    border-left: 4px solid rgba(var(--v-theme-primary), 0.4);
    padding-left: 1rem;
}
.markdown-body :deep(code) {
    background: rgba(var(--v-theme-primary), 0.08);
    border-radius: 4px;
    padding: 0 0.25rem;
}
.markdown-body :deep(pre) {
    background: rgba(var(--v-theme-primary), 0.08);
    border-radius: 8px;
    padding: 0.75rem;
    overflow-x: auto;
}
.markdown-body :deep(pre code) {
    background: none;
    padding: 0;
}
.markdown-body :deep(img) {
    max-width: 100%;
    height: auto;
}
.markdown-body :deep(table) {
    border-collapse: collapse;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
    border: 1px solid rgba(var(--v-theme-primary), 0.4);
    padding: 0.25rem 0.75rem;
    text-align: left;
}
</style>

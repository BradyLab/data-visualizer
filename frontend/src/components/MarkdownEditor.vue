<script setup lang="ts">
// Markdown editor: a text box with a row of formatting buttons, and a live preview of the result next to it (below it on narrow screens)
import { nextTick } from "vue";
import { MAX_PAGE_LENGTH } from "@commons/page";
import MarkdownContent from "@src/components/MarkdownContent.vue";

// v-model is the Markdown text; label names the text box
const text = defineModel<string>({ default: "" });
const props = defineProps<{ label: string }>();

// Ids that tie the buttons and the preview to the text box
const TEXTAREA_ID = "markdown-editor-text";
const PREVIEW_ID = "markdown-editor-preview";

// The text box element (Vuetify renders the real <textarea> inside v-textarea)
const textarea = () => document.getElementById(TEXTAREA_ID) as HTMLTextAreaElement | null;

// Replaces the selected text with before + selection + after (or before + placeholder + after when nothing is selected), then selects the
// text between them so typing carries on from there
async function wrap(before: string, after: string, placeholder: string) {
    const el = textarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = text.value.slice(start, end) || placeholder;
    text.value = text.value.slice(0, start) + before + selected + after + text.value.slice(end);
    await nextTick();
    el.focus();
    el.setSelectionRange(start + before.length, start + before.length + selected.length);
}

// Puts the prefix at the start of every selected line (or of the current line when nothing is selected)
async function prefixLines(prefix: string) {
    const el = textarea();
    if (!el) return;
    const lineStart = text.value.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const block = text.value.slice(lineStart, el.selectionEnd);
    const changed = block
        .split("\n")
        .map((line) => prefix + line)
        .join("\n");
    text.value = text.value.slice(0, lineStart) + changed + text.value.slice(el.selectionEnd);
    await nextTick();
    el.focus();
    el.setSelectionRange(lineStart, lineStart + changed.length);
}

// Formatting buttons, in toolbar order
const actions = [
    { label: "Bold", icon: "mdi-format-bold", run: () => wrap("**", "**", "bold text") },
    { label: "Italic", icon: "mdi-format-italic", run: () => wrap("_", "_", "italic text") },
    { label: "Heading", icon: "mdi-format-header-pound", run: () => prefixLines("## ") },
    { label: "Link", icon: "mdi-link-variant", run: () => wrap("[", "](https://)", "link text") },
    { label: "Bulleted list", icon: "mdi-format-list-bulleted", run: () => prefixLines("- ") },
    { label: "Numbered list", icon: "mdi-format-list-numbered", run: () => prefixLines("1. ") },
];

// Moves focus into the text box (the page calls this when editing starts)
defineExpose({ focus: () => textarea()?.focus() });
</script>

<template>
    <v-row>
        <v-col cols="12" md="6">
            <div role="toolbar" aria-label="Formatting" :aria-controls="TEXTAREA_ID" class="d-flex flex-wrap ga-1 mb-2">
                <v-btn
                    v-for="action in actions"
                    :key="action.label"
                    :icon="action.icon"
                    :aria-label="action.label"
                    :title="action.label"
                    variant="tonal"
                    size="small"
                    @click="action.run"
                ></v-btn>
            </div>
            <v-textarea
                v-model="text"
                :id="TEXTAREA_ID"
                :label="props.label"
                :maxlength="MAX_PAGE_LENGTH"
                :counter="MAX_PAGE_LENGTH"
                :aria-controls="PREVIEW_ID"
                hint="Markdown: # for a section heading, ** for bold, - for a list. Leave it empty to restore the default text."
                persistent-hint
                rows="16"
                auto-grow
                :clearable="false"
            ></v-textarea>
        </v-col>
        <v-col cols="12" md="6">
            <p :id="`${PREVIEW_ID}-title`" class="text-subtitle-2 font-weight-bold mb-2">Preview</p>
            <div :id="PREVIEW_ID" role="region" :aria-labelledby="`${PREVIEW_ID}-title`" class="preview pa-4">
                <MarkdownContent :source="text" />
            </div>
        </v-col>
    </v-row>
</template>

<style scoped>
.preview {
    border: 1px solid rgba(var(--v-theme-primary), 0.4);
    border-radius: 8px;
    min-height: 200px;
}
</style>

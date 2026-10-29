<script setup lang="ts">
// About page view: shows the page's Markdown text (a built-in text until one is saved); admins can edit it in a Markdown editor
import { nextTick, onMounted, ref } from "vue";
import { useAuthStore } from "@src/stores/auth";
import { pageApi } from "@src/api/page";
import MarkdownContent from "@src/components/MarkdownContent.vue";
import MarkdownEditor from "@src/components/MarkdownEditor.vue";
import { PageSlug } from "@commons/page";

const auth = useAuthStore();

// Shown until an admin saves their own text, and again if they save an empty one
const DEFAULT_ABOUT = `This site shows the Brady Lab's datasets as interactive plots. Pick a dataset from the home page to explore it.

## Contact

Questions about a dataset or an account? Reach out to the Brady Lab.`;

// The saved text ("" while the page was never saved), and whether it is still being loaded or could not be
const saved = ref("");
const loading = ref(true);
const loadFailed = ref(false);

// Editing state: the text in the editor, whether a save is in flight, what went wrong, and a note after a successful save
const editing = ref(false);
const draft = ref("");
const saving = ref(false);
const error = ref<string | null>(null);
const justSaved = ref(false);
const editor = ref<{ focus: () => void } | null>(null);

// Loads the saved text; if that fails the default text is shown with a warning, and editing is off so the admin cannot overwrite
// text they could not see
async function load() {
    loading.value = true;
    loadFailed.value = false;
    try {
        saved.value = (await pageApi.getPage(PageSlug.ABOUT)).content;
    } catch {
        loadFailed.value = true;
    } finally {
        loading.value = false;
    }
}
onMounted(load);

// Opens the editor with the saved text, and moves focus into it
async function startEditing() {
    draft.value = saved.value;
    error.value = null;
    justSaved.value = false;
    editing.value = true;
    await nextTick();
    editor.value?.focus();
}

// Closes the editor and puts focus back on the button that opened it, since that button was gone while editing
async function stopEditing() {
    editing.value = false;
    await nextTick();
    document.getElementById("edit-about")?.focus();
}

// Saves the draft and shows it; on failure the editor stays open with the draft intact
async function save() {
    saving.value = true;
    error.value = null;
    try {
        saved.value = (await pageApi.savePage(PageSlug.ABOUT, draft.value)).content;
        justSaved.value = true;
        await stopEditing();
    } catch {
        error.value = "Unable to save the page. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <v-container class="py-6 px-12">
        <div class="d-flex align-center mb-4">
            <h1 class="text-h6 font-weight-bold">ABOUT</h1>
            <v-spacer />
            <v-btn
                v-if="auth.isAdmin && !editing"
                id="edit-about"
                prepend-icon="mdi-pencil"
                :disabled="loading || loadFailed"
                @click="startEditing"
                >Edit</v-btn
            >
        </div>

        <v-alert v-if="loadFailed" type="warning" variant="tonal" class="mb-4">
            We couldn't load the latest version of this page.
            <template #append><v-btn variant="outlined" @click="load">Retry</v-btn></template>
        </v-alert>
        <v-alert v-if="justSaved" type="success" variant="tonal" closable class="mb-4" @click:close="justSaved = false">
            The About page was saved.
        </v-alert>

        <v-progress-circular v-if="loading" indeterminate aria-label="Loading the About page"></v-progress-circular>
        <form v-else-if="editing" @submit.prevent="save">
            <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
            <MarkdownEditor ref="editor" v-model="draft" label="About page text (Markdown)" />
            <div class="d-flex justify-end ga-2 mt-2">
                <v-btn :disabled="saving" @click="stopEditing">Cancel</v-btn>
                <v-btn type="submit" :loading="saving" variant="flat">Save</v-btn>
            </div>
        </form>
        <MarkdownContent v-else :source="saved || DEFAULT_ABOUT" />
    </v-container>
</template>

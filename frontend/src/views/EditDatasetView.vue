<script setup lang="ts">
// Create/edit dataset page: the same form is used for /new and /dataset/:datasetURL/edit (file uploads are not wired up yet)
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import { DatasetPlots, DatasetVisibility, type IDataset } from "@commons/dataset";
import { UserRoles, UserStatus } from "@commons/user";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { useUserStore } from "@src/stores/user";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const userStore = useUserStore();

// Edit mode when the route carries a dataset url slug; otherwise we are creating a new dataset
const editingUrl = computed(() => (route.params.datasetURL as string | undefined) ?? null);
const isEdit = computed(() => editingUrl.value !== null);

// Form state: a blank dataset while creating (id stays "" until the dataset is loaded in edit mode, or saved)
const dataset = ref<IDataset>({
    id: "",
    name: "",
    owner: auth.user.id,
    url: "",
    description: "",
    doi: "",
    rawDataLink: "",
    treatments: [],
    plots: [],
    // New datasets start private; visibility is changed from the settings page
    visibility: DatasetVisibility.PRIVATE,
    createdAt: new Date(),
    updatedAt: null,
});

const loading = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

// Owner choices: active admins and lab members, plus the dataset's current owner if they fall outside that group
const ownerOptions = computed(() =>
    userStore.users
        .filter(
            (u) =>
                u.id === dataset.value.owner ||
                ((u.role === UserRoles.ADMIN || u.role === UserRoles.LAB_MEMBER) && u.status === UserStatus.ACTIVE)
        )
        .map((u) => ({ title: u.name, value: u.id }))
);

// Plot options the backend accepts (value is the stored enum value)
const plotOptions = Object.values(DatasetPlots);

// Turns a name into a url slug: lowercase letters/digits separated by single dashes
const slugify = (value: string) =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

// While creating, keep the url in step with the name until the user types their own url
const urlTouched = ref(false);
function onNameInput(value: string) {
    dataset.value.name = value;
    if (!isEdit.value && !urlTouched.value) dataset.value.url = slugify(value);
}
function onUrlInput(value: string) {
    urlTouched.value = true;
    dataset.value.url = value;
}

const canSave = computed(
    () => !saving.value && !loading.value && !!dataset.value.name.trim() && !!slugify(dataset.value.url) && (!isEdit.value || !!dataset.value.id)
);

// In edit mode, loads the dataset with the url from the route and fills the form
onMounted(async () => {
    // Owner options are needed in both modes; a failure here just leaves the dropdown empty
    const usersLoaded = userStore.fetchUsers().catch(() => {});
    if (!isEdit.value) return;
    loading.value = true;
    try {
        await Promise.all([datasetStore.fetchDatasets(), usersLoaded]);
        const found = datasetStore.datasets.find((d) => d.url === editingUrl.value);
        if (!found) {
            error.value = "Dataset not found";
            return;
        }
        // Copy so edits don't change the store's cached dataset before saving
        dataset.value = { ...found, treatments: [...found.treatments], plots: [...found.plots] };
    } catch {
        error.value = "Unable to load the dataset. Please try again.";
    } finally {
        loading.value = false;
    }
});

// Creates or updates the dataset, then opens its page
async function save() {
    saving.value = true;
    error.value = null;
    const d = dataset.value;
    const fields = {
        name: d.name.trim(),
        url: slugify(d.url),
        description: d.description,
        doi: d.doi.trim(),
        rawDataLink: d.rawDataLink.trim(),
        treatments: d.treatments,
        plots: d.plots,
    };
    try {
        const saved = isEdit.value
            ? await datasetStore.editDataset(d.id, fields)
            : await datasetStore.addDataset({ ...fields, owner: d.owner, visibility: d.visibility });
        await router.push(`/dataset/${saved.url}`);
    } catch (err) {
        const taken = axios.isAxiosError(err) && err.response?.status === 500;
        error.value = taken
            ? "Unable to save the dataset. The url may already be in use by another dataset."
            : "Unable to save the dataset. Please try again.";
    } finally {
        saving.value = false;
    }
}
</script>

<!-- Form for creating or editing a dataset; file uploads are UI only for now -->
<template>
    <v-container class="py-6 px-12">
        <!-- Dataset name -->
        <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error = null">{{ error }}</v-alert>
        <v-text-field
            :model-value="dataset.name"
            @update:model-value="onNameInput"
            placeholder="DATASET NAME"
            variant="plain"
            class="text-headline-small mb-2"
            hide-details
        ></v-text-field>
        <v-divider class="mb-4"></v-divider>

        <!-- Owner (defaults to the current user when creating; fixed once the dataset exists) -->
        <v-row class="text-body-medium mb-1 mx-4">Owner</v-row>
        <v-select
            v-model="dataset.owner"
            :items="ownerOptions"
            placeholder="Select an owner"
            :disabled="isEdit"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-select>

        <!-- Description -->
        <v-row class="text-body-medium mb-1 mx-4">Description</v-row>
        <v-textarea v-model="dataset.description" placeholder="Type a description of the dataset here" rows="2" hide-details class="mb-4 mx-4"></v-textarea>

        <!-- URL slug: the dataset is served at /dataset/<url> -->
        <v-row class="text-body-medium mb-1 mx-4">Website URL</v-row>
        <v-text-field
            :model-value="dataset.url"
            @update:model-value="onUrlInput"
            prefix="/dataset/"
            placeholder="dataset-url"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- DOI link -->
        <v-row class="text-body-medium mb-1 mx-4">DOI</v-row>
        <v-text-field
            v-model="dataset.doi"
            prepend-inner-icon="mdi-link"
            placeholder="Add DOI link here"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- Link to raw data download (NCBI/SRA) -->
        <v-row class="text-body-medium mb-1 mx-4">Raw Data Download Link (NCBI/SRA)</v-row>
        <v-text-field v-model="dataset.rawDataLink" placeholder="Add download link here" density="compact" hide-details class="mb-4 mx-4"></v-text-field>

        <!-- Raw data file upload -->
        <v-row class="mx-4">
            <v-file-upload
                density="compact"
                title="Upload Raw Data File"
                clearable
                :multiple="false"
                hide-details
            ></v-file-upload>
            <!-- <v-btn color="primary" prepend-icon="mdi-upload">Upload raw data file</v-btn> -->
        </v-row>

        <!-- Treatments associated with the dataset -->
        <v-row class="text-body-medium mb-1 mx-4">Add Your Treatments</v-row>
        <v-combobox
            v-model="dataset.treatments"
            placeholder="Type a treatment and press enter"
            multiple
            chips
            closable-chips
            density="comfortable"
            hide-details
            class="mb-4 mx-4"
        ></v-combobox>

        <!-- Plot types available for the dataset -->
        <v-row class="text-body-medium mb-1 mx-4">Pick Your Plots</v-row>
        <v-select
            v-model="dataset.plots"
            :items="plotOptions"
            multiple
            chips
            closable-chips
            density="comfortable"
            hide-details
            class="mb-8 mx-4"
        ></v-select>

        <!-- Cover photo and .rds file uploads -->
        <v-row class="mx-4">
            <v-file-upload density="compact" title="Upload Cover Photo" clearable :multiple="false" hide-details></v-file-upload>
            <!-- <v-btn color="primary" prepend-icon="mdi-upload">Upload cover photo</v-btn> -->
        </v-row>
        <v-row class="mx-4">
            <v-file-upload density="compact" title="Upload .rds File" clearable :multiple="false" hide-details></v-file-upload>
            <!-- <v-btn color="primary" prepend-icon="mdi-upload">Upload .rds file</v-btn> -->
        </v-row>

        <!-- Submit button -->
        <v-row class="justify-end mx-4">
            <v-spacer />
            <v-col class="justify-end" cols="auto">
                <v-btn :disabled="!canSave" :loading="saving" @click="save">{{ isEdit ? "Save Changes" : "Create New Dataset" }}</v-btn>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped>
/* Make the file upload dropzones more compact (:deep is needed to style Vuetify's inner elements) */
:deep(.v-file-upload-dropzone--density-compact) {
    padding: 10px 0;
    gap: 0.5rem;
}
:deep(.v-file-upload-icon) {
    font-size: 1.25rem;
    margin-bottom: 0;
}
:deep(.v-file-upload-title) {
    font-size: 0.8125rem;
}
/* Vuetify 3 renders the prefix as .v-text-field__prefix (there is no .v-field__prefix) and keeps it at opacity 0 until the field has a value */
:deep(.v-text-field__prefix) {
    opacity: 1;
    color: #3E3E3E;
}
</style>

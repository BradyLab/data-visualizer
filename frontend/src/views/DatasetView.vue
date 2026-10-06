<script setup lang="ts">
// Dataset page view: shows a dataset from the backend (found by the url slug in the route) and lets viewers pick treatments and plots.
// Gene and cell type selection and plot generation are still static placeholders.
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();

// The dataset for the current url, read from the store (null until loaded or when no dataset has that url)
const loading = ref(true);
const error = ref<string | null>(null);

// Treatments and plots the viewer has ticked (nothing starts selected)
const selectedTreatments = ref<string[]>([]);
const selectedPlots = ref<string[]>([]);

// Edit is offered to admins, the dataset's owner (a lab member), and users with an EDIT permission on the dataset
// This hides the button; EditDatasetView repeats the check client-side and redirects, and the backend enforces it
const canEdit = computed(() => !!datasetStore.currentDataset && permissionStore.canEdit(datasetStore.currentDataset));

// DOI as a link: bare DOIs (10.xxxx/...) are resolved through doi.org
// Values already starting with http(s):// are used as-is
const doiHref = computed(() => {
    const doi = datasetStore.currentDataset?.doi;
    if (!doi) return null;
    return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
});

// Loads the dataset (and, for logged-in users, their permissions) whenever the url slug changes
watch(
    () => route.params.datasetURL as string,
    async (url) => {
        loading.value = true;
        error.value = null;
        // Clear the previous dataset so a stale one is not shown while loading
        datasetStore.currentDataset = null;
        try {
            const [found] = await Promise.all([
                datasetStore.getByUrl(url),
                auth.isLoggedIn ? permissionStore.fetchMine(auth.user.id) : Promise.resolve(),
            ]);
            selectedTreatments.value = [];
            selectedPlots.value = [];
            if (!found) error.value = "Dataset not found";
        } catch {
            error.value = "Unable to load the dataset. Please try again.";
        } finally {
            loading.value = false;
        }
    },
    { immediate: true }
);
</script>

<!-- Dataset page: name, description, treatments and plots come from the backend; genes and cell types are still placeholders -->
<template>
    <v-container v-if="!datasetStore.currentDataset" class="px-12">
        <v-progress-circular v-if="loading" indeterminate></v-progress-circular>
        <v-alert v-else type="error" variant="tonal">{{ error }}</v-alert>
    </v-container>
    <v-container v-else class="px-12">
        <!-- Title, DOI, and action buttons -->
        <v-row class="mb-4">
            <v-col>
                <h1 class="text-h6 my-0 font-weight-bold">{{ datasetStore.currentDataset.name }}</h1>
                <div v-if="doiHref" class="text-body-small">
                    DOI: <a :href="doiHref" target="_blank" rel="noopener noreferrer">{{ datasetStore.currentDataset.doi }}</a>
                </div>
            </v-col>
            <v-col cols="auto" class="d-flex align-center ga-2">
                <v-btn
                    v-if="canEdit"
                    color="primary"
                    prepend-icon="mdi-pencil"
                    @click="router.push(`/dataset/${datasetStore.currentDataset.url}/edit`)"
                    >Edit</v-btn
                >
                <v-btn
                    color="primary"
                    prepend-icon="mdi-download"
                    :href="datasetStore.currentDataset.rawDataLink || undefined"
                    :disabled="!datasetStore.currentDataset.rawDataLink"
                    target="_blank"
                    rel="noopener noreferrer"
                    >Raw Data</v-btn
                >
            </v-col>
        </v-row>

        <!-- Dataset description -->
        <v-row class="text-body-large">{{ datasetStore.currentDataset.description }}</v-row>

        <!-- Gene selector (multi-select with removable chips) -->
        <v-row class="text-body-medium mx-4">Pick Your Genes</v-row>
        <v-combobox
            :items="['Gene 1', 'Gene 2', 'Gene 3']"
            :model-value="['Gene 1', 'Gene 2']"
            multiple
            chips
            closable-chips
            density="comfortable"
            prepend-inner-icon="mdi-magnify"
            hide-details
            class="mb-4 mx-4"
        ></v-combobox>

        <!-- Cell type selector (multi-select with removable chips) -->
        <div class="text-body-medium mb-1 mx-4">Pick Your Cell Types</div>
        <v-combobox
            :items="['Cell Type 1', 'Cell Type 2', 'Cell Type 3']"
            :model-value="['Cell Type 1', 'Cell Type 2']"
            multiple
            chips
            closable-chips
            density="comfortable"
            prepend-inner-icon="mdi-magnify"
            hide-details
            class="mb-6 mx-4"
        ></v-combobox>

        <!-- Treatment and plot checkboxes, side by side on wider screens -->
        <v-row class="mx-4">
            <v-col cols="12" md="6">
                <div class="text-body-medium mb-1">Pick Your Treatments</div>
                <v-checkbox
                    v-for="treatment in datasetStore.currentDataset.treatments"
                    :key="treatment"
                    v-model="selectedTreatments"
                    :value="treatment"
                    :label="treatment"
                    color="primary"
                    density="compact"
                    hide-details
                ></v-checkbox>
            </v-col>
            <v-col cols="12" md="6">
                <div class="text-body-medium mb-1">Pick Your Plots</div>
                <v-checkbox
                    v-for="plot in datasetStore.currentDataset.plots"
                    :key="plot"
                    v-model="selectedPlots"
                    :value="plot"
                    :label="plot"
                    color="primary"
                    density="compact"
                    hide-details
                ></v-checkbox>
            </v-col>
        </v-row>

        <!-- Button that will generate the selected plots -->
        <div class="d-flex justify-center mt-6">
            <v-btn color="primary">Generate Plots</v-btn>
        </div>
    </v-container>
</template>

<style scoped>
/* Shrink the checkboxes to make the option lists more compact (:deep is needed to style Vuetify's inner elements) */
:deep(.v-checkbox .v-selection-control) {
    --v-input-control-height: 28px;
    --v-selection-control-size: 20px;
    min-height: 28px;
}
:deep(.v-checkbox .v-icon) {
    font-size: 18px;
}
:deep(.v-checkbox .v-label) {
    font-size: 0.8125rem;
}
</style>

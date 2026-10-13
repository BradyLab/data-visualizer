<script setup lang="ts">
// Dataset page view: shows a dataset from the backend (found by the url slug in the route) and lets viewers pick treatments and plots.
// Gene and cell type selection and plot generation are still static placeholders.
import { computed, ref, watch } from "vue";
import axios from "axios";
import { useRoute, useRouter } from "vue-router";
import { useFileStore } from "@src/stores/file";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { datasetApi } from "@src/api/dataset";
import { DatasetStatus } from "@commons/dataset";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();
const fileStore = useFileStore();

// Loading and error state for the page; the dataset itself is datasetStore.currentDataset
// (null until loaded or when no dataset has that url)
const loading = ref(true);
const error = ref<string | null>(null);

// Treatments and plots the viewer has ticked (nothing starts selected)
const selectedTreatments = ref<string[]>([]);
const selectedPlots = ref<string[]>([]);

// Shiny viewer: its iframe URL (null until Generate Plots is clicked) and the state of the ticket request
const viewerUrl = ref<string | null>(null);
const viewerLoading = ref(false);

// Asks the backend for a viewer ticket and points the iframe at it. A fresh ticket is fetched on every click (it only lives about a minute),
// and the ticked plots are passed along; the viewer narrows them to the plots the dataset offers
async function generatePlots() {
    error.value = null;
    viewerLoading.value = true;
    try {
        const params: Record<string, string> = {};
        if (selectedPlots.value.length) params.plots = selectedPlots.value.join(",");
        viewerUrl.value = await datasetApi.getViewerUrl(datasetStore.currentDataset!.id, params);
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 503
                ? "The plot viewer is not available right now."
                : axios.isAxiosError(err) && err.response?.status === 409
                  ? "The data for this dataset is not ready yet."
                  : "Unable to open the plot viewer. Please try again.";
    } finally {
        viewerLoading.value = false;
    }
}

// Plots can only be shown once the server has built the plot data from the uploaded file
const plotsReady = computed(() => datasetStore.currentDataset?.status === DatasetStatus.READY);
const reprocessing = ref(false);

// Asks the server to rebuild the plot data (after a failure); the status then follows the live updates
async function reprocess() {
    error.value = null;
    reprocessing.value = true;
    try {
        await datasetStore.reprocessDataset(datasetStore.currentDataset!.id);
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 409
                ? (err.response.data?.error ?? "The plot data cannot be rebuilt right now.")
                : "Unable to start processing. Please try again.";
    } finally {
        reprocessing.value = false;
    }
}

// Starts the download of the dataset's .rds file; the browser takes over from there
async function downloadData() {
    error.value = null;
    try {
        await fileStore.downloadRds(datasetStore.currentDataset!.id);
    } catch (err) {
        error.value =
            axios.isAxiosError(err) && err.response?.status === 404
                ? "This dataset has no data file yet."
                : "Unable to start the download. Please try again.";
    }
}

// DOI as a link: bare DOIs (10.xxxx/...) are resolved through doi.org
// Values already starting with http(s):// are used as-is
const doiHref = computed(() => {
    const doi = datasetStore.currentDataset?.doi;
    if (!doi) return null;
    return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
});

// The open dataset disappears from the store while the page is showing it (deleted, or no longer visible to the viewer, as pushed by the
// server), so say so instead of leaving a blank page. loading is set before the lookups below clear the dataset, so those are not reported
watch(
    () => datasetStore.currentDataset,
    (now, before) => {
        if (!now && before && !loading.value) error.value = "This dataset was deleted or is no longer available to you.";
        // An editor changed the url slug: follow it, so a reload or a bookmark of this page keeps working
        else if (now && before?.id === now.id && now.url !== route.params.datasetURL) router.replace(`/dataset/${now.url}`);
    }
);

// Loads the dataset (and, for logged-in users, their permissions) whenever the url slug changes
watch(
    () => route.params.datasetURL as string,
    async (url) => {
        // Responses can arrive out of order, so only the latest request may update the page state
        const isLatest = () => url === (route.params.datasetURL as string);
        loading.value = true;
        error.value = null;
        viewerUrl.value = null;
        // Clear the previous dataset so a stale one is not shown while loading
        datasetStore.currentDataset = null;
        try {
            // A failed permissions request must not hide a dataset that loaded; it only costs the viewer their extra buttons (Edit, Download)
            let permissionsFailed = false;
            const [found] = await Promise.all([
                datasetStore.getByUrl(url),
                auth.isLoggedIn
                    ? permissionStore.fetchMine(auth.user.id).catch(() => {
                          permissionsFailed = true;
                      })
                    : Promise.resolve(),
            ]);
            if (!isLatest()) return;
            selectedTreatments.value = [];
            selectedPlots.value = [];
            if (!found) error.value = "Dataset not found";
            else if (permissionsFailed)
                error.value = "Unable to load your permissions, so some actions may be missing. Reload to try again.";
        } catch {
            if (isLatest()) error.value = "Unable to load the dataset. Please try again.";
        } finally {
            if (isLatest()) loading.value = false;
        }
    },
    { immediate: true }
);
</script>

<!-- Dataset page: name, description, treatments and plots come from the backend; genes and cell types are still placeholders -->
<template>
    <!-- Not loaded yet: spinner while loading, otherwise the error -->
    <v-container v-if="!datasetStore.currentDataset" class="px-12">
        <v-progress-circular v-if="loading" indeterminate></v-progress-circular>
        <v-alert v-else type="error" variant="tonal">{{ error }}</v-alert>
    </v-container>
    <v-container v-else class="px-12">
        <!-- Download or load errors that appear after the page loaded -->
        <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error = null">{{ error }}</v-alert>
        <!-- Title, DOI, and action buttons -->
        <v-row>
            <v-col>
                <h1 class="text-h6 my-0 font-weight-bold">{{ datasetStore.currentDataset.name }}</h1>
                <div class="text-body-small">
                    Author: {{ datasetStore.currentDataset.ownerName ?? datasetStore.currentDataset.owner }}
                </div>
            </v-col>
            <v-col cols="auto" class="d-flex align-center ga-2">
                <v-btn
                    v-if="permissionStore.canEdit(datasetStore.currentDataset)"
                    color="primary"
                    prepend-icon="mdi-pencil"
                    @click="router.push(`/dataset/${datasetStore.currentDataset.url}/edit`)"
                    >Edit</v-btn
                >
                <v-btn
                    v-if="permissionStore.canDownload(datasetStore.currentDataset)"
                    color="primary"
                    prepend-icon="mdi-download"
                    :loading="fileStore.downloading"
                    @click="downloadData"
                    >Data</v-btn
                >
            </v-col>
        </v-row>
        <v-row class="mt-0">
            <div v-if="doiHref" class="text-body-small">
                DOI: <a :href="doiHref" target="_blank" rel="noopener noreferrer">{{ datasetStore.currentDataset.doi }}</a>
            </div>
        </v-row>
        <v-row class="mt-0 mb-4">
            <div v-if="datasetStore.currentDataset.attribution" class="text-body-small">
                Attribution: {{ datasetStore.currentDataset.attribution }}
            </div>
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

        <!-- Plot data status: the plots can only be shown once the uploaded data file has been processed -->
        <v-alert v-if="datasetStore.currentDataset.status === DatasetStatus.PROCESSING" type="info" variant="tonal" class="mt-6">
            The data for this dataset is being processed. Plots will be available when that is done.
        </v-alert>
        <v-alert
            v-else-if="datasetStore.currentDataset.status === DatasetStatus.FAILED"
            type="error"
            variant="tonal"
            class="mt-6"
        >
            The data for this dataset could not be processed.
            <div v-if="datasetStore.currentDataset.statusMessage" class="text-body-small mt-1">
                {{ datasetStore.currentDataset.statusMessage }}
            </div>
            <template v-if="permissionStore.canEdit(datasetStore.currentDataset)" #append>
                <v-btn variant="outlined" :loading="reprocessing" @click="reprocess">Try again</v-btn>
            </template>
        </v-alert>

        <!-- Button that opens the Shiny viewer with the selected plots -->
        <div class="d-flex justify-center mt-6">
            <v-btn color="primary" :disabled="!plotsReady" :loading="viewerLoading" @click="generatePlots">Generate Plots</v-btn>
        </div>

        <!-- Interactive plots from the Shiny app; it is only reachable through the backend, which checks the viewer's access -->
        <iframe
            v-if="viewerUrl && plotsReady"
            :src="viewerUrl"
            title="Interactive plots"
            class="viewer-frame mt-6"
            referrerpolicy="same-origin"
        ></iframe>
    </v-container>
</template>

<style scoped>
.viewer-frame {
    width: 100%;
    height: 80vh;
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
}
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

<script setup lang="ts">
// Dataset page view: shows a dataset from the backend (found by the url slug in the route) and opens the Shiny plot viewer for it,
// where the plots, genes and cell types are picked.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

// Shiny viewer: its iframe URL (null until Generate Plots is clicked) and the state of the ticket request
const viewerUrl = ref<string | null>(null);
const viewerLoading = ref(false);

// The description is cut off at 2 lines until it is clicked
const descriptionExpanded = ref(false);

// The viewer reports how tall its content is (postMessage) so the iframe grows to fit it; only messages from our own iframe count
const viewerFrame = ref<HTMLIFrameElement | null>(null);
const viewerHeight = ref<number | null>(null);
function onViewerMessage(event: MessageEvent) {
    const data = event.data;
    if (!viewerFrame.value || event.source !== viewerFrame.value.contentWindow) return;
    if (data?.type === "viewer-height" && typeof data.height === "number" && Number.isFinite(data.height)) {
        viewerHeight.value = Math.min(Math.max(Math.round(data.height), 300), 6000);
    }
}
onMounted(() => window.addEventListener("message", onViewerMessage));
onBeforeUnmount(() => window.removeEventListener("message", onViewerMessage));

// Asks the backend for a viewer ticket and points the iframe at it. A fresh ticket is fetched on every click (it only lives about a minute).
async function generatePlots() {
    error.value = null;
    viewerLoading.value = true;
    try {
        viewerUrl.value = await datasetApi.getViewerUrl(datasetStore.currentDataset!.id);
        // The Generate Plots button the keyboard focus was on disappears, so move the focus to the plots that replace it
        await nextTick();
        viewerFrame.value?.focus();
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

// The tab title names the open dataset, so it is not just "Dataset" for every dataset page
watch(
    () => datasetStore.currentDataset?.name,
    (name) => {
        if (name) document.title = `${name} | Brady Lab Datasets`;
    }
);

// Plots can only be shown once the server has built the plot data from the uploaded file
const plotsReady = computed(() => datasetStore.currentDataset?.status === DatasetStatus.READY);
// If the plot data stops being ready (e.g. a new upload is processed) the viewer closes (the backend ends its access too); forget its URL
// so the Generate Plots button comes back and a fresh ticket is requested once the data is ready again
watch(plotsReady, (ready) => {
    if (ready) return;
    viewerUrl.value = null;
    viewerHeight.value = null;
});
// True while the reprocess request is in flight (shown as loading on the Try again button)
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
// A route without the slug (navigating away, e.g. to the edit page, before this component unmounts) is ignored, so it neither looks up an undefined slug nor clears currentDataset
watch(
    () => route.params.datasetURL as string,
    async (url) => {
        if (!url) return;
        // Responses can arrive out of order, so only the latest request may update the page state
        const isLatest = () => url === (route.params.datasetURL as string);
        loading.value = true;
        error.value = null;
        viewerUrl.value = null;
        viewerHeight.value = null;
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

<!-- Dataset page: name, description and status come from the backend; the plots are drawn by the Shiny viewer below -->
<template>
    <!-- Not loaded yet: spinner while loading, otherwise the error -->
    <v-container v-if="!datasetStore.currentDataset" class="px-12">
        <v-progress-circular v-if="loading" indeterminate aria-label="Loading dataset"></v-progress-circular>
        <v-alert v-else type="error" variant="tonal">{{ error }}</v-alert>
    </v-container>
    <div v-else class="px-5 mx-5 justify-center">
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
        <div
            id="dataset-description"
            class="text-body-large description"
            :class="{ 'description-clamped': !descriptionExpanded }"
        >
            {{ datasetStore.currentDataset.description }}
        </div>
        <v-btn
            v-if="datasetStore.currentDataset.description"
            variant="text"
            size="small"
            class="mt-1"
            aria-controls="dataset-description"
            :aria-expanded="descriptionExpanded"
            @click="descriptionExpanded = !descriptionExpanded">
            {{ descriptionExpanded ? "Show less" : "Show more" }}
        </v-btn>

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

        <!-- Button that opens the Shiny viewer for this dataset -->
        <div class="d-flex justify-center mt-6 mb-n8">
            <v-btn v-if="!viewerUrl" color="primary" :disabled="!plotsReady" :loading="viewerLoading" @click="generatePlots"
                >Generate Plots</v-btn
            >
        </div>

        <!-- Interactive plots from the Shiny app; it is only reachable through the backend, which checks the viewer's access -->
        <iframe
            v-if="viewerUrl && plotsReady"
            ref="viewerFrame"
            :src="viewerUrl"
            :style="viewerHeight ? { height: `${viewerHeight}px` } : undefined"
            :title="`Interactive plots for ${datasetStore.currentDataset.name}`"
            class="viewer-frame mt-6"
            referrerpolicy="same-origin"
        ></iframe>
    </div>
</template>

<style scoped>
.description-clamped {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
.viewer-frame {
    width: 100%;
    height: 600px; /* until the viewer reports its content height */
    border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    border-radius: 4px;
}
</style>

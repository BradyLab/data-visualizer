<script setup lang="ts">
// Create/edit dataset page: the same form is used for /new and /dataset/:datasetURL/edit (files are uploaded after the dataset itself is saved)
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import { FileTypes } from "@commons/file";
import { DatasetPlots, DatasetStatus, DatasetVisibility, datasetUrlError, slugify, type IDataset } from "@commons/dataset";
import { UserRoles, UserStatus } from "@commons/user";
import { useAuthStore } from "@src/stores/auth";
import { useFileStore } from "@src/stores/file";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { useUserStore } from "@src/stores/user";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const fileStore = useFileStore();
const permissionStore = usePermissionStore();
const userStore = useUserStore();

// Edit mode when the route carries a dataset url slug; otherwise we are creating a new dataset
const editingUrl = computed(() => (route.params.datasetURL as string | undefined) ?? null);
const isEdit = computed(() => editingUrl.value !== null);

// Form state: a blank dataset while creating (id stays "" until the dataset is loaded in edit mode, or saved)
const dataset = ref<IDataset>({
    id: "",
    name: "",
    // Defaults to the viewer (the route requires a login); in edit mode it is replaced by the loaded dataset's owner
    owner: auth.user.id,
    url: "",
    description: "",
    doi: "",
    attribution: "",
    plots: [],
    // New datasets start private; visibility is changed from the settings page
    visibility: DatasetVisibility.PRIVATE,
    // Placeholders to satisfy IDataset; they are not sent on save (the backend sets the real status and timestamps)
    status: DatasetStatus.PROCESSING,
    statusMessage: null,
    createdAt: new Date(),
    updatedAt: null,
});

// Files picked for upload; they are sent after the dataset is saved. v-file-upload may hand back a single file, a list or nothing
type Picked = File | File[] | undefined;
const coverFile = ref<Picked>();
const rdsFile = ref<Picked>();
const tissueMapFile = ref<Picked>();
const firstFile = (picked: Picked) => (Array.isArray(picked) ? (picked[0] ?? null) : (picked ?? null));
// Notes on what changed since the previous version of the .rds file (sent with the .rds upload only)
const rdsUpdates = ref("");

// The fields the form edits; compared (as a snapshot string) to tell whether another user changed the dataset while it is open
const EDITABLE_FIELDS = ["name", "url", "description", "doi", "attribution", "plots"] as const;
const snapshot = (d: IDataset) => JSON.stringify(EDITABLE_FIELDS.map((field) => d[field]));
// Snapshot of the saved dataset the form started from; replaced after the user's own save so that is not mistaken for someone else's change
let baseline = "";
// Another user saved different values while this form was open (saving now would overwrite them)
const changedElsewhere = ref(false);
// The dataset was deleted (or the viewer lost access to it) while this form was open, so it can no longer be saved
const removed = ref(false);

// Busy flags: loading while the dataset is fetched (edit mode), saving while the save request is in flight
const loading = ref(false);
const saving = ref(false);
const deleting = ref(false);
const confirmDeleteOpen = ref(false);
const error = ref<string | null>(null);

// Owner choices. Admins pick from the active admins and lab members, plus the dataset's current owner if they fall
// outside that group. Everyone else can only create datasets they own themselves, so the only choice is the current owner
const ownerOptions = computed(() => {
    if (auth.isAdmin)
        return userStore.users
            .filter(
                (u) =>
                    u.id === dataset.value.owner ||
                    ((u.role === UserRoles.ADMIN || u.role === UserRoles.LAB_MEMBER) && u.status === UserStatus.ACTIVE)
            )
            .map((u) => ({ title: u.name, value: u.id }));
    const owner = dataset.value.owner;
    return [{ title: owner === auth.user.id ? auth.user.name : userStore.nameOf(owner), value: owner }];
});

// Plot options the backend accepts (value is the stored enum value)
const plotOptions = Object.values(DatasetPlots);

// While creating, keep the url in step with the name until the user types their own url
// The url field shows the raw text as typed; it is only normalised with slugify() when saving (and in canSave).
const urlTouched = ref(false);
function onNameInput(value: string) {
    dataset.value.name = value;
    if (!isEdit.value && !urlTouched.value) dataset.value.url = slugify(value);
}
function onUrlInput(value: string) {
    urlTouched.value = true;
    dataset.value.url = value;
}

// Problem with the url as it will be saved (empty, or a reserved slug such as "new"), shown under the field; null while the field is empty
const urlError = computed(() => (dataset.value.url ? datasetUrlError(slugify(dataset.value.url)) : null));

// A new dataset needs a tissue map (a .csv) when it offers the tissue plot, which includes picking no plots at all since that offers every plot.
// An existing dataset may already have one, so editing never requires it
const tissueMapRequired = computed(
    () => !isEdit.value && (dataset.value.plots.length === 0 || dataset.value.plots.includes(DatasetPlots.TISSUE))
);
const tissueMapMissing = computed(() => tissueMapRequired.value && !firstFile(tissueMapFile.value));

// Save is blocked while busy, without a name or owner, with an unusable url, or without a required tissue map; in edit mode the dataset must
// have loaded (id set)
const canSave = computed(
    () =>
        !saving.value &&
        !tissueMapMissing.value &&
        !loading.value &&
        !removed.value &&
        !!dataset.value.name.trim() &&
        !!dataset.value.owner &&
        !datasetUrlError(slugify(dataset.value.url)) &&
        (!isEdit.value || !!dataset.value.id)
);

// In edit mode, loads the dataset with the url from the route and fills the form, but only for viewers who may edit it
// (admin, owner or an EDIT permission, same rule as the edit button in DatasetView); everyone else is sent to the dataset page.
// This is a usability check only: the backend must enforce edit access itself
onMounted(async () => {
    // Owner options are needed in both modes; a failure here just leaves the dropdown empty.
    // Only admins may list full user records; others just need the name of an existing dataset's owner
    const usersLoaded = (auth.isAdmin ? userStore.fetchUsers() : userStore.fetchNames()).catch(() => {});
    if (!isEdit.value) return;
    loading.value = true;
    try {
        const [found] = await Promise.all([
            datasetStore.getByUrl(editingUrl.value!),
            permissionStore.fetchMine(auth.user.id),
            usersLoaded,
        ]);
        if (!found) {
            error.value = "Dataset not found";
            return;
        }
        if (!permissionStore.canEdit(found)) {
            await router.replace(`/dataset/${found.url}`);
            return;
        }
        // Copy so edits don't change the store's cached dataset before saving
        dataset.value = { ...found, plots: [...found.plots] };
        baseline = snapshot(found);
    } catch {
        error.value = "Unable to load the dataset. Please try again.";
    } finally {
        loading.value = false;
    }
});

// Pushed changes land in the store's currentDataset (see the socket handlers in the dataset store). While editing, a change made by
// someone else raises a warning and a deletion blocks saving. Changes during a save are the user's own and ignored
watch(
    () => datasetStore.currentDataset,
    (current, previous) => {
        if (!isEdit.value || !dataset.value.id || saving.value || deleting.value) return;
        if (!current) {
            if (previous?.id === dataset.value.id) removed.value = true;
            return;
        }
        if (current.id !== dataset.value.id) return;
        if (snapshot(current) !== baseline) changedElsewhere.value = true;
        // The url slug was changed by someone else: keep the address bar on the dataset's current url
        if (current.url !== editingUrl.value) router.replace(`/dataset/${current.url}/edit`);
    }
);

// Losing edit access while the form is open (the viewer's permissions are updated by pushed changes): back to the dataset page
watch(
    () =>
        isEdit.value && dataset.value.id && datasetStore.currentDataset
            ? permissionStore.canEdit(datasetStore.currentDataset)
            : true,
    (canEdit) => {
        if (!canEdit) router.replace(`/dataset/${dataset.value.url}`);
    }
);

// Replaces the form with the version someone else saved, discarding the local edits
function loadTheirVersion() {
    const theirs = datasetStore.currentDataset;
    if (!theirs) return;
    dataset.value = { ...theirs, plots: [...theirs.plots] };
    baseline = snapshot(theirs);
    changedElsewhere.value = false;
}

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
        attribution: d.attribution.trim(),
        plots: d.plots,
    };
    try {
        const saved = isEdit.value
            ? await datasetStore.editDataset(d.id, fields)
            : await datasetStore.addDataset({ ...fields, owner: d.owner, visibility: d.visibility });
        // The dataset exists now; from here on a retry must update it rather than create it again
        dataset.value.id = saved.id;
        baseline = snapshot(saved);
        changedElsewhere.value = false;
        try {
            const cover = firstFile(coverFile.value);
            if (cover) await fileStore.uploadFile(saved.id, FileTypes.COVER, cover);
            coverFile.value = undefined;
            // The tissue map goes before the .rds: a finished .rds upload starts the (memory-hungry) processing job on the server
            const tissueMap = firstFile(tissueMapFile.value);
            if (tissueMap) await fileStore.uploadFile(saved.id, FileTypes.TISSUE_PLOT, tissueMap);
            tissueMapFile.value = undefined;
            const rds = firstFile(rdsFile.value);
            if (rds) await fileStore.uploadFile(saved.id, FileTypes.RDS, rds, rdsUpdates.value.trim());
            rdsFile.value = undefined;
            rdsUpdates.value = "";
        } catch (err) {
            // Keep the user on the edit page of the saved dataset, with the files that did not upload still selected
            if (!isEdit.value) await router.replace(`/dataset/${saved.url}/edit`);
            error.value = `The dataset was saved, but a file could not be uploaded. ${err instanceof Error && err.message ? err.message : "Please try again."}`;
            return;
        }
        await router.push(`/dataset/${saved.url}`);
    } catch (err) {
        // 409 is a duplicate url; 400 carries the backend's validation message (e.g. a reserved url)
        const response = axios.isAxiosError(err) ? err.response : undefined;
        error.value =
            response?.status === 409
                ? "Unable to save the dataset. The url is already in use by another dataset."
                : response?.status === 400 && typeof response.data?.error === "string"
                  ? `Unable to save the dataset. ${response.data.error}`
                  : "Unable to save the dataset. Please try again.";
    } finally {
        saving.value = false;
    }
}

// Deletes the dataset (edit mode only), then goes home
async function confirmDelete() {
    deleting.value = true;
    try {
        await datasetStore.removeDataset(dataset.value.id);
        confirmDeleteOpen.value = false;
        await router.push("/home");
    } catch {
        confirmDeleteOpen.value = false;
        error.value = "Unable to delete the dataset. Please try again.";
    } finally {
        deleting.value = false;
    }
}
</script>

<!-- Form for creating or editing a dataset, including its cover photo, .rds file and tissue map -->
<template>
    <v-container class="py-6 px-12">
        <!-- Load/save error message -->
        <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error = null">{{ error }}</v-alert>
        <!-- Pushed from the server while the form is open: the dataset is gone, or someone else changed it -->
        <v-alert v-if="removed" type="error" variant="tonal" class="mb-4">
            This dataset was deleted or is no longer available to you, so it can't be saved.
            <template #append><v-btn variant="text" to="/home">Home</v-btn></template>
        </v-alert>
        <v-alert v-else-if="changedElsewhere" type="warning" variant="tonal" class="mb-4">
            Someone else changed this dataset while you were editing. Saving will overwrite their changes.
            <template #append>
                <v-btn variant="text" @click="loadTheirVersion">Load their version</v-btn>
                <v-btn variant="text" @click="changedElsewhere = false">Keep mine</v-btn>
            </template>
        </v-alert>
        <h1 class="visually-hidden">{{ isEdit ? "Edit Dataset" : "New Dataset" }}</h1>
        <!-- Dataset name -->
        <v-text-field
            :model-value="dataset.name"
            @update:model-value="onNameInput"
            aria-label="Dataset name (required)"
            placeholder="DATASET NAME"
            variant="plain"
            class="text-headline-small mb-2"
            hide-details
        ></v-text-field>
        <v-divider class="mb-4"></v-divider>

        <!-- Owner (defaults to the current user when creating, and only admins may pick someone else; fixed once the dataset exists) -->
        <v-select
            v-model="dataset.owner"
            :items="ownerOptions"
            label="Owner"
            placeholder="Select an owner"
            :disabled="isEdit || !auth.isAdmin"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-select>

        <!-- Description -->
        <v-textarea
            v-model="dataset.description"
            label="Description"
            placeholder="Type a description of the dataset here"
            rows="2"
            hide-details
            class="mb-4 mx-4"
        ></v-textarea>

        <!-- URL slug: the dataset is served at /dataset/<url> -->
        <v-text-field
            :model-value="dataset.url"
            label="Website URL (required)"
            persistent-placeholder
            @update:model-value="onUrlInput"
            prefix="/dataset/"
            placeholder="dataset-url"
            density="compact"
            :error-messages="urlError ?? undefined"
            :hide-details="!urlError"
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- DOI link -->
        <v-text-field
            v-model="dataset.doi"
            label="DOI"
            prepend-inner-icon="mdi-link"
            placeholder="Add DOI link here"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- Attribution / credit text -->
        <v-text-field
            v-model="dataset.attribution"
            label="Attribution"
            placeholder="Add attribution here"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- Plot types available for the dataset -->
        <v-select
            v-model="dataset.plots"
            :items="plotOptions"
            label="Pick Your Plots"
            close-label="Remove plot"
            multiple
            chips
            closable-chips
            density="comfortable"
            hide-details
            class="mb-8 mx-4"
        ></v-select>

        <!-- Cover photo and .rds file uploads (the tissue map upload follows) -->
        <v-row class="mx-4">
            <v-file-upload
                v-model="coverFile"
                density="compact"
                title="Upload Cover Photo"
                aria-label="Upload Cover Photo"
                accept="image/*"
                clearable
                :multiple="false"
                hide-details
            ></v-file-upload>
        </v-row>
        <v-row class="mx-4">
            <v-file-upload
                v-model="rdsFile"
                density="compact"
                title="Upload .rds File"
                aria-label="Upload .rds File"
                accept=".rds"
                clearable
                :multiple="false"
                hide-details
            ></v-file-upload>
        </v-row>
        <!-- What changed since the previous version of the .rds file (logged with the file upload) -->
        <v-textarea
            v-if="firstFile(rdsFile)"
            v-model="rdsUpdates"
            label="Updates"
            placeholder="Describe what changed since the last version of the .rds file"
            rows="2"
            hide-details
            class="mb-4 mx-4"
        ></v-textarea>

        <!-- Tissue map for the tissue plot: the CSV of a ggPlantmap table -->
        <v-row class="mx-4">
            <v-file-upload
                v-model="tissueMapFile"
                density="compact"
                title="Upload Tissue Map (ggPlantmap .csv)"
                aria-label="Upload Tissue Map (ggPlantmap .csv)"
                accept=".csv"
                clearable
                :multiple="false"
                hide-details
            ></v-file-upload>
        </v-row>
        <v-row v-if="tissueMapMissing" role="alert" class="text-body-small text-error mb-1 mx-4">
            A tissue map is required because this dataset offers the tissue plot (picking no plots offers all of them). Upload a
            .csv or pick the plots you want.
        </v-row>
        <v-row class="text-body-small mb-4 mx-4">
            A CSV of a ggPlantmap table (columns ROI.name, ROI.id, x, y, and optionally point); x and y must be numbers and
            ROI.name must match the tissue_type column (else the cell labels). A file without these columns is refused. Used by
            the TissuePlot.
        </v-row>

        <!-- Progress of the file being uploaded after the dataset is saved -->
        <v-row v-if="fileStore.uploading" class="mx-4 mb-4">
            <v-col cols="12" class="pa-0">
                <div class="text-body-medium mb-1">
                    {{ fileStore.uploading.label }}: {{ Math.round(fileStore.uploading.fraction * 100) }}%
                </div>
                <v-progress-linear
                    :model-value="fileStore.uploading.fraction * 100"
                    :aria-label="`${fileStore.uploading.label} upload progress`"
                    height="8"
                    rounded
                ></v-progress-linear>
            </v-col>
        </v-row>

        <!-- Delete (edit mode only, and only for the owner and admins; left) and submit (right) buttons -->
        <v-row class="mx-4">
            <v-col v-if="isEdit && permissionStore.canManage(dataset)" cols="auto">
                <v-btn
                    color="error"
                    variant="tonal"
                    :disabled="!dataset.id || removed || saving || deleting"
                    @click="confirmDeleteOpen = true"
                    >Delete Dataset</v-btn
                >
            </v-col>
            <v-spacer />
            <v-col class="justify-end" cols="auto">
                <v-btn :disabled="!canSave" :loading="saving" @click="save">{{
                    isEdit ? "Save Changes" : "Create New Dataset"
                }}</v-btn>
            </v-col>
        </v-row>

        <!-- Cannot be dismissed while the delete is in flight -->
        <v-dialog v-model="confirmDeleteOpen" max-width="480" :persistent="deleting" aria-labelledby="delete-dataset-title">
            <v-card class="pa-4">
                <v-card-title id="delete-dataset-title" tag="h2">Delete Dataset</v-card-title>
                <v-card-text>Delete {{ dataset.name }}? This cannot be undone.</v-card-text>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn :disabled="deleting" color="white" @click="confirmDeleteOpen = false">Cancel</v-btn>
                    <v-btn :loading="deleting" color="error" variant="tonal" @click="confirmDelete">Delete</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
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
/* Only the file itself (not the dropzone) matches the admin tables: translucent primary background with primary text */
:deep(.v-file-upload-item) {
    background-color: rgba(var(--v-theme-primary), 0.12);
    color: rgb(var(--v-theme-primary));
    --v-theme-on-surface: var(--v-theme-primary);
}
/* Vuetify 3 renders the prefix as .v-text-field__prefix (there is no .v-field__prefix) and keeps it at opacity 0 until the field has a value */
:deep(.v-text-field__prefix) {
    opacity: 1;
    color: #3e3e3e;
}
</style>

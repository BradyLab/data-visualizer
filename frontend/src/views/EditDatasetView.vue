<script setup lang="ts">
// Create/edit dataset page: the same form is used for /new and /dataset/:datasetURL/edit (file uploads are not wired up yet)
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import axios from "axios";
import { DatasetPlots, DatasetVisibility, datasetUrlError, slugify, type IDataset } from "@commons/dataset";
import { UserRoles, UserStatus } from "@commons/user";
import { useAuthStore } from "@src/stores/auth";
import { useDatasetStore } from "@src/stores/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { useUserStore } from "@src/stores/user";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const datasetStore = useDatasetStore();
const permissionStore = usePermissionStore();
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
    // Placeholders to satisfy IDataset; they are not sent on save (the backend sets the real timestamps)
    createdAt: new Date(),
    updatedAt: null,
});

const loading = ref(false);
const saving = ref(false);
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

// Problem with the url as it will be saved (empty, or a reserved slug such as "new"), shown under the field; null once typing starts out empty
const urlError = computed(() => (dataset.value.url ? datasetUrlError(slugify(dataset.value.url)) : null));

// Save is blocked while busy, without a name or owner, or with an unusable url; in edit mode the dataset must have loaded (id set)
const canSave = computed(
    () =>
        !saving.value &&
        !loading.value &&
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

        <!-- Owner (defaults to the current user when creating, and only admins may pick someone else; fixed once the dataset exists) -->
        <v-row class="text-body-medium mb-1 mx-4">Owner</v-row>
        <v-select
            v-model="dataset.owner"
            :items="ownerOptions"
            placeholder="Select an owner"
            :disabled="isEdit || !auth.isAdmin"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-select>

        <!-- Description -->
        <v-row class="text-body-medium mb-1 mx-4">Description</v-row>
        <v-textarea
            v-model="dataset.description"
            placeholder="Type a description of the dataset here"
            rows="2"
            hide-details
            class="mb-4 mx-4"
        ></v-textarea>

        <!-- URL slug: the dataset is served at /dataset/<url> -->
        <v-row class="text-body-medium mb-1 mx-4">Website URL</v-row>
        <v-text-field
            :model-value="dataset.url"
            @update:model-value="onUrlInput"
            prefix="/dataset/"
            placeholder="dataset-url"
            density="compact"
            :error-messages="urlError ?? undefined"
            :hide-details="!urlError"
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
        <v-text-field
            v-model="dataset.rawDataLink"
            placeholder="Add download link here"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

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
                <v-btn :disabled="!canSave" :loading="saving" @click="save">{{
                    isEdit ? "Save Changes" : "Create New Dataset"
                }}</v-btn>
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
    color: #3e3e3e;
}
</style>

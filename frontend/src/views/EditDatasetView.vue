<script setup lang="ts">
// Create-dataset page view: form fields and file uploads (static mockup, no logic yet)
</script>

<!-- Form for creating a new dataset. UI only for now; nothing is submitted -->
<template>
    <v-container class="py-6 px-12">
        <!-- Dataset name -->
        <v-text-field placeholder="DATASET NAME" variant="plain" class="text-headline-small mb-2" hide-details></v-text-field>
        <v-divider class="mb-4"></v-divider>

        <!-- Description -->
        <v-row class="text-body-medium mb-1 mx-4">Description</v-row>
        <v-textarea placeholder="Type a description of the dataset here" rows="2" hide-details class="mb-4 mx-4"></v-textarea>

        <!-- DOI link -->
        <v-row class="text-body-medium mb-1 mx-4">DOI</v-row>
        <v-text-field
            prepend-inner-icon="mdi-link"
            placeholder="Add DOI link here"
            density="compact"
            hide-details
            class="mb-4 mx-4"
        ></v-text-field>

        <!-- Link to raw data download (NCBI/SRA) -->
        <v-row class="text-body-medium mb-1 mx-4">Raw Data Download Link (NCBI/SRA)</v-row>
        <v-text-field placeholder="Add download link here" density="compact" hide-details class="mb-4 mx-4"></v-text-field>

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
            :items="['Treatment 1', 'Treatment 2', 'Treatment 3', 'Control']"
            :model-value="['Treatment 1', 'Treatment 2', 'Treatment 3', 'Control']"
            multiple
            chips
            closable-chips
            density="comfortable"
            hide-details
            class="mb-4 mx-4"
        ></v-combobox>

        <!-- Plot types available for the dataset -->
        <v-row class="text-body-medium mb-1 mx-4">Pick Your Plots</v-row>
        <v-combobox
            :items="['UMAP DimPlot', 'Dot Plot', 'Tissue Plot', 'Plot 4']"
            :model-value="['UMAP DimPlot', 'Dot Plot', 'Tissue Plot', 'Plot 4']"
            multiple
            chips
            closable-chips
            density="comfortable"
            hide-details
            class="mb-8 mx-4"
        ></v-combobox>

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
                <v-btn>Create New Dataset</v-btn>
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
</style>

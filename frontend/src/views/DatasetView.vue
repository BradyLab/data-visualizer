<script setup lang="ts"></script>

<template>
    <v-container class="px-12">
        <v-row class="mb-4">
            <v-col>
                <h1 class="text-h6 my-0 font-weight-bold">DATASET NAME</h1>
                <div class="text-body-small">DOI: [doi link here]</div>
            </v-col>
            <v-col cols="auto" class="d-flex align-center ga-2">
                <v-btn color="primary" prepend-icon="mdi-pencil">Edit</v-btn>
                <v-btn color="primary" prepend-icon="mdi-download">Raw Data</v-btn>
            </v-col>
        </v-row>

        <v-row class="text-body-large">DESCRIPTION HERE</v-row>

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

        <v-row class="mx-4">
            <v-col cols="12" md="6">
                <div class="text-body-medium mb-1">Pick Your Treatments</div>
                <v-checkbox :model-value="true" label="Control" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="false" label="Treatment 1" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="true" label="Treatment 2" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="false" label="Treatment 3" color="primary" density="compact" hide-details></v-checkbox>
            </v-col>
            <v-col cols="12" md="6">
                <div class="text-body-medium mb-1">Pick Your Plots</div>
                <v-checkbox :model-value="true" label="UMAP DimPlot" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="false" label="Dot Plot" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="false" label="Tissue Plot" color="primary" density="compact" hide-details></v-checkbox>
                <v-checkbox :model-value="false" label="Plot 4" color="primary" density="compact" hide-details></v-checkbox>
            </v-col>
        </v-row>

        <div class="d-flex justify-center mt-6">
            <v-btn color="primary">Generate Plots</v-btn>
        </div>
    </v-container>
</template>

<style scoped>
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

// Pinia store holding the list of datasets and wrapping the dataset API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IDataset } from "@commons/dataset";
import { datasetApi } from "@src/api/dataset";

export const useDatasetStore = defineStore("dataset", () => {
    const datasets = ref<IDataset[]>([]);

    /** Loads all datasets from the backend into the store */
    async function fetchDatasets() {
        datasets.value = await datasetApi.getDatasets();
    }

    return { datasets, fetchDatasets };
});

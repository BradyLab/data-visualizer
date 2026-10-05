// Pinia store holding the list of datasets and wrapping the dataset API calls
import { ref } from "vue";
import { defineStore } from "pinia";
import type { IDataset } from "@commons/dataset";
import { datasetApi } from "@src/api/dataset";
import { type CreateDatasetPayload, type UpdateDatasetPayload } from "@src/interfaces/dataset";

export const useDatasetStore = defineStore("dataset", () => {
    const datasets = ref<IDataset[]>([]);

    /** Loads all datasets from the backend into the store */
    async function fetchDatasets() {
        datasets.value = await datasetApi.getDatasets();
    }

    /** Returns the cached dataset with this id, or null if not loaded */
    async function getById(id: string) {
        const data = datasets.value.find((d) => d.id === id);

        if (!data) {
            await fetchDatasets();
            return datasets.value.find((d) => d.id === id) ?? null;
        }

        return data;
    }

    /** Creates a dataset and adds it to the store */
    async function addDataset(payload: CreateDatasetPayload) {
        const dataset = await datasetApi.createDataset(payload);
        datasets.value.push(dataset);
        return dataset;
    }

    /** Updates a dataset and replaces it in the store */
    async function editDataset(id: string, payload: UpdateDatasetPayload) {
        const dataset = await datasetApi.updateDataset(id, payload);
        const i = datasets.value.findIndex((d) => d.id === id);
        // Replace in place if cached, otherwise add it
        if (i === -1) datasets.value.push(dataset);
        else datasets.value[i] = dataset;
        return dataset;
    }

    /** Deletes a dataset and removes it from the store */
    async function removeDataset(id: string) {
        await datasetApi.deleteDataset(id);
        datasets.value = datasets.value.filter((d) => d.id !== id);
    }

    return { datasets, fetchDatasets, getById, addDataset, editDataset, removeDataset };
});

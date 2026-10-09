// Pinia store holding the list of datasets and wrapping the dataset API calls
import { ref, watch } from "vue";
import { defineStore } from "pinia";
import type { IDataset } from "@commons/dataset";
import { datasetApi } from "@src/api/dataset";
import { usePermissionStore } from "@src/stores/permission";
import { useSocketStore } from "@src/stores/socket";
import { SocketEvent } from "@commons/socket";
import { type CreateDatasetPayload, type UpdateDatasetPayload } from "@src/interfaces/dataset";

export const useDatasetStore = defineStore("dataset", () => {
    const datasets = ref<IDataset[]>([]);
    // Result of the latest getById / getByUrl lookup (null if that lookup found nothing)
    const currentDataset = ref<IDataset | null>(null);
    // Counts lookups so a slow earlier one can't overwrite currentDataset after a newer lookup has started
    let latestLookup = 0;

    // True while the latest fetchDatasets failed, so the layout can tell the viewer the dataset list may be missing or stale
    const loadFailed = ref(false);

    // Dataset list requests in flight, the latest one's number, and the changes (a dataset, or null for a deletion) that arrived while any
    // were in flight. A list is a snapshot from before those changes, so the newest request applies them on top of it; otherwise a push
    // that lands between the request and its response would be undone by the response
    let listRequests = 0;
    let latestList = 0;
    const changedDuringFetch = new Map<string, IDataset | null>();

    // Replaces the cached dataset with the same id, or adds it. Used for the user's own changes and for pushed ones, which
    // can arrive in either order, so neither may add a duplicate. Also keeps the open dataset in sync
    function upsert(dataset: IDataset) {
        if (listRequests) changedDuringFetch.set(dataset.id, dataset);
        const i = datasets.value.findIndex((d) => d.id === dataset.id);
        if (i === -1) datasets.value.push(dataset);
        else datasets.value[i] = dataset;
        if (currentDataset.value?.id === dataset.id) currentDataset.value = dataset;
    }

    // Drops a dataset (and its cached permissions, which the backend deletes with it) from the store
    function drop(id: string) {
        if (listRequests) changedDuringFetch.set(id, null);
        if (currentDataset.value?.id === id) currentDataset.value = null;
        usePermissionStore().removeForDataset(id);
        datasets.value = datasets.value.filter((d) => d.id !== id);
    }

    /** Loads all datasets from the backend into the store; records a failure in loadFailed and still rejects so callers can react */
    async function fetchDatasets() {
        const request = ++latestList;
        listRequests++;
        try {
            const list = await datasetApi.getDatasets();
            // Only the newest request may replace the list, so a slow older response cannot undo a newer one
            if (request === latestList) {
                for (const [id, changed] of changedDuringFetch) {
                    const i = list.findIndex((d) => d.id === id);
                    if (i !== -1) list.splice(i, 1);
                    if (changed) list.push(changed);
                }
                datasets.value = list;
                loadFailed.value = false;
            }
        } catch (error) {
            if (request === latestList) loadFailed.value = true;
            throw error;
        } finally {
            if (--listRequests === 0) changedDuringFetch.clear();
        }
    }

    /** Fetches the dataset with this id from the backend, or null if there is none; also stores it in currentDataset unless a newer lookup has started */
    async function getById(id: string) {
        const lookup = ++latestLookup;
        const dataset = await datasetApi.getDataset(id);
        if (lookup === latestLookup) currentDataset.value = dataset;
        return dataset;
    }

    /** Fetches the dataset with this url slug from the backend, or null if there is none; also stores it in currentDataset unless a newer lookup has started */
    async function getByUrl(url: string) {
        const lookup = ++latestLookup;
        const dataset = await datasetApi.getDatasetByUrl(url);
        if (lookup === latestLookup) currentDataset.value = dataset;
        return dataset;
    }

    /** Creates a dataset and adds it to the store */
    async function addDataset(payload: CreateDatasetPayload) {
        const dataset = await datasetApi.createDataset(payload);
        upsert(dataset);
        return dataset;
    }

    /** Updates a dataset and replaces it in the store (including currentDataset if it is the open one) */
    async function editDataset(id: string, payload: UpdateDatasetPayload) {
        const dataset = await datasetApi.updateDataset(id, payload);
        upsert(dataset);
        return dataset;
    }

    /** Deletes a dataset and removes it from the store (clearing currentDataset if it is the open one) */
    async function removeDataset(id: string) {
        await datasetApi.deleteDataset(id);
        drop(id);
    }

    // Live updates from other users' changes. Reloading after a reconnect catches whatever was missed while offline
    const socket = useSocketStore();
    socket.on(SocketEvent.DATASET_CREATED, ({ dataset }) => upsert(dataset));
    socket.on(SocketEvent.DATASET_UPDATED, ({ dataset }) => upsert(dataset));
    socket.on(SocketEvent.DATASET_DELETED, ({ id }) => drop(id));
    watch(
        () => socket.reconnects,
        () => fetchDatasets().catch(() => {})
    );

    return { datasets, currentDataset, loadFailed, fetchDatasets, getById, getByUrl, addDataset, editDataset, removeDataset };
});

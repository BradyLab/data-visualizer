// Tests for the dataset store's list handling, including pushes that arrive while a list request is in flight
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { IDataset } from "@commons/dataset";
import { datasetApi } from "@src/api/dataset";
import { useDatasetStore } from "@src/stores/dataset";

vi.mock("@src/api/dataset", () => ({
    datasetApi: {
        getDatasets: vi.fn(),
        getDataset: vi.fn(),
        getDatasetByUrl: vi.fn(),
        createDataset: vi.fn(),
        updateDataset: vi.fn(),
        deleteDataset: vi.fn(),
    },
}));
// The store subscribes to websocket events; keep the socket out of these tests
vi.mock("@src/stores/socket", () => ({ useSocketStore: () => ({ on: vi.fn(), off: vi.fn(), socket: null }) }));

const ds = (id: string, name = id) => ({ id, name, url: id }) as unknown as IDataset;

// A promise whose resolution the test controls, to order responses
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
};

beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createPinia());
});

describe("fetchDatasets", () => {
    it("replaces the list and clears loadFailed", async () => {
        vi.mocked(datasetApi.getDatasets).mockResolvedValue([ds("a"), ds("b")]);
        const store = useDatasetStore();
        await store.fetchDatasets();
        expect(store.datasets.map((d) => d.id)).toEqual(["a", "b"]);
        expect(store.loadFailed).toBe(false);
    });

    it("sets loadFailed and rethrows on failure", async () => {
        vi.mocked(datasetApi.getDatasets).mockRejectedValue(new Error("down"));
        const store = useDatasetStore();
        await expect(store.fetchDatasets()).rejects.toThrow("down");
        expect(store.loadFailed).toBe(true);
    });

    it("ignores a slow older response once a newer request has finished", async () => {
        const slow = deferred<IDataset[]>();
        vi.mocked(datasetApi.getDatasets).mockReturnValueOnce(slow.promise).mockResolvedValueOnce([ds("new")]);
        const store = useDatasetStore();
        const first = store.fetchDatasets();
        await store.fetchDatasets();
        slow.resolve([ds("old")]);
        await first;
        expect(store.datasets.map((d) => d.id)).toEqual(["new"]);
    });
});

describe("addDataset / editDataset / removeDataset", () => {
    it("adds a created dataset and replaces an edited one without duplicating", async () => {
        vi.mocked(datasetApi.createDataset).mockResolvedValue(ds("a", "first"));
        vi.mocked(datasetApi.updateDataset).mockResolvedValue(ds("a", "renamed"));
        const store = useDatasetStore();
        await store.addDataset({} as never);
        await store.editDataset("a", {} as never);
        expect(store.datasets).toHaveLength(1);
        expect(store.datasets[0]!.name).toBe("renamed");
    });

    it("removes a deleted dataset and clears it if it was open", async () => {
        vi.mocked(datasetApi.getDatasets).mockResolvedValue([ds("a"), ds("b")]);
        vi.mocked(datasetApi.getDataset).mockResolvedValue(ds("a"));
        vi.mocked(datasetApi.deleteDataset).mockResolvedValue(undefined);
        const store = useDatasetStore();
        await store.fetchDatasets();
        await store.getById("a");
        await store.removeDataset("a");
        expect(store.datasets.map((d) => d.id)).toEqual(["b"]);
        expect(store.currentDataset).toBeNull();
    });
});

describe("lookups", () => {
    it("lets only the newest lookup set currentDataset", async () => {
        const slow = deferred<IDataset | null>();
        vi.mocked(datasetApi.getDatasetByUrl).mockReturnValueOnce(slow.promise);
        vi.mocked(datasetApi.getDataset).mockResolvedValueOnce(ds("newer"));
        const store = useDatasetStore();
        const first = store.getByUrl("older");
        await store.getById("newer");
        slow.resolve(ds("older"));
        await first;
        expect(store.currentDataset?.id).toBe("newer");
    });
});

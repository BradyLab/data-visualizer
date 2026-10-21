// Tests for the file store: the cover cache, upload progress and the live updates that drop stale covers (the API and the socket are mocked)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { FileTypes } from "@commons/file";
import { SocketEvent } from "@commons/socket";
import { fileApi } from "@src/api/file";
import { useFileStore } from "@src/stores/file";

const socket = vi.hoisted(() => ({ handlers: new Map<string, (...args: never[]) => void>() }));

vi.mock("@src/api/file", () => ({ fileApi: { getCover: vi.fn(), uploadFile: vi.fn(), downloadRds: vi.fn() } }));
vi.mock("@src/stores/socket", () => ({
    useSocketStore: () => ({ on: (event: string, handler: (...args: never[]) => void) => socket.handlers.set(event, handler) }),
}));

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
};

let urls: number;

beforeEach(() => {
    vi.resetAllMocks();
    socket.handlers.clear();
    setActivePinia(createPinia());
    urls = 0;
    // jsdom has no object URLs
    URL.createObjectURL = vi.fn(() => `blob:cover-${++urls}`);
    URL.revokeObjectURL = vi.fn();
});

describe("loadCover", () => {
    it("caches the image as an object URL, and a dataset without a cover as null", async () => {
        vi.mocked(fileApi.getCover)
            .mockResolvedValueOnce(new Blob(["x"]))
            .mockResolvedValueOnce(null);
        const store = useFileStore();
        await store.loadCover("a");
        await store.loadCover("b");
        expect(store.covers).toEqual({ a: "blob:cover-1", b: null });
    });

    it("asks once for a cover that is loaded or loading", async () => {
        const request = deferred<Blob | null>();
        vi.mocked(fileApi.getCover).mockReturnValue(request.promise);
        const store = useFileStore();
        const first = store.loadCover("a");
        const second = store.loadCover("a");
        request.resolve(new Blob(["x"]));
        await Promise.all([first, second]);
        await store.loadCover("a");
        expect(fileApi.getCover).toHaveBeenCalledTimes(1);
    });

    it("rejects without caching when the request fails, so a later call retries", async () => {
        vi.mocked(fileApi.getCover)
            .mockRejectedValueOnce(new Error("down"))
            .mockResolvedValueOnce(new Blob(["x"]));
        const store = useFileStore();
        await expect(store.loadCover("a")).rejects.toThrow("down");
        expect("a" in store.covers).toBe(false);
        await store.loadCover("a");
        expect(store.covers["a"]).toBe("blob:cover-1");
    });

    it("throws away an answer that arrives after clear()", async () => {
        const request = deferred<Blob | null>();
        vi.mocked(fileApi.getCover).mockReturnValue(request.promise);
        const store = useFileStore();
        const loading = store.loadCover("a");
        store.clear();
        request.resolve(new Blob(["x"]));
        await loading;
        expect("a" in store.covers).toBe(false);
    });
});

describe("uploadFile", () => {
    it("shows the label and progress while uploading, then clears them", async () => {
        const request = deferred<void>();
        vi.mocked(fileApi.uploadFile).mockImplementation(async (_id, _type, _file, _notes, onProgress) => {
            onProgress?.(0.5);
            await request.promise;
        });
        const store = useFileStore();
        const uploading = store.uploadFile("d", FileTypes.TISSUE_PLOT, new File(["x"], "map.csv"));
        expect(store.uploading).toEqual({ label: "Uploading tissue map", fraction: 0.5 });
        request.resolve();
        await uploading;
        expect(store.uploading).toBeNull();
    });

    it.each([
        [FileTypes.RDS, "Uploading .rds file"],
        [FileTypes.COVER, "Uploading cover photo"],
    ])("labels a %s upload", async (type, label) => {
        const request = deferred<void>();
        vi.mocked(fileApi.uploadFile).mockReturnValue(request.promise);
        const store = useFileStore();
        const uploading = store.uploadFile("d", type, new File(["x"], "f"));
        expect(store.uploading?.label).toBe(label);
        request.resolve();
        await uploading;
    });

    it("passes the update notes on, and clears the progress when the upload fails", async () => {
        vi.mocked(fileApi.uploadFile).mockRejectedValue(new Error("must have one of these extensions"));
        const store = useFileStore();
        await expect(store.uploadFile("d", FileTypes.RDS, new File(["x"], "a.rds"), "notes")).rejects.toThrow("extensions");
        expect(fileApi.uploadFile).toHaveBeenCalledWith("d", FileTypes.RDS, expect.any(File), "notes", expect.any(Function));
        expect(store.uploading).toBeNull();
    });

    it("a finished upload of a new cover drops the cached one, which the cover component then loads again", async () => {
        vi.mocked(fileApi.getCover).mockResolvedValue(new Blob(["x"]));
        vi.mocked(fileApi.uploadFile).mockResolvedValue(undefined);
        const store = useFileStore();
        await store.loadCover("d");
        await store.uploadFile("d", FileTypes.COVER, new File(["y"], "c.png"));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover-1");
        expect("d" in store.covers).toBe(false);
        await store.loadCover("d");
        expect(fileApi.getCover).toHaveBeenCalledTimes(2);
    });

    it("a cover uploaded while an older request is in flight is requested anew and the old answer is ignored", async () => {
        const stale = deferred<Blob | null>();
        vi.mocked(fileApi.getCover)
            .mockReturnValueOnce(stale.promise)
            .mockResolvedValueOnce(new Blob(["new"]));
        vi.mocked(fileApi.uploadFile).mockResolvedValue(undefined);
        const store = useFileStore();
        const loading = store.loadCover("d");
        await store.uploadFile("d", FileTypes.COVER, new File(["y"], "c.png"));
        stale.resolve(new Blob(["old"]));
        await loading;
        await vi.waitFor(() => expect(store.covers["d"]).toBe("blob:cover-1"));
        expect(fileApi.getCover).toHaveBeenCalledTimes(2);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    });

    it("an upload of another kind leaves the cover alone", async () => {
        vi.mocked(fileApi.getCover).mockResolvedValue(new Blob(["x"]));
        vi.mocked(fileApi.uploadFile).mockResolvedValue(undefined);
        const store = useFileStore();
        await store.loadCover("d");
        await store.uploadFile("d", FileTypes.TISSUE_PLOT, new File(["y"], "map.csv"));
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });
});

describe("downloadRds", () => {
    it("is flagged as downloading until the request ends, even when it fails", async () => {
        const request = deferred<void>();
        vi.mocked(fileApi.downloadRds).mockReturnValue(request.promise);
        const store = useFileStore();
        const downloading = store.downloadRds("d");
        expect(store.downloading).toBe(true);
        request.reject(new Error("403"));
        await expect(downloading).rejects.toThrow("403");
        expect(store.downloading).toBe(false);
    });
});

describe("live updates", () => {
    const fire = (event: SocketEvent, payload: object) => (socket.handlers.get(event) as (p: object) => void)(payload);

    it("drops a cover another user replaced or deleted, but not other files", async () => {
        vi.mocked(fileApi.getCover).mockResolvedValue(new Blob(["x"]));
        const store = useFileStore();
        await store.loadCover("d");
        fire(SocketEvent.FILE_UPLOADED, { file: { type: FileTypes.RDS, dataset_id: "d" } });
        expect(store.covers["d"]).toBe("blob:cover-1");
        fire(SocketEvent.FILE_UPLOADED, { file: { type: FileTypes.COVER, dataset_id: "d" } });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover-1");
        expect("d" in store.covers).toBe(false);
        await store.loadCover("d");
        fire(SocketEvent.FILE_REMOVED, { id: "f", dataset_id: "d", type: FileTypes.TISSUE_PLOT });
        expect(store.covers["d"]).toBe("blob:cover-2");
        fire(SocketEvent.FILE_REMOVED, { id: "f", dataset_id: "d", type: FileTypes.COVER });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cover-2");
        expect("d" in store.covers).toBe(false);
    });
});

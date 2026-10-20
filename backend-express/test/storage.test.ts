// Unit tests for where uploaded files are stored and which extensions each file type accepts (services/storage)
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { FileTypes } from "@commons/file.ts";
import * as storage from "@src/services/storage.ts";

test("a tissue map is stored as <dataset id>_TISSUE_PLOT_v<version>.csv in the tissue folder, where Shiny looks for it", () => {
    const file = { dataset_id: "d1", type: FileTypes.TISSUE_PLOT, version: 3, ogName: "Root.CSV" };
    assert.equal(storage.storedPath(file), path.join(storage.UPLOAD_DIR, "tissue", "d1_TISSUE_PLOT_v3.csv"));
});

test("a tissue map must be a CSV, and every file type has its extensions listed", () => {
    assert.deepEqual(storage.ALLOWED_EXTENSIONS[FileTypes.TISSUE_PLOT], [".csv"]);
    for (const type of Object.values(FileTypes)) assert.ok(storage.ALLOWED_EXTENSIONS[type].length > 0);
});

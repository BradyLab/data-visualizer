// Unit tests for the checks an upload goes through before any bytes are accepted: the field rules of services/file and the metadata parsing of services/tus
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileTypes } from "@commons/file.ts";

process.env.UPLOAD_DIR = await mkdtemp(path.join(os.tmpdir(), "upload-metadata-test-"));
const { validateFileFields } = await import("@src/services/file.ts");
const { parseMetadata } = await import("@src/services/tus.ts");
const storage = await import("@src/services/storage.ts");

test("validateFileFields accepts valid fields and absent ones", () => {
    assert.equal(validateFileFields({}), null);
    assert.equal(validateFileFields({ type: FileTypes.RDS, sizeBytes: 0, ogName: "a.rds", version: 1, updates: null }), null);
});

test("validateFileFields names the first invalid field", () => {
    assert.match(validateFileFields({ type: "NOPE" as FileTypes })!, /type must be one of/);
    assert.match(validateFileFields({ sizeBytes: -1 })!, /sizeBytes/);
    assert.match(validateFileFields({ sizeBytes: 1.5 })!, /sizeBytes/);
    assert.match(validateFileFields({ ogName: "   " })!, /ogName/);
    assert.match(validateFileFields({ ogName: "a".repeat(256) })!, /ogName/);
    assert.match(validateFileFields({ version: 0 })!, /version/);
    assert.match(validateFileFields({ updates: 5 as unknown as string })!, /updates/);
});

const meta = (over: Record<string, string | undefined> = {}) => ({ dataset_id: "d1", type: FileTypes.RDS, filename: "data.rds", ...over });

test("parseMetadata returns typed fields for a complete upload", () => {
    assert.deepEqual(parseMetadata(meta({ version: "3", updates: "notes" }), 10), {
        dataset_id: "d1",
        type: FileTypes.RDS,
        ogName: "data.rds",
        sizeBytes: 10,
        version: 3,
        updates: "notes",
    });
});

test("parseMetadata asks for the required metadata and a known size", () => {
    assert.match(parseMetadata(meta({ dataset_id: undefined }), 1) as string, /dataset_id is required/);
    assert.match(parseMetadata(meta({ type: undefined }), 1) as string, /type is required/);
    assert.match(parseMetadata(meta({ filename: undefined }), 1) as string, /filename is required/);
    assert.match(parseMetadata(meta(), undefined) as string, /size must be known/);
});

test("parseMetadata checks the extension against the file type", () => {
    assert.match(parseMetadata(meta({ filename: "data.csv" }), 1) as string, /must have one of these extensions: \.rds/);
    assert.match(parseMetadata(meta({ type: FileTypes.COVER, filename: "c.txt" }), 1) as string, /extensions/);
    assert.match(parseMetadata(meta({ type: FileTypes.TISSUE_PLOT, filename: "map.rds" }), 1) as string, /extensions: \.csv/);
    assert.equal(typeof parseMetadata(meta({ type: FileTypes.TISSUE_PLOT, filename: "MAP.CSV" }), 1), "object");
});

test("parseMetadata limits the size of covers and tissue maps", () => {
    const cover = meta({ type: FileTypes.COVER, filename: "c.png" });
    assert.equal(typeof parseMetadata(cover, storage.MAX_COVER_BYTES), "object");
    assert.match(parseMetadata(cover, storage.MAX_COVER_BYTES + 1) as string, /at most 20 MB/);
    const tissue = meta({ type: FileTypes.TISSUE_PLOT, filename: "map.csv" });
    assert.equal(typeof parseMetadata(tissue, storage.MAX_TISSUE_PLOT_BYTES), "object");
    assert.match(parseMetadata(tissue, storage.MAX_TISSUE_PLOT_BYTES + 1) as string, /at most 50 MB/);
});

test("parseMetadata takes update notes only for RDS files, and rejects a bad version", () => {
    assert.match(parseMetadata(meta({ type: FileTypes.COVER, filename: "c.png", updates: "x" }), 1) as string, /only allowed on RDS/);
    assert.match(parseMetadata(meta({ version: "0" }), 1) as string, /version/);
    assert.match(parseMetadata(meta({ version: "abc" }), 1) as string, /version/);
});

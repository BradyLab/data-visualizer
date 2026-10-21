// Unit tests for the tissue map check done when a TISSUE_PLOT upload finishes (services/tissue)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tissueMapError, tissueMapFileError } from "@src/services/tissue.ts";

const GOOD = ['"ROI.name","ROI.id","point","x","y"', '"Epidermis",1,1,0.5,1.5', '"Epidermis",1,2,1,2'].join("\n");

test("a ggPlantmap CSV is accepted, with or without the optional columns, quotes, CRLF line ends or a byte order mark", () => {
    assert.equal(tissueMapError(GOOD), null);
    assert.equal(tissueMapError("ROI.name,ROI.id,x,y\nCortex,2,3,4\n"), null);
    assert.equal(tissueMapError(GOOD.replaceAll("\n", "\r\n")), null);
    assert.equal(tissueMapError("﻿" + GOOD), null);
    assert.equal(tissueMapError("x,y,ROI.id,ROI.name,Level1\n1,2,3,Cortex,a\n"), null);
});

test("a map missing a required column says which", () => {
    assert.equal(tissueMapError("ROI.name,x,y\nA,1,2\n"), "The tissue map is missing these columns: ROI.id");
    assert.match(tissueMapError("a,b,c\n1,2,3\n")!, /ROI\.name, ROI\.id, x, y/);
});

test("an empty map, a header only and non-numeric coordinates are refused", () => {
    assert.equal(tissueMapError(""), "The tissue map is empty");
    assert.equal(tissueMapError("\n\n"), "The tissue map is empty");
    assert.equal(tissueMapError("ROI.name,ROI.id,x,y\n"), "The tissue map has no rows");
    assert.match(tissueMapError("ROI.name,ROI.id,x,y\nA,1,left,right\n")!, /must hold numbers/);
    assert.match(tissueMapError("ROI.name,ROI.id,x,y\nA,1,,\n")!, /must hold numbers/);
});

test("quoted fields may contain commas and quotes", () => {
    assert.equal(tissueMapError('"ROI.name","ROI.id","x","y"\n"Cell, ""big""",1,1,2\n'), null);
});

test("an RDS or other binary file is not a tissue map", () => {
    assert.ok(tissueMapError("\u001f\u008b\b\u0000binary\u0000junk"));
});

test("tissueMapFileError reads the file, and only its start", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tissue-test-"));
    try {
        const good = path.join(dir, "good.csv");
        // Far more rows than the sample, so the last line is cut mid-row: the earlier rows still decide
        await writeFile(good, "ROI.name,ROI.id,x,y\n" + "A,1,1.5,2.5\n".repeat(20000));
        assert.equal(await tissueMapFileError(good), null);
        const bad = path.join(dir, "bad.csv");
        await writeFile(bad, "name,x\nA,1\n");
        assert.match((await tissueMapFileError(bad))!, /missing these columns/);
        await assert.rejects(tissueMapFileError(path.join(dir, "missing.csv")));
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

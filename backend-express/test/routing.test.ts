// Unit tests for services/routing: where a preprocessing job runs, and what counts as running out of memory
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    isOutOfMemory,
    localMemoryBudget,
    needsLargeMemory,
    parseSize,
    preprocessConfigProblems,
    processingMode,
    retryRemotelyOnOutOfMemory,
} from "@src/services/routing.ts";

const GB = 1024 ** 3;

test("parseSize reads sizes with a unit, and plain bytes", () => {
    assert.equal(parseSize("24g"), 24 * GB);
    assert.equal(parseSize("24GB"), 24 * GB);
    assert.equal(parseSize("1500MB"), 1500 * 1024 ** 2);
    assert.equal(parseSize("1.5 GiB"), 1.5 * GB);
    assert.equal(parseSize("123456"), 123456);
    for (const bad of ["", undefined, "lots", "-1g", "24 gigs", "g24"]) assert.equal(parseSize(bad), null);
});

test("the mode is local unless PREPROCESS_MODE says auto or remote", () => {
    assert.equal(processingMode({}), "local");
    assert.equal(processingMode({ PREPROCESS_MODE: "" }), "local");
    assert.equal(processingMode({ PREPROCESS_MODE: " Auto " }), "auto");
    assert.equal(processingMode({ PREPROCESS_MODE: "remote" }), "remote");
    assert.equal(processingMode({ PREPROCESS_MODE: "nonsense" }), "local");
});

test("the memory budget is the set limit, else the machine's RAM minus the reserve", () => {
    assert.equal(localMemoryBudget({ PREPROCESS_LOCAL_MEMORY: "24g" }, 64 * GB), 24 * GB);
    assert.equal(localMemoryBudget({}, 32 * GB), 24 * GB);
    assert.equal(localMemoryBudget({ PREPROCESS_MEMORY_RESERVE: "2g" }, 32 * GB), 30 * GB);
    assert.equal(localMemoryBudget({}, 4 * GB), 0);
});

test("local mode never sends a job away, remote mode always does", () => {
    assert.equal(needsLargeMemory(100 * GB, { PREPROCESS_MODE: "local" }, 32 * GB), false);
    assert.equal(needsLargeMemory(100 * GB, {}, 32 * GB), false);
    assert.equal(needsLargeMemory(1, { PREPROCESS_MODE: "remote" }, 32 * GB), true);
});

test("auto mode sends a job away when its estimated memory (file size x ratio) exceeds the budget", () => {
    const env = { PREPROCESS_MODE: "auto", PREPROCESS_LOCAL_MEMORY: "20g", PREPROCESS_MEMORY_RATIO: "4" };
    assert.equal(needsLargeMemory(5 * GB, env), false); // 20 GB: just fits
    assert.equal(needsLargeMemory(5 * GB + 1, env), true);
    assert.equal(needsLargeMemory(25 * GB, env), true);
    // The ratio defaults to 5, the top of the documented range
    assert.equal(needsLargeMemory(4 * GB, { PREPROCESS_MODE: "auto", PREPROCESS_LOCAL_MEMORY: "20g" }), false);
    assert.equal(needsLargeMemory(4 * GB + 1, { PREPROCESS_MODE: "auto", PREPROCESS_LOCAL_MEMORY: "20g" }), true);
});

test("only auto mode retries a job that ran out of memory", () => {
    assert.equal(retryRemotelyOnOutOfMemory({ PREPROCESS_MODE: "auto" }), true);
    assert.equal(retryRemotelyOnOutOfMemory({ PREPROCESS_MODE: "local" }), false);
    assert.equal(retryRemotelyOnOutOfMemory({}), false);
});

test("running out of memory is recognized from SIGKILL, exit code 137 and R's allocation error, and not from other failures", () => {
    assert.equal(isOutOfMemory({ code: null, signal: "SIGKILL", text: "" }), true);
    assert.equal(isOutOfMemory({ code: 137, signal: null, text: "" }), true);
    assert.equal(isOutOfMemory({ code: 1, signal: null, text: "Error: cannot allocate vector of size 12.3 Gb" }), true);
    assert.equal(isOutOfMemory({ code: 1, signal: null, text: "terminate called after throwing std::bad_alloc" }), true);
    assert.equal(isOutOfMemory({ code: 1, signal: null, text: "Error in readRDS(input) : unknown input format" }), false);
    assert.equal(isOutOfMemory({ code: 1, signal: "SIGTERM", text: "" }), false);
    assert.equal(isOutOfMemory({ code: 0, signal: null, text: "" }), false);
});

test("preprocessConfigProblems names a bad mode, a mode without the worker's secret, and bad sizes", () => {
    assert.deepEqual(preprocessConfigProblems({}), []);
    assert.deepEqual(preprocessConfigProblems({ PREPROCESS_MODE: "auto", REMOTE_WORKER_TOKEN: "x".repeat(40) }), []);
    assert.match(preprocessConfigProblems({ PREPROCESS_MODE: "turbo" })[0]!, /PREPROCESS_MODE must be local, auto or remote/);
    assert.match(preprocessConfigProblems({ PREPROCESS_MODE: "auto" })[0]!, /needs REMOTE_WORKER_TOKEN/);
    assert.match(preprocessConfigProblems({ PREPROCESS_MODE: "remote" })[0]!, /needs REMOTE_WORKER_TOKEN/);
    assert.match(preprocessConfigProblems({ PREPROCESS_LOCAL_MEMORY: "lots" })[0]!, /PREPROCESS_LOCAL_MEMORY must be a size/);
    assert.match(preprocessConfigProblems({ PREPROCESS_MEMORY_RATIO: "0" })[0]!, /PREPROCESS_MEMORY_RATIO/);
});

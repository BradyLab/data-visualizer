// Runs the real shiny/preprocess/refresh-image.sh (bash) with a fake curl (the registry) and a fake apptainer (the pull), to check when the
// cluster's .sif is replaced: only when the registry's digest differs, never by a failed or broken pull, and with the old one kept
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const script = path.resolve(import.meta.dirname, "../../shiny/preprocess/refresh-image.sh");
const root = await mkdtemp(path.join(os.tmpdir(), "refresh-image-test-"));
const bin = path.join(root, "bin");
const callLog = path.join(root, "calls.log");
const D1 = `sha256:${"1".repeat(64)}`;
const D2 = `sha256:${"2".repeat(64)}`;
let dir: string;
let image: string;

before(async () => {
    await mkdir(bin);
    // Registry: a token request answers JSON, a manifest HEAD request answers the headers with FAKE_DIGEST. Every call is logged
    await writeFile(
        path.join(bin, "curl"),
        `#!/bin/bash
echo "curl $*" >> "${callLog}"
[ -n "\${FAKE_REGISTRY_DOWN:-}" ] && exit 22
case "$*" in
    *"/token?"*) echo '{"token":"abc123","access_token":"abc123"}' ;;
    *"/manifests/"*) printf 'HTTP/2 200\\r\\ncontent-type: x\\r\\ndocker-content-digest: %s\\r\\n\\r\\n' "$FAKE_DIGEST" ;;
    *) exit 22 ;;
esac
`
    );
    // Apptainer: pull writes a file naming the digest it was asked for; exec (the check for /preprocess.R) succeeds unless told otherwise
    await writeFile(
        path.join(bin, "apptainer"),
        `#!/bin/bash
echo "apptainer $*" >> "${callLog}"
case "$1" in
    pull) [ -n "\${FAKE_PULL_FAILS:-}" ] && exit 1; echo "image of \${4#*@}" > "$3" ;;
    exec) [ -n "\${FAKE_NO_SCRIPT:-}" ] && exit 1; exit 0 ;;
    *) exit 64 ;;
esac
`
    );
    await chmod(path.join(bin, "curl"), 0o755);
    await chmod(path.join(bin, "apptainer"), 0o755);
});
after(() => rm(root, { recursive: true, force: true }));
beforeEach(async () => {
    dir = await mkdtemp(path.join(root, "case-"));
    image = path.join(dir, "preprocess.sif");
    await writeFile(callLog, "");
});

const run = (env: Record<string, string> = {}) =>
    new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn("bash", [script], {
            env: {
                PATH: `${bin}:${process.env.PATH}`,
                PREPROCESS_IMAGE: image,
                FAKE_DIGEST: D1,
                ...env,
            } as unknown as NodeJS.ProcessEnv,
        });
        let output = "";
        child.stdout.on("data", (d) => (output += d));
        child.stderr.on("data", (d) => (output += d));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
    });

const pulls = async () => (await readFile(callLog, "utf8")).split("\n").filter((l) => l.startsWith("apptainer pull"));
const read = (file: string) => readFile(file, "utf8").then((s) => s.trim());
const names = async () => (await readdir(dir)).filter((n) => !n.endsWith(".lock")).sort();

test("with no image yet, the first run pulls it by digest and records the digest", async () => {
    const { code, output } = await run();
    assert.equal(code, 0, output);
    assert.equal(await read(image), `image of ${D1}`);
    assert.equal(await read(`${image}.digest`), D1);
    assert.equal((await pulls()).length, 1);
    assert.match((await pulls())[0]!, new RegExp(`docker://ghcr.io/bradylab/data-visualizer-preprocess@${D1}`));
    assert.deepEqual(await names(), ["preprocess.sif", "preprocess.sif.digest"]);
});

test("an image whose digest has not changed is not pulled again", async () => {
    await run();
    const { code, output } = await run();
    assert.equal(code, 0, output);
    assert.equal((await pulls()).length, 1);
    assert.match(output, /up to date/);
});

test("a new digest replaces the image and keeps the old one as .prev", async () => {
    await run();
    const { code, output } = await run({ FAKE_DIGEST: D2 });
    assert.equal(code, 0, output);
    assert.equal(await read(image), `image of ${D2}`);
    assert.equal(await read(`${image}.prev`), `image of ${D1}`);
    assert.equal(await read(`${image}.digest`), D2);
    assert.deepEqual(await names(), ["preprocess.sif", "preprocess.sif.digest", "preprocess.sif.prev"]);
});

test("when the registry cannot be reached the current image is kept and the job may go on", async () => {
    await run();
    const { code, output } = await run({ FAKE_REGISTRY_DOWN: "1" });
    assert.equal(code, 0, output);
    assert.match(output, /Keeping the current/);
    assert.equal(await read(image), `image of ${D1}`);
});

test("when the registry cannot be reached and there is no image, it fails", async () => {
    const { code, output } = await run({ FAKE_REGISTRY_DOWN: "1" });
    assert.equal(code, 1, output);
    assert.match(output, /no .*to fall back on/);
});

test("a failed pull keeps the current image and leaves nothing behind", async () => {
    await run();
    const { code, output } = await run({ FAKE_DIGEST: D2, FAKE_PULL_FAILS: "1" });
    assert.equal(code, 0, output);
    assert.equal(await read(image), `image of ${D1}`);
    assert.equal(await read(`${image}.digest`), D1, "the recorded digest still names the file in use");
    assert.deepEqual(await names(), ["preprocess.sif", "preprocess.sif.digest"]);
});

test("a new image without /preprocess.R is not switched to", async () => {
    await run();
    const { code, output } = await run({ FAKE_DIGEST: D2, FAKE_NO_SCRIPT: "1" });
    assert.equal(code, 0, output);
    assert.match(output, /does not contain \/preprocess\.R/);
    assert.equal(await read(image), `image of ${D1}`);
    assert.deepEqual(await names(), ["preprocess.sif", "preprocess.sif.digest"]);
});

test("PREPROCESS_TAG and IMAGE_REPO choose what is followed", async () => {
    const { code, output } = await run({ PREPROCESS_TAG: "v1.2", IMAGE_REPO: "ghcr.io/other/preprocess" });
    assert.equal(code, 0, output);
    const calls = await readFile(callLog, "utf8");
    assert.match(calls, /repository:other\/preprocess:pull/);
    assert.match(calls, /\/v2\/other\/preprocess\/manifests\/v1\.2/);
});

test("a malformed digest from the registry is not trusted", async () => {
    const { code, output } = await run({ FAKE_DIGEST: "sha256:not-a-digest" });
    assert.equal(code, 1, output);
    assert.equal((await pulls()).length, 0);
});

test("anything but a .sif, and REFRESH_IMAGE=0, are left alone", async () => {
    let result = await run({ PREPROCESS_IMAGE: "docker://ghcr.io/x/y:latest" });
    assert.equal(result.code, 0, result.output);
    await writeFile(image, "mine");
    result = await run({ REFRESH_IMAGE: "0", FAKE_DIGEST: D2 });
    assert.equal(result.code, 0, result.output);
    assert.equal(await read(image), "mine");
    assert.equal((await readFile(callLog, "utf8")).trim(), "");
});

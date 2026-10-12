// Stands in for shiny/preprocess/preprocess.R in the processing tests: the input file's text says what to do
// "ok" publishes a cells.parquet like the real script (build <output>.tmp, then rename), "fail" prints an R-style error and exits 1,
// "slow" waits a long time (to be killed)
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
const mode = readFileSync(input, "utf8").trim();
if (mode === "fail") {
    console.error("Reading input\nError in readRDS(input) : unknown input format");
    process.exit(1);
}
if (mode === "slow") setTimeout(() => {}, 60_000);
else {
    mkdirSync(`${output}.tmp`, { recursive: true });
    writeFileSync(`${output}.tmp/cells.parquet`, "x");
    rmSync(output, { recursive: true, force: true }); // like the real script, which replaces an existing folder
    renameSync(`${output}.tmp`, output);
}

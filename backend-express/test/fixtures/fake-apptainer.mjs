#!/usr/bin/env node
// Stands in for `apptainer exec --cleanenv --bind <job dir>:/job <image> Rscript /preprocess.R /job/input.rds /job/out/dataset` in the tests of
// shiny/preprocess/cluster/cluster-worker.sh. The input file's text says what to do: "ok" writes the Parquet files like preprocess.R does,
// "fail" prints an R-style error and exits 1, "oom" exits 137 like a process killed for memory, "slow" waits a long time (to be stopped)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "exec") {
    console.error(`unexpected apptainer command: ${args.join(" ")}`);
    process.exit(64);
}
const bind = args[args.indexOf("--bind") + 1];
const jobDir = bind.split(":")[0];
const mode = readFileSync(`${jobDir}/input.rds`, "utf8").trim();

if (mode === "fail") {
    console.error("Reading /job/input.rds\nError in readRDS(input) : unknown input format");
    process.exit(1);
}
if (mode === "oom") process.exit(137);
if (mode === "slow") {
    setTimeout(() => {}, 60_000);
} else {
    mkdirSync(`${jobDir}/out/dataset`, { recursive: true });
    for (const name of ["cells", "genes", "expression", "column_levels", "scale_data"])
        writeFileSync(`${jobDir}/out/dataset/${name}.parquet`, `${name} made from ${mode}`);
}

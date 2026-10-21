// Checks an uploaded tissue map (the CSV of a ggPlantmap table, see shiny/README.md) before it is stored, so a wrong file is refused at upload
// instead of leaving the tissue plot silently empty. Only the header and the first rows are read: the file can be up to 50 MB
import { open } from "node:fs/promises";

// Columns the tissue plot cannot draw without (`point` and the Level columns are optional, see shiny/README.md)
export const REQUIRED_TISSUE_COLUMNS = ["ROI.name", "ROI.id", "x", "y"] as const;

// How much of the file is looked at; far more than a header line plus a few rows
const SAMPLE_BYTES = 64 * 1024;

// Splits one CSV line into fields, honoring double quotes (write.csv quotes every field and doubles quotes inside one)
const splitCsvLine = (line: string) => {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
            if (c === '"' && line[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") {
            fields.push(field);
            field = "";
        } else field += c;
    }
    fields.push(field);
    return fields;
};

/**
 * Returns an error message if the CSV text is not a usable tissue map, or null if it is: the header must name every required column,
 * and there must be at least one row whose x and y are numbers
 */
export const tissueMapError = (text: string) => {
    // A byte order mark (Excel adds one) would make the first column name not match
    const lines = (text.startsWith("\uFEFF") ? text.slice(1) : text).split(/\r?\n/).filter((line) => line.trim() !== "");
    if (lines.length === 0) return "The tissue map is empty";
    const header = splitCsvLine(lines[0]!).map((name) => name.trim());
    const missing = REQUIRED_TISSUE_COLUMNS.filter((name) => !header.includes(name));
    if (missing.length) return `The tissue map is missing these columns: ${missing.join(", ")}`;
    const xIndex = header.indexOf("x");
    const yIndex = header.indexOf("y");
    const rows = lines.slice(1).map(splitCsvLine);
    if (rows.length === 0) return "The tissue map has no rows";
    const numeric = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isFinite(Number(value));
    if (!rows.some((row) => numeric(row[xIndex]) && numeric(row[yIndex])))
        return "The x and y columns of the tissue map must hold numbers";
    return null;
};

/** Reads the start of the file at the path and returns the same as tissueMapError */
export const tissueMapFileError = async (path: string) => {
    const handle = await open(path, "r");
    try {
        const buffer = Buffer.alloc(SAMPLE_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, SAMPLE_BYTES, 0);
        return tissueMapError(buffer.subarray(0, bytesRead).toString("utf8"));
    } finally {
        await handle.close();
    }
};

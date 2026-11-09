// Reads a ggPlantmap table (a CSV with one row per outline vertex: ROI.name, ROI.id, x, y and optionally point) in the browser and turns it into
// outlines that can be drawn as SVG polygons. Used by the Plantmap viewer page; nothing is sent to the server.
// The required columns and the way the vertices are ordered follow backend-express/src/services/tissue.ts and shiny/app/app.R

export const REQUIRED_PLANTMAP_COLUMNS = ["ROI.name", "ROI.id", "x", "y"] as const;

// Same colors as COLORBLIND_COLORS in shiny/app/app.R (kept apart for people with color blindness, each at least 3:1 against white)
export const PLANTMAP_COLORS = [
    "#0072B2",
    "#D55E00",
    "#009E73",
    "#CC79A7",
    "#8700F0",
    "#693C1E",
    "#9678FF",
    "#960069",
    "#FF005A",
    "#4B3CB4",
    "#A5004B",
    "#870F87",
    "#964B0F",
    "#5A783C",
    "#E12DC3",
    "#874BF0",
    "#5A96E1",
    "#5A0FC3",
    "#B44B87",
    "#FF2D78",
];

// Largest file the page reads; a tissue map is a few thousand rows, so this is far more than needed and stops a wrong file freezing the tab
export const MAX_PLANTMAP_BYTES = 10 * 1024 * 1024;

export interface IOutline {
    /** The ROI.id as written in the file */
    id: string;
    /** The ROI.name: the tissue or cell type the outline stands for */
    name: string;
    /** The vertices in drawing order */
    points: { x: number; y: number }[];
}

export interface IPlantmap {
    outlines: IOutline[];
    /** Names in the order they first appear, each with its color and the number of outlines that carry it */
    legend: { name: string; color: string; outlines: number }[];
    /** x and y ranges of all vertices */
    bounds: { minX: number; maxX: number; minY: number; maxY: number };
    /** Things worth a look that did not stop the map from being drawn */
    warnings: string[];
}

export type PlantmapResult = { map: IPlantmap; error?: undefined } | { map?: undefined; error: string };

/**
 * Splits CSV text into rows of fields. Handles quoted fields (write.csv quotes every field), doubled quotes inside them, line breaks inside
 * quotes, a byte order mark (Excel adds one) and both line endings; rows that are completely empty are dropped
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    const src = text.startsWith("﻿") ? text.slice(1) : text;
    const endRow = () => {
        row.push(field);
        field = "";
        if (row.some((f) => f.trim() !== "")) rows.push(row);
        row = [];
    };
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (quoted) {
            if (c === '"' && src[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') quoted = false;
            else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ",") {
            row.push(field);
            field = "";
        } else if (c === "\n") endRow();
        else if (c === "\r") {
            if (src[i + 1] === "\n") i++;
            endRow();
        } else field += c;
    }
    // The last line has no line break
    if (field !== "" || row.length > 0) endRow();
    return rows;
}

const isNumber = (value: string | undefined) => value !== undefined && value.trim() !== "" && Number.isFinite(Number(value));

/** Reads the CSV text of a ggPlantmap table; returns the outlines, or the reason the text cannot be drawn */
export function parsePlantmap(text: string): PlantmapResult {
    const rows = parseCsv(text);
    if (rows.length === 0) return { error: "The CSV is empty." };
    const header = rows[0]!.map((name) => name.trim());
    const missing = REQUIRED_PLANTMAP_COLUMNS.filter((name) => !header.includes(name));
    if (missing.length) {
        return {
            error: `The CSV is missing these columns: ${missing.join(", ")}. It has: ${header.filter(Boolean).join(", ") || "no named columns"}.`,
        };
    }
    if (rows.length === 1) return { error: "The CSV has a header but no rows." };
    const col = Object.fromEntries(["ROI.name", "ROI.id", "x", "y"].map((n) => [n, header.indexOf(n)])) as Record<string, number>;
    const pointCol = header.indexOf("point");

    // Vertices per ROI.id, in the order the ids first appear (that order is the drawing order, later outlines on top)
    const byId = new Map<
        string,
        { name: string; names: Set<string>; vertices: { x: number; y: number; point: number; row: number }[] }
    >();
    let skipped = 0;
    rows.slice(1).forEach((r, index) => {
        const x = r[col.x!];
        const y = r[col.y!];
        const id = (r[col["ROI.id"]!] ?? "").trim();
        const name = (r[col["ROI.name"]!] ?? "").trim();
        if (!isNumber(x) || !isNumber(y) || id === "") {
            skipped++;
            return;
        }
        let entry = byId.get(id);
        if (!entry) {
            entry = { name, names: new Set(), vertices: [] };
            byId.set(id, entry);
        }
        entry.names.add(name);
        const point = pointCol >= 0 && isNumber(r[pointCol]) ? Number(r[pointCol]) : entry.vertices.length + 1;
        entry.vertices.push({ x: Number(x), y: Number(y), point, row: index });
    });
    if (byId.size === 0) return { error: "No row has a number in both x and y together with a ROI.id." };

    const warnings: string[] = [];
    if (skipped)
        warnings.push(
            `${skipped} row${skipped === 1 ? " was" : "s were"} skipped because x, y or ROI.id was empty or not a number.`
        );

    const outlines: IOutline[] = [];
    const tooShort: string[] = [];
    const renamed: string[] = [];
    for (const [id, entry] of byId) {
        // Without a usable point column the rows are in drawing order; with one, sort by it (ties keep file order)
        const vertices = pointCol >= 0 ? [...entry.vertices].sort((a, b) => a.point - b.point || a.row - b.row) : entry.vertices;
        if (entry.names.size > 1) renamed.push(id);
        if (vertices.length < 3) tooShort.push(id);
        outlines.push({ id, name: entry.name, points: vertices.map(({ x, y }) => ({ x, y })) });
    }
    if (renamed.length)
        warnings.push(
            `ROI.id ${listIds(renamed)} ${renamed.length === 1 ? "has" : "have"} more than one ROI.name; the first one is used.`
        );
    if (tooShort.length)
        warnings.push(
            `ROI.id ${listIds(tooShort)} ${tooShort.length === 1 ? "has" : "have"} fewer than 3 points, so ${tooShort.length === 1 ? "it is" : "they are"} not a closed shape.`
        );

    const legend: IPlantmap["legend"] = [];
    for (const o of outlines) {
        const item = legend.find((l) => l.name === o.name);
        if (item) item.outlines++;
        else legend.push({ name: o.name, color: PLANTMAP_COLORS[legend.length % PLANTMAP_COLORS.length]!, outlines: 1 });
    }
    if (legend.length > PLANTMAP_COLORS.length)
        warnings.push(
            `There are ${legend.length} different names but only ${PLANTMAP_COLORS.length} colors, so some colors repeat; use the names to tell them apart.`
        );
    if (legend.some((l) => l.name === "")) warnings.push("Some outlines have an empty ROI.name.");

    const all = outlines.flatMap((o) => o.points);
    const xs = all.map((p) => p.x);
    const ys = all.map((p) => p.y);
    // Math.min(...array) overflows the call stack on very large arrays, so reduce instead
    const bounds = {
        minX: xs.reduce((a, b) => Math.min(a, b), Infinity),
        maxX: xs.reduce((a, b) => Math.max(a, b), -Infinity),
        minY: ys.reduce((a, b) => Math.min(a, b), Infinity),
        maxY: ys.reduce((a, b) => Math.max(a, b), -Infinity),
    };
    return { map: { outlines, legend, bounds, warnings } };
}

// "1, 2 and 3", cut after a few so a badly broken file does not produce a wall of text
function listIds(ids: string[]) {
    const shown = ids.slice(0, 5);
    const rest = ids.length - shown.length;
    return shown.join(", ") + (rest > 0 ? ` and ${rest} more` : "");
}

/** The SVG points attribute of an outline; with `flipY` the y axis runs upward like a ggplot (image coordinates run downward) */
export function svgPoints(outline: IOutline, bounds: IPlantmap["bounds"], flipY: boolean) {
    return outline.points.map((p) => `${p.x},${flipY ? bounds.minY + bounds.maxY - p.y : p.y}`).join(" ");
}

/** The middle of the outline's bounding box, where its label goes (the same spot the dataset viewer uses) */
export function labelPosition(outline: IOutline, bounds: IPlantmap["bounds"], flipY: boolean) {
    const xs = outline.points.map((p) => p.x);
    const ys = outline.points.map((p) => p.y);
    const x = (xs.reduce((a, b) => Math.min(a, b), Infinity) + xs.reduce((a, b) => Math.max(a, b), -Infinity)) / 2;
    const y = (ys.reduce((a, b) => Math.min(a, b), Infinity) + ys.reduce((a, b) => Math.max(a, b), -Infinity)) / 2;
    return { x, y: flipY ? bounds.minY + bounds.maxY - y : y };
}

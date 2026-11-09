<script setup lang="ts">
// Plantmap viewer: draws a ggPlantmap CSV (ROI.name, ROI.id, x, y and optionally point) that is chosen as a file or pasted, to check its shapes and
// names. Everything happens in the browser; the CSV is not uploaded and is not tied to a dataset
import { computed, ref, useId } from "vue";
import { announce } from "@src/utils/announce";
import {
    labelPosition,
    MAX_PLANTMAP_BYTES,
    parsePlantmap,
    REQUIRED_PLANTMAP_COLUMNS,
    svgPoints,
    type IPlantmap,
} from "@src/utils/plantmap";

const titleId = useId();
const descId = useId();

// The pasted text, the file that was chosen last (its name is shown), the drawn map and what went wrong
const pasted = ref("");
const fileName = ref("");
const map = ref<IPlantmap | null>(null);
const error = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

// Display options: outline names on the shapes, and the y axis direction (ggplot draws y upward; image coordinates run downward)
const showLabels = ref(false);
const flipY = ref(true);

// The name picked in the legend; the other outlines fade so the shapes carrying it stand out. (Hovering only shows the browser's tooltip:
// a mouse-only highlight would give keyboard users nothing, and the legend buttons work for everyone)
const picked = ref<string | null>(null);

// Draws the CSV text, or shows why it cannot be drawn. `source` names where the text came from, for the announcement
function draw(text: string, source: string) {
    picked.value = null;
    const result = parsePlantmap(text);
    if (result.error !== undefined) {
        map.value = null;
        error.value = result.error;
        return;
    }
    error.value = "";
    map.value = result.map;
    const { outlines, legend, warnings } = result.map;
    announce(
        `Drew ${outlines.length} outline${outlines.length === 1 ? "" : "s"} with ${legend.length} name${legend.length === 1 ? "" : "s"} from ${source}.` +
            (warnings.length ? ` ${warnings.length} warning${warnings.length === 1 ? "" : "s"}, listed under the buttons.` : "")
    );
}

// A chosen file is drawn at once, and replaces whatever was pasted
async function onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName.value = file.name;
    if (file.size > MAX_PLANTMAP_BYTES) {
        map.value = null;
        error.value = `${file.name} is larger than ${MAX_PLANTMAP_BYTES / 1024 / 1024} MB, which is far more than a tissue map needs. Is it the right file?`;
        return;
    }
    try {
        pasted.value = "";
        draw(await file.text(), file.name);
    } catch {
        map.value = null;
        error.value = `${file.name} could not be read.`;
    }
}

// Pasted text is drawn on the button; a file chosen earlier is forgotten
function drawPasted() {
    if (fileInput.value) fileInput.value.value = "";
    fileName.value = "";
    if (pasted.value.trim() === "") {
        map.value = null;
        error.value = "Paste the CSV text first.";
        return;
    }
    draw(pasted.value, "the pasted text");
}

function clearAll() {
    pasted.value = "";
    fileName.value = "";
    if (fileInput.value) fileInput.value.value = "";
    map.value = null;
    error.value = "";
    picked.value = null;
    announce("Cleared.");
}

// Legend buttons: pressing one again lets go
function pick(name: string) {
    picked.value = picked.value === name ? null : name;
}

const colorOf = computed(() => new Map(map.value?.legend.map((l) => [l.name, l.color]) ?? []));
const nameText = (name: string) => name || "(no name)";

// The SVG's box: the data range with a margin, so strokes and labels at the edge are not cut off
const viewBox = computed(() => {
    if (!map.value) return "0 0 1 1";
    const { minX, maxX, minY, maxY } = map.value.bounds;
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;
    const pad = Math.max(width, height) * 0.03;
    return `${minX - pad} ${minY - pad} ${width + 2 * pad} ${height + 2 * pad}`;
});
// Label size in data units, so it is the same fraction of the map whatever the coordinates are (pixels, microns, ...)
const labelSize = computed(() => {
    if (!map.value) return 1;
    const { minX, maxX, minY, maxY } = map.value.bounds;
    return Math.max(maxX - minX, maxY - minY, 1) / 45;
});

const drawn = computed(() =>
    (map.value?.outlines ?? []).map((outline) => ({
        outline,
        points: svgPoints(outline, map.value!.bounds, flipY.value),
        label: labelPosition(outline, map.value!.bounds, flipY.value),
        color: colorOf.value.get(outline.name) ?? "#767676",
        // Under 3 points there is no shape to fill; it is listed in the warnings
        closed: outline.points.length >= 3,
    }))
);

// The sentence a screen reader hears for the picture; the table under it holds the details
const description = computed(() => {
    if (!map.value) return "";
    const { outlines, legend } = map.value;
    const names = legend.map((l) => nameText(l.name)).join(", ");
    return `${outlines.length} outline${outlines.length === 1 ? "" : "s"} in ${legend.length} color-coded name${legend.length === 1 ? "" : "s"}: ${names}. The outlines are also listed in a table below.`;
});
</script>

<template>
    <v-container class="px-12">
        <h1 class="text-h6 font-weight-bold mb-4">PLANTMAP VIEWER</h1>
        <p class="mb-4">
            Check the shapes and names of a ggPlantmap table without adding it to a dataset. Choose the CSV file or paste its
            text, including the header line. It needs the columns {{ REQUIRED_PLANTMAP_COLUMNS.join(", ") }} and may have a
            <code>point</code> column that orders the corners of each outline. The file stays in your browser and is not uploaded.
        </p>

        <v-row>
            <v-col cols="12" md="5">
                <!-- A plain file input: it is named by its label and works with the keyboard and screen readers as the browser provides it -->
                <label for="plantmap-file" class="d-block font-weight-medium mb-1">
                    CSV file
                    <input
                        id="plantmap-file"
                        ref="fileInput"
                        type="file"
                        accept=".csv,text/csv,text/plain"
                        class="d-block mb-1 font-weight-regular"
                        aria-describedby="plantmap-file-hint"
                        @change="onFile"
                    />
                </label>
                <p id="plantmap-file-hint" class="text-body-2 mb-4">The map is drawn as soon as you choose a file.</p>
                <p v-if="fileName" class="text-body-2 mb-4">Showing: {{ fileName }}</p>
            </v-col>
            <v-col cols="12" md="7">
                <v-textarea v-model="pasted" label="Or paste the CSV text" rows="6" spellcheck="false" autocomplete="off" />
                <div class="d-flex ga-2 mt-3">
                    <v-btn color="primary" @click="drawPasted">Draw pasted text</v-btn>
                    <v-btn variant="outlined" @click="clearAll">Clear</v-btn>
                </div>
            </v-col>
        </v-row>

        <!-- Vuetify alerts are role="alert", so a problem is read out when it appears -->
        <v-alert v-if="error" type="error" variant="tonal" class="my-4">{{ error }}</v-alert>
        <v-alert v-if="map && map.warnings.length" type="warning" variant="tonal" class="my-4" role="status">
            <ul class="pl-4">
                <li v-for="warning in map.warnings" :key="warning">{{ warning }}</li>
            </ul>
        </v-alert>

        <section v-if="map" class="mt-6" aria-labelledby="plantmap-result">
            <h2 id="plantmap-result" class="text-subtitle-1 font-weight-bold mb-2">MAP</h2>

            <div class="d-flex flex-wrap ga-6 mb-2">
                <v-checkbox v-model="showLabels" label="Show names on the shapes" density="compact" hide-details />
                <v-checkbox v-model="flipY" label="Y axis points up (like ggplot)" density="compact" hide-details />
            </div>

            <v-row>
                <v-col cols="12" md="9">
                    <svg
                        class="plantmap-svg"
                        :viewBox="viewBox"
                        preserveAspectRatio="xMidYMid meet"
                        role="img"
                        :aria-labelledby="`${titleId} ${descId}`"
                    >
                        <title :id="titleId">ggPlantmap outlines</title>
                        <desc :id="descId">{{ description }}</desc>
                        <polygon
                            v-for="item in drawn"
                            :key="item.outline.id"
                            :points="item.points"
                            :fill="item.closed ? item.color : 'none'"
                            :fill-opacity="picked === null || picked === item.outline.name ? 0.85 : 0.15"
                            :stroke="picked === item.outline.name ? '#000000' : '#262626'"
                            :stroke-width="picked === item.outline.name ? 2.5 : 1"
                            stroke-linejoin="round"
                            vector-effect="non-scaling-stroke"
                        >
                            <!-- The browser's own tooltip on hover (screen readers use the table below) -->
                            <title>{{ nameText(item.outline.name) }} (ROI.id {{ item.outline.id }})</title>
                        </polygon>
                        <!-- White halo around the dark text keeps names readable on every fill color -->
                        <g
                            v-if="showLabels"
                            aria-hidden="true"
                            :font-size="labelSize"
                            text-anchor="middle"
                            dominant-baseline="central"
                        >
                            <text
                                v-for="item in drawn"
                                :key="item.outline.id"
                                :x="item.label.x"
                                :y="item.label.y"
                                fill="#000000"
                                stroke="#ffffff"
                                :stroke-width="labelSize / 5"
                                paint-order="stroke"
                            >
                                {{ nameText(item.outline.name) }}
                            </text>
                        </g>
                    </svg>
                </v-col>

                <v-col cols="12" md="3">
                    <h3 class="text-subtitle-2 font-weight-bold mb-2">Legend</h3>
                    <p class="text-body-2 mb-2">Press a name to highlight its shapes.</p>
                    <ul class="plantmap-legend">
                        <li v-for="item in map.legend" :key="item.name">
                            <button
                                type="button"
                                class="plantmap-legend-item"
                                :aria-pressed="picked === item.name"
                                @click="pick(item.name)"
                            >
                                <span class="plantmap-swatch" :style="{ background: item.color }" aria-hidden="true"></span>
                                {{ nameText(item.name) }}
                                <span class="text-medium-emphasis">({{ item.outlines }})</span>
                            </button>
                        </li>
                    </ul>
                </v-col>
            </v-row>

            <!-- The same information as text, for anyone who cannot make out the colors or the picture -->
            <details class="mt-4">
                <summary class="font-weight-medium">Show the outlines as a table</summary>
                <v-table density="compact" class="mt-2">
                    <caption class="visually-hidden">
                        Outlines of the map with their name, ROI.id, number of points and color
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">ROI.name</th>
                            <th scope="col">ROI.id</th>
                            <th scope="col">Points</th>
                            <th scope="col">Color</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="item in drawn" :key="item.outline.id">
                            <td>{{ nameText(item.outline.name) }}</td>
                            <td>{{ item.outline.id }}</td>
                            <td>{{ item.outline.points.length }}</td>
                            <td>
                                <span class="plantmap-swatch" :style="{ background: item.color }" aria-hidden="true"></span>
                                {{ item.color }}
                            </td>
                        </tr>
                    </tbody>
                </v-table>
            </details>
        </section>
    </v-container>
</template>

<style scoped>
.plantmap-svg {
    width: 100%;
    max-height: 70vh;
    border: 1px solid #767676;
    border-radius: 4px;
    background: #ffffff;
}
.plantmap-legend {
    list-style: none;
    padding: 0;
}
.plantmap-legend-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 32px;
    padding: 2px 6px;
    border: 2px solid transparent;
    border-radius: 4px;
    text-align: left;
}
/* A pressed button is marked by its border as well as by aria-pressed, so it does not rely on color alone */
.plantmap-legend-item[aria-pressed="true"] {
    border-color: currentColor;
    font-weight: 700;
}
.plantmap-swatch {
    display: inline-block;
    flex: none;
    width: 16px;
    height: 16px;
    border: 1px solid #262626;
    border-radius: 3px;
    vertical-align: middle;
}
</style>

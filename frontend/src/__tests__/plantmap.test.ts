// Tests for the ggPlantmap CSV reader behind the Plantmap viewer: parsing, validation messages, vertex order, legend colors and SVG helpers
import { describe, expect, it } from "vitest";
import { labelPosition, parseCsv, parsePlantmap, PLANTMAP_COLORS, svgPoints } from "@src/utils/plantmap";

const csv = (...lines: string[]) => lines.join("\n");
const ok = (text: string) => {
    const result = parsePlantmap(text);
    if (result.error !== undefined) throw new Error(result.error);
    return result.map;
};

describe("parseCsv", () => {
    it("handles quotes, doubled quotes, line breaks inside quotes, CRLF, a byte order mark and a missing final line break", () => {
        expect(parseCsv('﻿"a","b ""q"""\r\n"x\ny",2\r\n3,4')).toEqual([
            ["a", 'b "q"'],
            ["x\ny", "2"],
            ["3", "4"],
        ]);
    });

    it("drops empty lines but keeps empty fields", () => {
        expect(parseCsv("a,b\n\n,\n1,\n")).toEqual([
            ["a", "b"],
            ["1", ""],
        ]);
    });
});

describe("parsePlantmap errors", () => {
    it("refuses empty text", () => {
        expect(parsePlantmap("  \n").error).toBe("The CSV is empty.");
    });

    it("names the missing columns and the ones found", () => {
        expect(parsePlantmap("ROI.name,x\nA,1").error).toBe("The CSV is missing these columns: ROI.id, y. It has: ROI.name, x.");
    });

    it("refuses a header without rows, and rows without numbers", () => {
        expect(parsePlantmap("ROI.name,ROI.id,x,y").error).toBe("The CSV has a header but no rows.");
        expect(parsePlantmap(csv("ROI.name,ROI.id,x,y", "A,1,a,b")).error).toMatch(/No row has a number/);
    });
});

describe("parsePlantmap", () => {
    const square = (id: number, name: string, dx = 0) => [
        `"${name}",${id},1,${dx},0`,
        `"${name}",${id},2,${dx + 1},0`,
        `"${name}",${id},3,${dx + 1},1`,
        `"${name}",${id},4,${dx},1`,
    ];

    it("groups vertices into outlines in the order the ids first appear and reports the bounds", () => {
        const map = ok(csv('"ROI.name","ROI.id","point","x","y"', ...square(1, "Epidermis"), ...square(2, "Cortex", 2)));
        expect(map.outlines.map((o) => [o.id, o.name, o.points.length])).toEqual([
            ["1", "Epidermis", 4],
            ["2", "Cortex", 4],
        ]);
        expect(map.bounds).toEqual({ minX: 0, maxX: 3, minY: 0, maxY: 1 });
        expect(map.warnings).toEqual([]);
    });

    it("orders the vertices by the point column, and by row order without one", () => {
        const withPoint = ok(csv("ROI.name,ROI.id,point,x,y", "A,1,3,3,3", "A,1,1,1,1", "A,1,2,2,2"));
        expect(withPoint.outlines[0]!.points.map((p) => p.x)).toEqual([1, 2, 3]);
        const without = ok(csv("ROI.name,ROI.id,x,y", "A,1,3,3", "A,1,1,1", "A,1,2,2"));
        expect(without.outlines[0]!.points.map((p) => p.x)).toEqual([3, 1, 2]);
    });

    it("gives outlines with the same name the same color and each new name the next color", () => {
        const map = ok(csv("ROI.name,ROI.id,x,y", ...["A,1", "B,2", "A,3"].flatMap((r) => [`${r},0,0`, `${r},1,0`, `${r},1,1`])));
        expect(map.legend).toEqual([
            { name: "A", color: PLANTMAP_COLORS[0], outlines: 2 },
            { name: "B", color: PLANTMAP_COLORS[1], outlines: 1 },
        ]);
    });

    it("warns about skipped rows, short outlines, ids with two names, an empty name and repeated colors", () => {
        const rows = ["ROI.name,ROI.id,x,y", "A,1,0,0", "A,1,1,0", "B,1,1,1", "A,1,x,1", ",2,0,0"];
        const map = ok(csv(...rows));
        expect(map.warnings).toEqual([
            "1 row was skipped because x, y or ROI.id was empty or not a number.",
            "ROI.id 1 has more than one ROI.name; the first one is used.",
            "ROI.id 2 has fewer than 3 points, so it is not a closed shape.",
            "Some outlines have an empty ROI.name.",
        ]);
        const many = ok(csv("ROI.name,ROI.id,x,y", ...Array.from({ length: 21 }, (_, i) => `N${i},${i},${i},0`)));
        expect(many.warnings.some((w) => /only 20 colors/.test(w))).toBe(true);
    });
});

describe("svg helpers", () => {
    const bounds = { minX: 0, maxX: 4, minY: 0, maxY: 10 };
    const outline = {
        id: "1",
        name: "A",
        points: [
            { x: 0, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
        ],
    };

    it("flips y within the bounds only when asked", () => {
        expect(svgPoints(outline, bounds, false)).toBe("0,2 4,2 4,4");
        expect(svgPoints(outline, bounds, true)).toBe("0,8 4,8 4,6");
    });

    it("puts the label at the middle of the bounding box, flipped the same way", () => {
        expect(labelPosition(outline, bounds, false)).toEqual({ x: 2, y: 3 });
        expect(labelPosition(outline, bounds, true)).toEqual({ x: 2, y: 7 });
    });
});

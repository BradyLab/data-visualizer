// Unit tests for utils/prettyDate
import { describe, expect, it } from "vitest";
import { prettyDate } from "@src/utils/prettyDate";

describe("prettyDate", () => {
    it("formats a Date as 'Month day, year at time' in local time", () => {
        expect(prettyDate(new Date(2026, 9, 8, 15, 45))).toBe("October 8, 2026 at 3:45 PM");
    });

    it("accepts ISO strings and epoch milliseconds", () => {
        const date = new Date(2026, 0, 2, 9, 5);
        expect(prettyDate(date.toISOString())).toBe("January 2, 2026 at 9:05 AM");
        expect(prettyDate(date.getTime())).toBe("January 2, 2026 at 9:05 AM");
    });

    it("returns an empty string for invalid input", () => {
        expect(prettyDate("not a date")).toBe("");
        expect(prettyDate(NaN)).toBe("");
    });
});

// Tests for validateForm: it reports whether the form is valid and moves focus to the first invalid field
import { afterEach, describe, expect, it } from "vitest";
import { validateForm } from "@src/utils/validateForm";

afterEach(() => {
    document.body.innerHTML = "";
});

describe("validateForm", () => {
    it("is true, and leaves focus alone, when the form is valid", async () => {
        document.body.innerHTML = '<input id="a" />';
        expect(await validateForm({ validate: async () => ({ valid: true }) })).toBe(true);
        expect(document.activeElement).toBe(document.body);
    });

    it("is false and focuses the first invalid field when the form is not valid", async () => {
        document.body.innerHTML = '<input id="a" /><input id="b" />';
        const form = { validate: async () => ({ valid: false, errors: [{ id: "b" }, { id: "a" }] }) };
        expect(await validateForm(form)).toBe(false);
        expect(document.activeElement?.id).toBe("b");
    });

    it("is false when there is no form yet", async () => {
        expect(await validateForm(null)).toBe(false);
    });
});

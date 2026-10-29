// Tests for renderMarkdown: Markdown becomes HTML, headings sit below the page's own h1, and unsafe HTML is removed
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@src/utils/markdown";

describe("renderMarkdown", () => {
    it("renders formatting, lists and links", () => {
        const html = renderMarkdown("**bold** and _italic_\n\n- one\n- two\n\n[site](https://example.org)");
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("<em>italic</em>");
        expect(html).toContain("<li>one</li>");
        expect(html).toContain('<a href="https://example.org">site</a>');
    });

    it("moves every heading one level down, because the page has its own h1, and stops at h6", () => {
        const html = renderMarkdown("# One\n\n## Two\n\n###### Six");
        expect(html).toContain("<h2>One</h2>");
        expect(html).toContain("<h3>Two</h3>");
        expect(html).toContain("<h6>Six</h6>");
        expect(html).not.toContain("<h1");
    });

    it("removes scripts, event handlers, javascript links, inline styles and form controls", () => {
        const html = renderMarkdown(
            [
                "<script>alert(1)</script>",
                '<img src="x" onerror="alert(1)">',
                "[bad](javascript:alert(1))",
                '<p style="position:fixed">styled</p>',
                '<form action="/steal"><input name="pw"><button>go</button></form>',
            ].join("\n\n")
        );
        expect(html).not.toContain("<script");
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("style=");
        expect(html).not.toMatch(/<(form|input|button)/);
        expect(html).toContain("styled");
    });

    it("gives nothing for empty text", () => {
        expect(renderMarkdown("")).toBe("");
    });
});

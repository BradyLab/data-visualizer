// Turns the Markdown of an editable page into safe HTML. Admins write the text, but everyone sees the result, so it is always sanitized
import { Marked } from "marked";
import DOMPurify from "dompurify";

// The page supplies its own h1 ("ABOUT"), so a "#" in the text becomes an h2, "##" an h3, and so on (h6 at most);
// that keeps one h1 per page and no skipped heading levels
const marked = new Marked({
    gfm: true,
    renderer: {
        heading({ tokens, depth }) {
            const level = Math.min(depth + 1, 6);
            return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
        },
    },
});

/** The Markdown as sanitized HTML: scripts, event handlers, inline styles and form controls are removed */
export function renderMarkdown(source: string): string {
    const html = marked.parse(source, { async: false });
    return DOMPurify.sanitize(html, {
        FORBID_ATTR: ["style"],
        FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    });
}

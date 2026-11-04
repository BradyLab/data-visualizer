// Where the app finds the backend: VITE_BACKEND_URL, the local default when unset, and the page's own origin when empty (production)
import { afterEach, describe, expect, it, vi } from "vitest";

const load = async () => {
    vi.resetModules();
    return import("@src/interfaces/general");
};

describe("baseOrigin and baseURL", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("uses VITE_BACKEND_URL when it is set", async () => {
        vi.stubEnv("VITE_BACKEND_URL", "https://api.example.org");
        vi.stubEnv("VITE_API_PATH", "/api");
        const { baseOrigin, baseURL } = await load();
        expect(baseOrigin).toBe("https://api.example.org");
        expect(baseURL).toBe("https://api.example.org/api");
    });

    it("falls back to the local backend when it is not set", async () => {
        vi.stubEnv("VITE_BACKEND_URL", undefined as unknown as string);
        const { baseOrigin } = await load();
        expect(baseOrigin).toBe("http://localhost:3001");
    });

    it("uses the page's own origin when it is empty, so one build works for any domain", async () => {
        vi.stubEnv("VITE_BACKEND_URL", "");
        vi.stubEnv("VITE_API_PATH", "/api");
        const { baseOrigin, baseURL } = await load();
        expect(baseOrigin).toBe(window.location.origin);
        expect(baseURL).toBe(`${window.location.origin}/api`);
        // The viewer URL the backend returns is a path, resolved against this origin
        expect(new URL("/shiny/abc?viewer_ticket=t", baseOrigin).origin).toBe(window.location.origin);
    });
});

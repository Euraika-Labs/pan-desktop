import { defineConfig } from "vitest/config";

/**
 * Vitest config for Pan Desktop unit tests.
 *
 * Test files live next to source: `src/main/**\/*.test.ts`.
 * Only main-process / node-side code is tested here. Renderer UI tests
 * will come later (likely via @testing-library/react + happy-dom).
 *
 * We exclude electron imports from tests by default — tests that need
 * electron should mock it explicitly (see desktopPaths.test.ts for an
 * example using vi.mock).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/main/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/out/**"],
    // Most tests should complete in under 1s. Longer runs are probably
    // accidental real subprocess spawns that should be mocked instead.
    testTimeout: 5000,
    // Coverage is not gated for M1 — the point of Wave 1 tests is to
    // lock the abstraction contracts, not hit a coverage number.
  },
  coverage: {
    provider: "v8",
    reporter: ["text", "text-summary", "lcov"],
    include: ["src/main/**/*.ts"],
    exclude: ["src/main/**/*.test.ts", "src/main/generated/**"],
  },
});

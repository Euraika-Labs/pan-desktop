import { defineConfig } from "eslint/config";
import tseslint from "@electron-toolkit/eslint-config-ts";
import eslintConfigPrettier from "@electron-toolkit/eslint-config-prettier";
import eslintPluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import eslintPluginReactRefresh from "eslint-plugin-react-refresh";

export default defineConfig(
  {
    ignores: [
      "**/node_modules",
      "**/dist",
      "**/out",
      // AI assistant skill definitions carried over from upstream fathah/hermes-desktop.
      // Not part of Pan Desktop's app code; intentionally excluded from linting
      // so they don't mask the real CI signal for src/.
      ".agents/**",
      ".claude/**",
      // Historical Windows planning docs from earlier research sessions.
      // Kept for historical reference; see docs/DECISIONS_M1.md for current planning.
      "docs/windows/**",
    ],
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat["jsx-runtime"],
  {
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": eslintPluginReactHooks,
      "react-refresh": eslintPluginReactRefresh,
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
    },
  },
  // ──────────────────────────────────────────────────────────────────────
  // Architectural invariants enforced by ESLint
  //
  // Rules that encode the boundaries in docs/ARCHITECTURE_OVERVIEW.md.
  // Feature code outside src/main/platform/ must not import child_process
  // directly — all subprocess work goes through processRunner. Feature
  // code must not call process.kill(...) or proc.kill("SIGKILL") either.
  //
  // Files still using direct child_process are listed as exceptions here
  // and will be migrated out in Wave 2. Remove entries from the exception
  // list as each file gets migrated onto processRunner.
  // ──────────────────────────────────────────────────────────────────────
  {
    files: ["src/main/**/*.ts"],
    ignores: [
      // The one and only authorized consumer of child_process — this IS
      // the abstraction everything else routes through.
      "src/main/platform/processRunner.ts",
      // Tests spawn processes intentionally to verify behavior.
      "src/main/**/*.test.ts",
      // Wave 2/3 migration targets — remove from this list as each file
      // gets migrated onto processRunner. Current as of 2026-04-11.
      "src/main/claw3d.ts",
      "src/main/hermes.ts",
      "src/main/profiles.ts",
      "src/main/skills.ts",
      "src/main/cronjobs.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "child_process",
              message:
                "Use processRunner from src/main/platform/processRunner.ts. Direct child_process imports bypass the subprocess boundary — see docs/ARCHITECTURE_OVERVIEW.md §Invariants #4.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='process'][callee.property.name='kill']",
          message:
            "Use processRunner.killTree instead of process.kill. Direct process.kill bypasses the tree-kill abstraction and is unsafe across platforms. See docs/ARCHITECTURE_OVERVIEW.md §Invariants #4.",
        },
        {
          selector:
            "CallExpression[callee.property.name='kill'][arguments.0.value='SIGKILL']",
          message:
            "Use processRunner.killTree instead of proc.kill('SIGKILL'). SIGKILL is not a valid Windows signal and does not terminate the process tree.",
        },
      ],
    },
  },
  eslintConfigPrettier,
);

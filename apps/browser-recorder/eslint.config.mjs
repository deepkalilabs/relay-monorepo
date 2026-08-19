import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const featureInternals = {
  group: ["@/features/*/**"],
  message: "Import another feature through its public index.",
};
const appModules = {
  group: ["@/app/**"],
  message: "Application composition must not be imported by lower layers.",
};
const serverModules = {
  group: ["@/server/**"],
  message: "Client modules must not import server implementation code.",
};
const featureModules = {
  group: ["@/features/**"],
  message: "Shared and server modules must not depend on client features.",
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".venv/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    files: ["src/app/**/*.{ts,tsx}"],
    ignores: ["src/app/layout.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [featureInternals, serverModules] }],
    },
  },
  {
    files: ["src/app/layout.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [serverModules] }],
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [featureModules, appModules, serverModules] },
      ],
    },
  },
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [featureModules, appModules, serverModules] },
      ],
    },
  },
  {
    files: ["src/server/**/*.{ts,tsx}", "server.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [featureModules, appModules] }],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [featureInternals] }],
    },
  },
]);

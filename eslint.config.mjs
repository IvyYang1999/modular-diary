// What the Obsidian community plugin scanner checks, as published in
// obsidianmd/eslint-plugin docs/configuration.md ("Full scanner-equivalent
// configuration"), plus the stricter rules it applies to new submissions.
// Not a dependency of the build:
//   npm i --no-save eslint@9 typescript-eslint@8 eslint-plugin-obsidianmd@0.6.0
//   npx eslint .
import { defineConfig, globalIgnores } from "eslint/config"
import obsidianmd from "eslint-plugin-obsidianmd"

export default defineConfig([
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}"],
    rules: {
      // Security: errors in every scan.
      "no-eval": "error",
      "no-unsanitized/method": "error",
      "no-unsanitized/property": "error",
      "obsidianmd/regex-lookbehind": "error",
      "obsidianmd/no-forbidden-elements": "error",
      // Errors for plugins submitted now.
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/no-sample-code": "error",
      "obsidianmd/platform": "error",
      "obsidianmd/no-plugin-as-component": "error",
      "obsidianmd/detach-leaves": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/no-view-references-in-plugin": "error",
      "obsidianmd/no-unsupported-api": "error",
      // Skipped by the scanner.
      "no-undef": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "import/no-unresolved": "off",
    },
  },
  { files: ["**/*.{js,cjs,mjs,jsx}"], rules: { "no-implied-eval": "error" } },
  { files: ["**/*.{ts,cts,mts,tsx}"], rules: { "@typescript-eslint/no-implied-eval": "error" } },
  { files: ["manifest.json"], rules: { "obsidianmd/validate-manifest": "off" } },
  { files: ["LICENSE", "LICENSE.md", "LICENSE.txt"], rules: { "obsidianmd/validate-license": "off" } },
  { linterOptions: { reportUnusedDisableDirectives: "off", reportUnusedInlineConfigs: "off" } },
  globalIgnores([
    "main.js", "**/*.min.js", "**/{dist,build,out,release}/**/*.{js,cjs,mjs,jsx}",
    "node_modules", "dist", "build", "pkg", "test-vault", ".obsidian", "**/.obsidian/**",
    "esbuild.config.mjs", "version-bump.mjs",
    "**/*.test.*", "**/*.tests.*", "**/*.spec.*", "**/*.specs.*", "**/test/**", "**/tests/**", "**/__tests__/**",
    "**/mocks/**", "**/__mocks__/**", "**/*.cjs", "**/*.mjs", "**/*.cts", "**/*.mts", "**/vite*",
    "**/scripts/**", "**/docs/**", "**/i18n/**", "**/i18next/**", "**/locale/**", "**/locales/**",
    "**/translations/**", "**/l10n/**", ".pnpm-store", "**/testUtils**", "automation/**",
    "**/e2e/**", "**/e2e-tests/**", "**/*.e2e.*", "**/wdio.conf.*", "**/wdio.*.conf.*", "**/playwright.config.*",
    "**/{astro,babel,commitlint,docusaurus,esbuild,eslint,jest,oxlint,postcss,prettier,rolldown,rollup,stylelint,svelte,tailwind,tsdown,tsup,uno,webpack}.config.*",
    "**/{eslint,jest}.*.config.*", "**/jest.setup.*", "**/.{babelrc,eslintrc,mocharc,prettierrc}.*",
    // This repo's own non-plugin folders.
    "site/**", "prototypes/**", "skill/**",
  ]),
])

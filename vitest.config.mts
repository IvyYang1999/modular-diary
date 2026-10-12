import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // tests/ holds node:test scripts for the website (node --test), not vitest suites.
    exclude: ["tests/**", "**/node_modules/**"],
  },
})

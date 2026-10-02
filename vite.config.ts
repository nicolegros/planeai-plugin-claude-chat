import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

// The host loads one self-contained ESM file from a blob URL, so CSS is injected
// by the component code and nothing is split into chunks.
export default defineConfig({
  plugins: [svelte({ compilerOptions: { css: "injected" } })],
  build: {
    outDir: "build/ui",
    emptyOutDir: true,
    lib: { entry: "ui/main.ts", formats: ["es"], fileName: () => "chat.js" },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"] },
});

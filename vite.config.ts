import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      input: {
        viewer: resolve(import.meta.dirname, "viewer.html"),
        background: resolve(import.meta.dirname, "src/background.ts"),
      },
      output: {
        // The service worker must live at a stable path referenced by manifest.json.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
  optimizeDeps: {
    // esbuild pre-bundling mangles transformers.js' dynamic WASM loading in dev.
    exclude: ["kokoro-js", "@huggingface/transformers", "pdfjs-dist"],
  },
});

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
      // Bundling breaks the emscripten-generated espeak code inside
      // `phonemizer` (its embedded voice data fails to load, giving
      // "Invalid language identifier … Should be one of: ."). Ship the stock
      // file unmodified and import it at runtime instead.
      external: ["phonemizer"],
      output: {
        // The service worker must live at a stable path referenced by manifest.json.
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        paths: { phonemizer: "../phonemizer.js" },
      },
    },
  },
  optimizeDeps: {
    // esbuild pre-bundling mangles transformers.js' dynamic WASM loading in dev.
    exclude: ["kokoro-js", "@huggingface/transformers", "pdfjs-dist"],
  },
});

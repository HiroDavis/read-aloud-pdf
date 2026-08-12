// Copies the onnxruntime-web WASM runtime out of @huggingface/transformers into
// public/ort so the extension never loads code from a CDN (MV3 forbids remote code).
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = "node_modules/@huggingface/transformers/dist";
const dest = "public/ort";
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.startsWith("ort-wasm") && (f.endsWith(".wasm") || f.endsWith(".mjs"))) {
    cpSync(join(src, f), join(dest, f));
    console.log(`copied ${f}`);
  }
}

// phonemizer is kept external to the bundle (see vite.config.ts) — ship the
// stock file so the runtime import "../phonemizer.js" resolves.
cpSync("node_modules/phonemizer/dist/phonemizer.js", "public/phonemizer.js");
console.log("copied phonemizer.js");

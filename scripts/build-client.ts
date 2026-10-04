#!/usr/bin/env node
// Bundles the browser client. The server runs straight from src/ (Node's
// native TypeScript support, no build step needed there) — only the client
// needs bundling, since a browser can't resolve bare `node_modules` imports
// (here: three) or run TypeScript on its own.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist/client", { recursive: true });

await build({
  entryPoints: ["client/src/main.ts"],
  bundle: true,
  outfile: "dist/client/bundle.js",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  minify: process.env.NODE_ENV === "production",
});

copyFileSync("client/index.html", "dist/client/index.html");
console.log("built dist/client/");

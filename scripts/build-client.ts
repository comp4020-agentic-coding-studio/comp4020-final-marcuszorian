#!/usr/bin/env node
// Bundles the browser client. The server runs straight from src/ (Node's
// native TypeScript support, no build step needed there) — only the client
// needs bundling, since a browser can't resolve bare `node_modules` imports
// (here: three) or run TypeScript on its own.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";

const minified = process.env.NODE_ENV === "production";

mkdirSync("dist/client", { recursive: true });

await build({
  entryPoints: ["client/src/main.ts"],
  bundle: true,
  outfile: "dist/client/bundle.js",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  minify: minified,
});

copyFileSync("client/index.html", "dist/client/index.html");

// Precompress the bundle so the server can hand the compressed bytes straight
// to the wire: 591 KiB raw against 129 KiB of brotli is most of a mobile
// first paint. The obvious alternative was a `compression` middleware, and it
// loses twice — it would re-compress the same unchanging bytes on every cold
// load, and it is a dependency for something node:zlib (built in) does in a
// few lines. Hand-rolled over installed is the house habit; see
// client/src/track.ts's PRNG and plan.md constraint #2.
//
// Minified builds only. Brotli q11 is far too slow to sit in a dev rebuild,
// and a stale .br left beside a fresh dev bundle would quietly serve the
// previous build — worse than not compressing at all.
const kib = (n: number) => `${Math.round(n / 1024)} KiB`;
const twins = ["dist/client/bundle.js.br", "dist/client/bundle.js.gz"];
let sizes = "";
if (minified) {
  const bundle = readFileSync("dist/client/bundle.js");
  const br = brotliCompressSync(bundle, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  const gz = gzipSync(bundle, { level: 9 });
  writeFileSync(twins[0]!, br);
  writeFileSync(twins[1]!, gz);
  sizes = ` (bundle ${kib(bundle.length)}, br ${kib(br.length)}, gz ${kib(gz.length)})`;
} else {
  // Not compressing is not enough on its own — any twins a previous
  // production build left behind have to go. The server prefers a twin
  // whenever one exists, so a stale pair sits there serving the last
  // production bundle to every dev request. Found the hard way, by a freshly
  // built change that never reached the browser.
  for (const f of twins) rmSync(f, { force: true });
}

console.log(`built dist/client/${sizes}`);

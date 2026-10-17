import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { attachLive } from "./lib/live.ts";
import { apiRouter } from "./routes/index.ts";
import { readmeRouter } from "./routes/readme.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// src/server/index.ts -> dist/client (the esbuild-built game + its index.html)
const clientDist = join(__dirname, "..", "..", "dist", "client");

const app = express();
app.use(express.json());

app.use("/readme/", readmeRouter);
app.use("/api", apiRouter);

// Hand over the .br/.gz twins that scripts/build-client.ts writes beside the
// bundle, because express.static will not compress and a cold load otherwise
// drags 591 KiB where 129 KiB would do. The `compression` package was the
// alternative and was rejected: it re-compresses unchanging bytes per request,
// and node:zlib at build time already did the work for free (plan.md
// constraint #2 — no new dependency for a few lines of code). A dev build has
// no twins on disk, so this falls through to express.static untouched.
const PRECOMPRESSED = [
  { ext: ".br", encoding: "br" },
  { ext: ".gz", encoding: "gzip" },
] as const;
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.includes("..")) return next(); // never let a path climb out of clientDist
  // acceptsEncodings, not a substring test on the header: `br;q=0` means the
  // client is explicitly refusing brotli, and `includes("br")` would read that
  // as a yes and send bytes it cannot decode.
  const hit = PRECOMPRESSED.find(
    (c) => req.acceptsEncodings(c.encoding) && existsSync(join(clientDist, req.path + c.ext)),
  );
  res.vary("Accept-Encoding"); // the uncompressed answer is a different body
  if (!hit) return next();
  res.set("Content-Encoding", hit.encoding);
  res.type(extname(req.path)); // or send() would type the file by its .br/.gz
  req.url = req.path + hit.ext; // express.static still does ETag, ranges, 304s
  next();
});

// The game itself: a single static page + bundle. Serving it at / also
// satisfies the starter's "answers at / with 200" check.
app.use(express.static(clientDist));
app.get("/", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

// An invite link is a path, not a query parameter (ADR 0011), so it has to
// serve the same page. main.ts reads location.pathname on load, joins once an
// account exists, and replaceState's back to "/" so a refresh cannot
// double-join. Nothing about the token is interpreted here — the server's
// only job is to not 404 on a URL someone was handed in a chat window.
app.get("/crew/:token", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"));
});

// An explicit http.Server rather than app.listen(): the WebSocket server
// needs something to attach its `upgrade` handling to, and express's own
// return value is the same object only by accident of implementation.
const server = createServer(app);
attachLive(server);

const port = Number(process.env.PORT ?? 8080);
server.listen(port, "0.0.0.0", () => {
  console.log(`listening on 0.0.0.0:${port} (ws at /live)`);
});

import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

// The game itself: a single static page + bundle. Serving it at / also
// satisfies the starter's "answers at / with 200" check.
app.use(express.static(clientDist));
app.get("/", (_req, res) => {
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

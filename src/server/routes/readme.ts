// /readme/ publishes README.md in full, rendered, at the deployed app — the
// crit's real material (spec/README.md and the course brief both say so).
// Read fresh per request: cheap at this scale, and never goes stale.
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { renderMarkdown } from "../lib/markdown.ts";

export const readmeRouter: Router = Router();

readmeRouter.get("/", async (_req, res) => {
  const src = await readFile("README.md", "utf8");
  const body = await renderMarkdown(src);
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>README</title>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`);
});

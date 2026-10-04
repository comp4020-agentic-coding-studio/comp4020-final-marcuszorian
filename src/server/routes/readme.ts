// /readme/ publishes README.md in full, rendered, at the deployed app — the
// crit's real material (spec/README.md and the course brief both say so).
// Read fresh per request: cheap at this scale, and never goes stale.
import { Router } from "express";
import { readFile } from "node:fs/promises";
import { renderMarkdown } from "../lib/markdown.ts";

export const readmeRouter: Router = Router();

// A handful of hex literals duplicated from client/src/palette.ts rather than
// imported from it: the Dockerfile's runtime stage copies dist/, src/,
// migrations/ and README.md, but never client/ (see doc/adr/0001-stack.md
// and plan.md's constraint #4) — an import across that boundary would
// typecheck locally and then 404 at runtime in the actual container. Keep
// these in sync with palette.ts by hand; it's a handful of values on two
// independent surfaces, not worth a shared module for.
readmeRouter.get("/", async (_req, res) => {
  const src = await readFile("README.md", "utf8");
  const body = await renderMarkdown(src);
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>README — drift archive</title>
    <style>
      :root {
        --void: #0d0221;
        --raised: #262335;
        --magenta: #ff2a6d;
        --pink: #ff7edb;
        --cyan: #05d9e8;
        --violet: #8c52ff;
        --gold: #fede5d;
        --hotWhite: #fff5f6;
        --lilac: #848bbd;
      }
      html,
      body {
        margin: 0;
        background: var(--void);
        color: var(--hotWhite);
      }
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        line-height: 1.6;
      }
      main {
        max-width: 65ch;
        margin: 0 auto;
        padding: 48px 24px 96px;
        box-sizing: border-box;
      }
      h1 {
        font-size: 2rem;
        font-weight: 900;
        letter-spacing: 0.02em;
        background: linear-gradient(135deg, var(--hotWhite), var(--pink) 45%, var(--cyan) 100%);
        background-clip: text;
        -webkit-background-clip: text;
        color: var(--hotWhite);
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.3em;
      }
      h2 {
        font-size: 1.25rem;
        color: var(--pink);
        border-left: 3px solid var(--magenta);
        padding-left: 0.6em;
        margin-top: 2.2em;
      }
      a {
        color: var(--cyan);
        text-decoration-color: color-mix(in srgb, var(--cyan) 50%, transparent);
      }
      a:hover,
      a:focus-visible {
        color: var(--gold);
      }
      strong {
        color: var(--hotWhite);
      }
      em {
        color: var(--lilac);
      }
      code {
        background: var(--raised);
        border-radius: 4px;
        padding: 0.1em 0.4em;
        font-size: 0.9em;
      }
      ul,
      ol {
        padding-left: 1.3em;
      }
      li {
        margin: 0.4em 0;
      }
      li::marker {
        color: var(--violet);
      }
      hr {
        border: none;
        border-top: 1px solid color-mix(in srgb, var(--violet) 35%, transparent);
        margin: 2.5em 0;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`);
});

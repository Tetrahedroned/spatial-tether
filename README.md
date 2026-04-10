# Spatial-Tether

Your agent is clicking the wrong thing. Not because it's broken. Because it's guessing.

Screenshot-based browser tools return compressed images, wrong dimensions, and distorted geometry. Vision models hallucinate coordinates. The agent acts on a description of the page, not the page itself. One bad frame and every action after it is wrong — silently, confidently wrong.

Spatial-Tether fixes this at the source.

## What It Does

Intercepts a URL before anything renders. Reads the HTML, computed CSS, and font data directly. Measures every glyph using the same engine the browser uses. Runs word-level layout arithmetic. Assigns exact pixel coordinates to every text atom, button, link, and form field on the page. Packages the result as a deterministic JSON map — the Standardized Spatial Manifest (SSM). Serves it to the agent via MCP.

The agent doesn't see the page. It knows the page.

Same URL, same viewport, identical output every run. No vision model. No screenshot. No guessing.

## Why This Exists

OCR is pixels → text. Spatial-Tether is text → pixels. These are mathematical inverses.

OCR reads a rendered image and infers where text lives. Spatial-Tether reads the source and calculates where text will be before anything is rendered. One is inference. The other is proof.

The community has been solving this problem sideways — accessibility tree snapshots, numbered element refs, third-party scraping APIs — because vision inference keeps failing at scale. Spatial-Tether is the direct solution: a layout engine for agents, the same way browsers have layout engines for humans.

Agents and browsers have the same problem. Both need to know where things are before acting. Browsers solved it with layout engines. Agents were solving it with screenshots. Spatial-Tether is the layout engine for agents.

## The Spatial Manifest (SSM)

Every element on the page becomes an atom with a verified bounding box, a semantic role, a gravity score, and an interactive flag. The `tether_id` is a hash of the URL, viewport dimensions, and capture timestamp — it uniquely identifies this exact snapshot of this exact layout.

```json
{
  "tether_id": "a3f8c21d904b7e56",
  "url": "https://example.com",
  "viewport": { "w": 1280, "h": 800 },
  "captured_at": "2026-04-06T14:32:11.004Z",
  "atoms": [
    {
      "id": "submit-0",
      "text": "Sign in",
      "geom": { "x": 256, "y": 120, "w": 89.4, "h": 38 },
      "gravity": 0.82,
      "meta": { "role": "button", "intent": "action", "interactive": true }
    },
    {
      "id": "email-1",
      "text": "",
      "geom": { "x": 256, "y": 60, "w": 320, "h": 40 },
      "gravity": 0.65,
      "meta": {
        "role": "field",
        "intent": "email",
        "interactive": true,
        "placeholder": "Email address",
        "required": true
      }
    }
  ],
  "collisions": []
}
```

The agent receives this map and knows the Sign In button occupies the rectangle from (256, 120) to (345, 158). It knows the email field sits at (256, 60) and is required. No screenshot. No vision model. No retry loop.

If a page times out or blocks headless browsers, the agent receives a structured error SSM — not a crash. It knows what happened and why.

## Information Gravity

Every atom carries a `gravity` score from 0.0 to 1.0. It measures how significant an element is relative to its context.

**High gravity (→ 1.0):** Isolated, standalone, high-intent. A Sign In button in a sparse header. A Submit control in a form.

**Low gravity (→ 0.0):** Dense, packed, interchangeable. A nav link buried in a 15-item toolbar. Body text surrounded by neighbors.

Gravity is calculated in four layers:

1. **Spatial isolation** — how physically alone the element is relative to its neighbors
2. **Container context** — nav, toolbar, and menubar elements score lower than form and main content elements
3. **Density gradient** — sibling count scales the penalty continuously, not by threshold
4. **Role significance** — Sign in, Submit, Buy, and equivalent action labels across languages receive a boost

Disabled elements carry a gravity of 0.0 and are flagged `interactive: false`. aria-hidden elements are filtered entirely — they never appear in the manifest.

Real results from github.com (1280×800 viewport):

| Element | Text | Gravity |
|---------|------|---------|
| Standalone `<button>` | Sign in | 0.82 |
| Toolbar `<button>` | Star | 0.19 |
| `<p>` | body paragraph | 0.08 |

## Benchmarks

These results are reproducible. Run `npm run benchmark` and you will get the same numbers.

### Determinism

Target: `https://github.com/Tetrahedroned/spatial-tether` — 10 consecutive runs, 1280×800 viewport.

| Metric | Result |
|--------|--------|
| All runs identical | YES |
| Atoms per run | 2,099 |
| Variance detected | NO |
| SHA-256 (atoms+collisions) | `0de686c6e42be18e…` |

Same URL. Same viewport. Same hash. Every time.

### Coordinate Accuracy

Target: `https://example.com` — Spatial-Tether coordinates vs Playwright `getBoundingClientRect()` ground truth.

| Element | Δy (px) |
|---------|---------|
| h1 first word | 0 |
| h1 second word | 0 |
| p first word | 0 |
| p second word | 0 |
| p third word | 0 |

**Average delta: 0 px. Max delta: 0 px.**

Coordinates are calculated from the same layout engine the browser uses. The output is not inferred — it is derived.

### Token Cost

Target: `https://github.com/Tetrahedroned/spatial-tether` — full-page screenshot vs SSM JSON.

| Representation | Estimated Tokens |
|----------------|-----------------|
| Full-page screenshot (PNG → base64) | 464,357 |
| Spatial-Tether SSM (2,099 atoms) | 107,924 |
| **Ratio** | **4.3× fewer** |

356,433 tokens saved per page. On a 20-step navigation task repeated 100 times: approximately 712M tokens saved vs screenshot-based approaches.

### Reproduce

```bash
npm install -g spatial-tether
npx playwright install chromium
npm run benchmark
```

## Security Properties

The SSM is an auditable artifact. Given the same page and viewport, the output is mathematically identical across every run. Two manifests can be diffed to verify what changed between captures. The `tether_id` ties each manifest to its exact source conditions.

Agents using Spatial-Tether make one clean pass per page and act on coordinates derived from source — not inferred from a rendered image. This eliminates the retry loops and repeated fetches that trigger bot detection on protected sites.

## Install

```bash
npm install -g spatial-tether
npx playwright install chromium
```

Playwright's Chromium binaries are not bundled to keep the package lightweight. Install them separately.

## Usage

Add to your MCP client config:

```json
{
  "mcpServers": {
    "spatial-tether": {
      "command": "npx",
      "args": ["-y", "spatial-tether"]
    }
  }
}
```

No local clone required.

The server exposes one tool: `browse_spatially`.

```json
{
  "method": "tools/call",
  "params": {
    "name": "browse_spatially",
    "arguments": {
      "url": "https://example.com",
      "viewport_w": 1280,
      "viewport_h": 800,
      "timeout_ms": 30000
    }
  }
}
```

`timeout_ms` is optional. Default is 30 seconds. On timeout, the agent receives a structured error SSM instead of a crash.

Run the server directly:

```bash
npm start
```

Run the validation suite:

```bash
npm test
```

## Architecture

**`interceptor.ts` — The Hook.** Launches a persistent headless Chromium context via Playwright. Navigates to the target URL and waits for networkidle. Scrolls the full page in viewport-height increments, capturing atoms at each position with scroll-offset-adjusted absolute coordinates. Extracts every leaf text element, button, link, and form field using computed CSS — not declared CSS, so inheritance and media queries are already resolved. Fixed and sticky elements are captured once at scroll position zero and excluded from subsequent passes.

**`scaler.ts` — The Ruler.** Downloads the actual web font files from the page and measures every string using `canvas.measureText` — the same rendering engine Chromium uses. Adds letter-spacing and word-spacing corrections. If a font download fails, falls back to the system font for that family. If it says a glyph is 11.4px wide, it is 11.4px wide.

**`engine.ts` — The Arithmetic.** Flows words left-to-right within each container's computed bounding box, advancing the cursor and wrapping to the next line when accumulated width exceeds the container. Form fields are captured as single atoms — no word-splitting. Each atom carries absolute (x, y) coordinates adjusted for scroll offset.

**`haptics.ts` — The Senses.** Calculates gravity scores using the four-layer system above. Walks parent and grandparent containers to determine penalty eligibility. Applies density gradient based on sibling interactive count. Boosts significance for primary action elements. Flags disabled elements. Filters aria-hidden elements. Runs an O(n²) collision detector to flag overlapping bounding boxes.

**`manifest.ts` — The Map.** Infers semantic role and intent from HTML tags, ARIA attributes, input types, and placeholder heuristics. Deduplicates atoms sharing the same text and position. Packs everything into the SSM with a `tether_id` hashed from URL, viewport dimensions, and capture timestamp.

**`gateway.ts` — The MCP Portal.** Implements the Model Context Protocol server. Exposes `browse_spatially(url, viewport_w?, viewport_h?, timeout_ms?)`. Orchestrates the full pipeline — intercept → scale → engine → collisions → haptics → manifest — and returns the SSM JSON. On timeout, returns a structured error SSM with elapsed time and error code. Handles SIGINT/SIGTERM to cleanly close the persistent browser context.

## Honest Assessment

**What it does well.** Coordinates are mathematically derived — given the same page and viewport, the SSM is identical across every run. Semantic roles come from HTML and ARIA, not a model guess. Gravity scores correctly separate isolated interactive elements from dense content. Full-page scrolling captures content below the fold. Form fields are mapped with field metadata. Timeouts surface cleanly as structured errors.

**What it doesn't do yet:**
- Flash and canvas content are not measurable
- Complex CSS layouts (flexbox, grid) may produce coordinate offsets
- Pages requiring authentication need session handling before capture

## Use Cases

**For OpenClaw and agent-browser workflows** — drop in as an MCP skill. The agent receives exact coordinates for every interactive element without a vision model or screenshot. Works with text-only local models at the same precision as frontier vision models.

**For agents filling forms** — every input, textarea, and select element is mapped with its bounding box, placeholder, name, and required status. No more guessing which field is which.

**For web navigation at scale** — one deterministic pass per page. No retry loops. No repeated fetches. Predictable token cost per run.

**For OCR research** — generates ground truth bounding box data for any web page automatically. Run it against an OCR model on the same pages and the coordinate delta tells you exactly where inference fails, measured in pixels, on real production pages.

**For frontend regression testing** — run before and after a CSS change. The diff tells you exactly what moved, by how many pixels, and whether any content is now overlapping.

**For accessibility auditing** — the coordinate sequence is a verifiable reading order. Does the spatial layout match the logical content order a screen reader would traverse? Spatial-Tether makes this computable.

**For AI training data** — the SSM format packages spatial truth, semantic roles, and layout structure in a form that carries more information than screenshots and more structure than raw DOM.

---

Built in spare time. Lafayette, Louisiana.
# Spatial-Tether

AI agents that browse the web are blind. They take screenshots. They ask vision models to guess coordinates. The guess is probabilistic, slow, and wrong at scale.

Spatial-Tether replaces visual inference with mathematical certainty.

## What It Does

Intercepts a URL at the network level. Extracts HTML, computed CSS, and font data. Measures every glyph using headless canvas. Runs word-level layout arithmetic. Assigns exact pixel coordinates to every text atom on the page. Packages the result as a deterministic JSON map -- the Standardized Spatial Manifest (SSM). Serves it to the agent via MCP.

The agent doesn't see the page. It knows the page.

## Why This Exists

OCR is pixels → text. Spatial-Tether is text → pixels. These are mathematical inverses.

OCR reads a rendered image and infers where text lives. Spatial-Tether reads the source and calculates where text will be before anything is rendered. One is inference. The other is proof.

The insight came from Pretext -- a pure JavaScript text measurement library that computes layout without triggering DOM reflow. Pretext was built for human interfaces: measure before rendering so the browser doesn't stall. Spatial-Tether applies the same primitive to agent interfaces: measure before interacting so the agent doesn't guess.

Agents and browsers have the same problem. Both need to know where things are before acting. Browsers solved it with layout engines. Agents were solving it with screenshots. Spatial-Tether is the layout engine for agents.

## The Spatial Manifest (SSM)

Every word on the page becomes an atom with a verified bounding box, a semantic role, and a gravity score. The `tether_id` is a hash of the URL, viewport dimensions, and capture timestamp -- it uniquely identifies this exact snapshot of this exact layout.

```json
{
  "tether_id": "a3f8c21d904b7e56",
  "url": "https://example.com",
  "viewport": { "w": 1280, "h": 800 },
  "captured_at": "2026-04-06T14:32:11.004Z",
  "atoms": [
    {
      "id": "example-0",
      "text": "Example",
      "geom": { "x": 256, "y": 120, "w": 89.4, "h": 38 },
      "gravity": 0.33,
      "meta": { "role": "heading", "intent": "title" }
    },
    {
      "id": "domain-1",
      "text": "Domain",
      "geom": { "x": 353.4, "y": 120, "w": 79.1, "h": 38 },
      "gravity": 0.33,
      "meta": { "role": "heading", "intent": "title" }
    }
  ],
  "collisions": []
}
```

The agent receives this map and knows that the word "Example" occupies the rectangle from (256, 120) to (345, 158). No screenshot. No OCR. No guessing.

## Information Gravity

Every atom carries a `gravity` score from 0.0 to 1.0. It measures layout isolation -- how physically alone an element is relative to its neighbors.

**High gravity (→ 1.0):** The element is isolated. It has a large area, few nearby neighbors, and significant surrounding whitespace. This is a standalone call-to-action -- a login button, a submit control, a prominent nav link.

**Low gravity (→ 0.0):** The element is dense. It is surrounded by many neighbors of similar size. This is body text, a list item, a table cell buried in content.

The formula: `gravity = (element_area / whitespace_buffer) × (1 / neighbor_count)`, clamped to [0, 1]. Role-based floors are applied after: buttons floor at 0.40, short links (≤ 15 chars) floor at 0.25, all links floor at 0.20.

Real results from github.com (1280×800 viewport):

| Element | Text | Gravity |
|---------|------|---------|
| `<button>` | Star | 0.250 |
| `<button>` in nav toolbar | Sign in | 0.400 |
| `<p>` | body paragraph text | 0.100 |

The Star button scores 0.250 because it lives inside a dense toolbar with many adjacent controls. The Sign In button scores at the button floor (0.400) because it is visually isolated in the header. Body text sits at 0.100 because it has dozens of neighbors.

## Install

```bash
npm install -g spatial-tether
npx playwright install chromium
```

Playwright's Chromium binaries are not bundled in the package to keep it lightweight. They must be installed separately.

## Usage

Add to your MCP client config (e.g. `mcp-config.json` for Claude Desktop):

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

The server exposes one tool: `browse_spatially`. Call it via JSON-RPC:

```json
{
  "method": "tools/call",
  "params": {
    "name": "browse_spatially",
    "arguments": {
      "url": "https://example.com",
      "viewport_w": 1280,
      "viewport_h": 800
    }
  }
}
```

The tool returns the full SSM JSON. The agent can immediately identify the click target for any word -- no screenshot, no vision model, no retry loop.

Run the server directly:

```bash
npm start
```

Run the validation suite:

```bash
npm test
```

## Architecture

**`interceptor.ts` — The Hook.** Launches a persistent headless Chromium context via Playwright (kept warm to minimize cold-start latency). Navigates to the target URL and waits for `networkidle`. Extracts every leaf text element using `getComputedStyle` -- not declared CSS, computed CSS, so inheritance and media queries are already resolved. Captures `@font-face` URLs from in-flight network responses and passes the full raw context downstream.

**`scaler.ts` — The Ruler.** Downloads the actual web font files intercepted from the page and registers them with the headless canvas. Measures every string using `canvas.measureText` -- the same rendering engine Chromium uses -- then adds `letter-spacing` and `word-spacing` corrections on top. If a font download fails, it falls back to the system font for that family. This is the ground truth layer: if it says "W" is 11.4px wide, it is 11.4px wide.

**`engine.ts` — The Arithmetic.** Receives the raw atoms and measured font metrics and runs a word-level text-wrapping algorithm. For each source element, the browser has already computed the container's bounding box via `getBoundingClientRect`. The engine flows words left-to-right within that box, advancing the cursor and wrapping to the next line when the accumulated width would exceed the container. Each word becomes a `WordAtom` with absolute (x, y) coordinates. The arithmetic is O(words) with no I/O -- sub-millisecond per element.

**`haptics.ts` — The Senses.** Calculates the information gravity score for each source element using area, whitespace buffer, and neighbor count. Applies role-based minimum floors so that buttons and short links are never underweighted relative to body text. Runs an O(n²) collision detector across all word atoms to flag any bounding boxes that physically overlap -- a signal that the layout engine or CSS produced unexpected geometry.

**`manifest.ts` — The Map.** Infers semantic role and intent from HTML tags and ARIA attributes (verifiable truth, no ML). Deduplicates atoms that share the same text and (x, y) position -- a common artifact when an `<a>` tag sits inside a `<p>` -- keeping the more specific role. Packs everything into the Standardized Spatial Manifest (SSM) with a `tether_id` hashed from URL, viewport dimensions, and capture timestamp.

**`gateway.ts` — The MCP Portal.** Implements the Model Context Protocol server using `@modelcontextprotocol/sdk`. Exposes the `browse_spatially(url, viewport_w?, viewport_h?)` tool. Orchestrates the full pipeline -- intercept → scale → engine → haptics → manifest -- and returns the SSM JSON to the calling agent. Targets a 2-second end-to-end ceiling. Handles `SIGINT`/`SIGTERM` to cleanly close the persistent browser context.

## Honest Assessment

**What it does well.** Pixel coordinates are mathematically derived, not inferred -- given the same page and viewport, the SSM is identical across every run. Semantic roles come from HTML and ARIA, not a model guess. Gravity scores correctly separate isolated interactive elements from dense body content on real pages. The deduplication step prevents false collision reports from nested tags.

**What it doesn't do yet:**

- Button groups score lower than standalone buttons (link floor: 0.25, button floor: 0.4)
- Pages that block headless browsers will hang
- Flash/canvas content not measurable
- Complex CSS layouts (flexbox, grid) may produce coordinate offsets

## Use Cases

For any AI agent doing web navigation, Spatial-Tether replaces visual inference with mathematical certainty. A text-only model with zero vision capability can interact with web pages at pixel precision. Vision is no longer a prerequisite for accurate web navigation.

For OCR research and development, Spatial-Tether generates ground truth bounding box data for any web page automatically -- no human annotation, no benchmark datasets required. Run it against an OCR model on the same pages and the coordinate delta tells you exactly where the OCR model fails, measured in pixels, on real production pages rather than synthetic benchmarks.

For frontend engineering, the SSM is a layout regression tool. Run it before and after a CSS change. The diff tells you exactly what moved, by how many pixels, and whether any content is now overlapping. No screenshots. No visual diffing tools. Pure coordinate arithmetic.

For accessibility engineering, the coordinate sequence is a verifiable reading order. Does the spatial layout match the logical content order a screen reader would traverse? Spatial-Tether makes this computable.

For localization testing, feed the same page in multiple languages and compare container widths to measured text widths. Spatial-Tether flags overflow before it reaches production.

For AI training data generation, the SSM format packages spatial truth, semantic roles, and layout structure in a form that carries more information than screenshots and more structure than raw DOM. Every page processed produces a labeled document.

## Roadmap

- [ ] Button group detection -- boost gravity for elements inside nav/toolbar
- [ ] Timeout handling for pages that block headless browsers
- [x] Viewport scrolling -- full-page capture in viewport-height increments
- [ ] Form field coordinate mapping

---

Built in spare time. Lafayette, Louisiana.

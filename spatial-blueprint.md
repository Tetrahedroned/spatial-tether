Implementation Blueprint: Spatial-Tether (v0.1)

Role: You are building a deterministic "Sidecar" infrastructure that intercepts web data and calculates pixel-perfect layout coordinates (Proprioception) to replace visual inference (OCR/VLM).

Core Objective: Move from Perception (guessing pixels) to Proprioception (calculating math).
1. Directory Structure & File Map
Plaintext

spatial-tether/
├── src/
│   ├── interceptor.ts   # Network-level stream hook
│   ├── scaler.ts        # Font/Glyph measurement engine
│   ├── engine.ts        # Layout/Wrapping arithmetic (<0.1ms)
│   ├── manifest.ts      # SSM JSON serialization
│   ├── haptics.ts       # Collision & Gravity logic
│   └── gateway.ts       # MCP Server implementation
├── tests/
│   └── validation.test.ts
├── package.json
└── mcp-config.json

2. Component Specifications
File 1: interceptor.ts (The Hook)

    Logic: Use a headless browser wrapper (Playwright/Puppeteer) to intercept the Response object.

    Action: Extract raw HTML strings, computed CSS (font-family, font-size, line-height), and the target container width (Viewport).

    Output: Passes a "Raw Context" object to the Scaler.

File 2: scaler.ts (The Ruler)

    Logic: Uses a headless canvas (or opentype.js) to measure the exact width/height of strings based on specific font files.

    Goal: Establish "Ground Truth." If the font is Inter at 16px, this file tells the engine exactly how many pixels the letter "W" occupies.

    Constraint: Must support fallback font-family logic.

File 3: engine.ts (The Arithmetic)

    Logic: Implements a text-wrapping algorithm.

    Formula: (Total Container Width) / (Measured Glyph Widths).

    Action: Iterates through text "atoms" and assigns (x, y) coordinates. It does not "render" an image; it calculates a coordinate grid.

    Speed Requirement: Execution must be sub-millisecond.

File 4: manifest.ts (The Map)

    Standardized Spatial Manifest (SSM):
    JSON

    {
      "tether_id": "string",
      "viewport": { "w": number, "h": number },
      "atoms": [
        {
          "id": "slug",
          "text": "string",
          "geom": { "x": number, "y": number, "w": number, "h": number },
          "gravity": number,
          "meta": { "role": "string", "intent": "string" }
        }
      ]
    }

File 5: haptics.ts (The Senses)

    Collision Detection: Checks for overlapping bounding boxes.

    Information Gravity: A calculation of "Layout Isolation." High gravity (0.0 to 1.0) indicates a standalone button/call-to-action. Low gravity indicates dense body text.

File 6: gateway.ts (The MCP Portal)

    Logic: Implements the Model Context Protocol (MCP).

    Tool Definition: browse_spatially(url: string).

    Function: Instead of returning Markdown, this tool runs the interceptor -> engine pipeline and returns only the SSM JSON to the agent.

3. Data Flow Protocol

    AGENT calls browse_spatially("https://example.com").

    GATEWAY hooks the request.

    INTERCEPTOR grabs raw text and font metadata.

    SCALER measures glyphs against the viewport.

    ENGINE runs the layout math to generate (x, y) pairs.

    HAPTICS calculates gravity/collisions to identify UI intent.

    MANIFEST packs the results into SSM JSON.

    AGENT receives the map and "knows" exactly where to click.

4. Developer Instructions for Building

Step 1: Initialization

    Initialize a TypeScript project with ts-node.

    Install playwright, canvas, and @modelcontextprotocol/sdk.

Step 2: The Logic Test

    Before building the network hook, create a test case: Provide the engine with a string ("Hello World"), a font (Arial, 16px), and a container width (100px).

    The engine must output the correct (x, y) coordinates for the wrapped text.

Step 3: Deterministic Validation

    The system is successful if the SSM output for a page is identical across multiple runs without taking a single screenshot.
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { intercept, closeBrowser } from "./interceptor";
import { registerFonts } from "./scaler";
import { layoutAtoms } from "./engine";
import { buildGravityMap, detectCollisions } from "./haptics";
import { buildSSM, buildErrorSSM, SSM } from "./manifest";

const VIEWPORT_DEFAULT = { w: 1280, h: 800 };

/**
 * Run the full pipeline: intercept → scale → engine → haptics → manifest.
 * On navigation timeout, returns a structured error SSM instead of throwing.
 */
async function runPipeline(
  url: string,
  viewport: { w: number; h: number },
  timeoutMs: number
): Promise<SSM> {
  const startMs = Date.now();

  try {
    const raw = await intercept(url, viewport, timeoutMs);

    if (raw.fontUrls.length > 0) {
      await registerFonts(raw.fontUrls);
    }

    const wordAtoms = layoutAtoms(raw.atoms);
    // Collisions must be computed before gravity so the collision signal can
    // adjust sibling counts in the density gradient (Layer 3).
    const collisions = detectCollisions(wordAtoms);
    const gravityMap = buildGravityMap(raw.atoms, viewport, wordAtoms, collisions);

    return buildSSM(url, viewport, wordAtoms, gravityMap, collisions);
  } catch (err) {
    const elapsed_ms = Date.now() - startMs;
    const isTimeout = err instanceof Error && err.name === "TimeoutError";

    if (isTimeout) {
      console.error(
        `[spatial-tether] timeout: ${url} (${elapsed_ms}ms elapsed, limit ${timeoutMs}ms)`
      );
      return buildErrorSSM(url, viewport, {
        code: "TIMEOUT",
        message: `Page did not reach networkidle within ${timeoutMs}ms.`,
        elapsed_ms,
      });
    }

    throw err; // non-timeout errors still propagate
  }
}

const server = new McpServer({
  name: "spatial-tether",
  version: "0.1.0",
});

server.tool(
  "browse_spatially",
  "Navigate to a URL and return a Spatial Manifest (SSM) — a precise JSON map of every word's pixel coordinates, role, intent, and information gravity. Use this instead of a markdown browser when the agent needs to know exactly where to click.",
  {
    url: z.string().url().describe("The fully-qualified URL to map."),
    viewport_w: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Viewport width in px (default 1280)."),
    viewport_h: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Viewport height in px (default 800)."),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Navigation timeout in ms (default 30000). On timeout the SSM error field is set instead of throwing."),
  },
  async ({ url, viewport_w, viewport_h, timeout_ms }) => {
    const viewport = {
      w: viewport_w ?? VIEWPORT_DEFAULT.w,
      h: viewport_h ?? VIEWPORT_DEFAULT.h,
    };
    const timeoutMs = timeout_ms ?? 30_000;

    const ssm = await runPipeline(url, viewport, timeoutMs);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(ssm, null, 2),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("SIGINT", async () => {
    await closeBrowser();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await closeBrowser();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Gateway fatal:", err);
  process.exit(1);
});

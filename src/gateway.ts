import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { intercept, closeBrowser } from "./interceptor";
import { registerFonts } from "./scaler";
import { layoutAtoms } from "./engine";
import { buildGravityMap, detectCollisions } from "./haptics";
import { buildSSM, SSM } from "./manifest";

const VIEWPORT_DEFAULT = { w: 1280, h: 800 };

/**
 * Run the full pipeline: intercept → scale → engine → haptics → manifest.
 */
async function runPipeline(
  url: string,
  viewport: { w: number; h: number }
): Promise<SSM> {
  const raw = await intercept(url, viewport);

  if (raw.fontUrls.length > 0) {
    await registerFonts(raw.fontUrls);
  }

  const wordAtoms = layoutAtoms(raw.atoms);
  const gravityMap = buildGravityMap(raw.atoms, viewport);
  const collisions = detectCollisions(wordAtoms);

  return buildSSM(url, viewport, wordAtoms, gravityMap, collisions);
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
  },
  async ({ url, viewport_w, viewport_h }) => {
    const viewport = {
      w: viewport_w ?? VIEWPORT_DEFAULT.w,
      h: viewport_h ?? VIEWPORT_DEFAULT.h,
    };

    const ssm = await runPipeline(url, viewport);

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

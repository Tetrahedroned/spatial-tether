import { createCanvas } from "canvas";
import * as https from "https";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface GlyphMetrics {
  width: number;   // px width of the string
  height: number;  // px (line height)
}

// Cache: fontSpec -> (char -> width)
const measureCache = new Map<string, Map<string, number>>();

function cacheKey(
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  fontStyle: string
): string {
  return `${fontFamily}|${fontSize}|${fontWeight}|${fontStyle}`;
}

function downloadFont(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

// Registry of downloaded font files: url -> local tmp path
const fontRegistry = new Map<string, string>();

/**
 * Pre-fetch @font-face URLs so the canvas can use real glyphs.
 * Called once by the gateway after intercept().
 */
export async function registerFonts(fontUrls: string[]): Promise<void> {
  // node-canvas exposes registerFont; import lazily to keep type-checks happy.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { registerFont } = require("canvas") as {
    registerFont: (path: string, opts: { family: string }) => void;
  };

  for (const url of fontUrls) {
    if (fontRegistry.has(url)) continue;
    try {
      const buf = await downloadFont(url);
      const ext = url.match(/\.(woff2?|ttf|otf)/i)?.[1] ?? "ttf";
      const tmp = path.join(os.tmpdir(), `st_font_${Date.now()}.${ext}`);
      fs.writeFileSync(tmp, buf);

      // Derive a family name from the filename fragment.
      const family = path.basename(url).replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      registerFont(tmp, { family });
      fontRegistry.set(url, tmp);
    } catch {
      // Non-fatal: fall through to system font fallback.
    }
  }
  // Clear measurement cache when new fonts arrive.
  measureCache.clear();
}

/**
 * Resolve the first usable font-family name from a CSS font-family stack.
 * Strips quotes and falls back to "sans-serif".
 */
function resolveFamily(fontFamily: string): string {
  const families = fontFamily.split(",").map((f) =>
    f.trim().replace(/^["']|["']$/g, "")
  );
  // Return the first non-generic entry, or the first entry if all are generic.
  const preferred = families.find(
    (f) => !["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"].includes(f.toLowerCase())
  );
  return preferred ?? families[0] ?? "sans-serif";
}

/**
 * Measure the rendered pixel width of a string given font properties.
 * Uses a headless canvas (same engine Chromium uses) for ground-truth metrics.
 */
export function measureString(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  fontStyle: string,
  letterSpacing: number,
  wordSpacing: number
): number {
  if (!text) return 0;

  const family = resolveFamily(fontFamily);
  const key = cacheKey(family, fontSize, fontWeight, fontStyle);

  let charCache = measureCache.get(key);
  if (!charCache) {
    charCache = new Map();
    measureCache.set(key, charCache);
  }

  const canvas = createCanvas(1, 1);
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px "${family}"`;

  // Measure the full string at once (handles kerning).
  let width = ctx.measureText(text).width;

  // Add letter-spacing: applied between each character (n-1 gaps + leading).
  // CSS letter-spacing adds space after each character including the last.
  if (letterSpacing !== 0) {
    width += letterSpacing * text.length;
  }

  // Add word-spacing: applied after each space character.
  if (wordSpacing !== 0) {
    const spaceCount = (text.match(/ /g) ?? []).length;
    width += wordSpacing * spaceCount;
  }

  return width;
}

/**
 * Measure a single word's bounding metrics.
 */
export function measureWord(
  word: string,
  fontFamily: string,
  fontSize: number,
  fontWeight: string,
  fontStyle: string,
  letterSpacing: number,
  wordSpacing: number,
  lineHeight: number
): GlyphMetrics {
  return {
    width: measureString(word, fontFamily, fontSize, fontWeight, fontStyle, letterSpacing, wordSpacing),
    height: lineHeight,
  };
}

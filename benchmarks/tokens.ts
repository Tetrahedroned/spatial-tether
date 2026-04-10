/**
 * Token cost benchmark.
 *
 * Compares the estimated token cost of sending a full-page screenshot (base64)
 * vs sending the SSM JSON for the same page.
 *
 * Token estimates:
 *   - Screenshot: base64_string.length / 3  (base64 chars compress ~3 chars/token)
 *   - SSM JSON:   json_string.length   / 4  (prose/JSON averages ~4 chars/token)
 *
 * Reports sizes, token estimates, ratio, and tokens saved.
 */

import { chromium } from "playwright";
import { intercept, closeBrowser } from "../src/interceptor";
import { registerFonts } from "../src/scaler";
import { layoutAtoms } from "../src/engine";
import { buildGravityMap, detectCollisions } from "../src/haptics";
import { buildSSM, SSM } from "../src/manifest";

const TARGET_URL = "https://github.com/Tetrahedroned/spatial-tether";
const VIEWPORT = { w: 1280, h: 800 };
const TIMEOUT_MS = 60_000;

async function runPipeline(url: string, viewport: { w: number; h: number }): Promise<SSM> {
  const raw = await intercept(url, viewport, TIMEOUT_MS);
  if (raw.fontUrls.length > 0) await registerFonts(raw.fontUrls);
  const wordAtoms = layoutAtoms(raw.atoms);
  const collisions = detectCollisions(wordAtoms);
  const gravityMap = buildGravityMap(raw.atoms, viewport, wordAtoms, collisions);
  return buildSSM(url, viewport, wordAtoms, gravityMap, collisions);
}

export interface TokensResult {
  url: string;
  viewport: { w: number; h: number };
  screenshot: {
    bytes: number;        // raw PNG buffer size
    base64Chars: number;  // base64 string length
    estimatedTokens: number;
  };
  ssm: {
    chars: number;
    estimatedTokens: number;
    atomCount: number;
  };
  ratio: number;          // screenshotTokens / ssmTokens
  tokensSaved: number;    // screenshotTokens - ssmTokens
}

export async function runTokens(): Promise<TokensResult> {
  // Step 1: run pipeline to get SSM (uses interceptor singleton).
  const ssm = await runPipeline(TARGET_URL, VIEWPORT);
  const ssmJson = JSON.stringify(ssm);
  await closeBrowser(); // close before opening screenshot browser

  // Step 2: fresh Playwright browser for screenshot capture.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h } });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

  // Full-page screenshot — captures the entire scrollable document.
  const screenshotBuffer = await page.screenshot({ fullPage: true });
  await browser.close();

  const base64 = screenshotBuffer.toString("base64");
  const screenshotBytes = screenshotBuffer.length;
  const base64Chars = base64.length;
  const screenshotTokens = Math.round(base64Chars / 3);

  const ssmChars = ssmJson.length;
  const ssmTokens = Math.round(ssmChars / 4);

  const ratio = Math.round((screenshotTokens / ssmTokens) * 100) / 100;
  const tokensSaved = screenshotTokens - ssmTokens;

  return {
    url: TARGET_URL,
    viewport: VIEWPORT,
    screenshot: {
      bytes: screenshotBytes,
      base64Chars,
      estimatedTokens: screenshotTokens,
    },
    ssm: {
      chars: ssmChars,
      estimatedTokens: ssmTokens,
      atomCount: ssm.atoms.length,
    },
    ratio,
    tokensSaved,
  };
}

if (require.main === module) {
  runTokens()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

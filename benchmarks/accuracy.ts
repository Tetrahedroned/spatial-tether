/**
 * Accuracy benchmark.
 *
 * Runs the full pipeline on https://example.com, then opens a separate
 * Playwright browser to get getBoundingClientRect() ground truth for 5
 * elements. Compares SSM atom coordinates against the browser's own layout
 * measurement and reports per-element delta, average delta, and max delta.
 */

import { chromium } from "playwright";
import { intercept, closeBrowser } from "../src/interceptor";
import { registerFonts } from "../src/scaler";
import { layoutAtoms } from "../src/engine";
import { buildGravityMap, detectCollisions } from "../src/haptics";
import { buildSSM, SSM, SSMAtom } from "../src/manifest";

const TARGET_URL = "https://example.com";
const VIEWPORT = { w: 1280, h: 800 };
const TIMEOUT_MS = 30_000;

interface TestCase {
  selector: string;
  atomText: string;      // exact text of the SSM atom to find
  compareX: boolean;     // whether to compare x (true only for first-word-of-element cases)
  label: string;         // human-readable description
}

const TEST_CASES: TestCase[] = [
  { selector: "h1",              atomText: "Example", compareX: true,  label: "h1 word-1 (x+y)" },
  { selector: "h1",              atomText: "Domain",  compareX: false, label: "h1 word-2 (y only)" },
  { selector: "p:first-of-type", atomText: "This",    compareX: true,  label: "p[0] word-1 (x+y)" },
  { selector: "p:first-of-type", atomText: "domain",  compareX: false, label: "p[0] word-2 (y only)" },
  { selector: "p:first-of-type", atomText: "is",      compareX: false, label: "p[0] word-3 (y only)" },
];

export interface AccuracyPoint {
  label: string;
  atomText: string;
  groundTruth: { x: number; y: number };
  ssm: { x: number; y: number };
  deltaX: number;
  deltaY: number;
  delta: number; // Euclidean when compareX, else |deltaY|
}

export interface AccuracyResult {
  url: string;
  viewport: { w: number; h: number };
  points: AccuracyPoint[];
  avgDelta: number;
  maxDelta: number;
}

async function runPipeline(url: string, viewport: { w: number; h: number }): Promise<SSM> {
  const raw = await intercept(url, viewport, TIMEOUT_MS);
  if (raw.fontUrls.length > 0) await registerFonts(raw.fontUrls);
  const wordAtoms = layoutAtoms(raw.atoms);
  const collisions = detectCollisions(wordAtoms);
  const gravityMap = buildGravityMap(raw.atoms, viewport, wordAtoms, collisions);
  return buildSSM(url, viewport, wordAtoms, gravityMap, collisions);
}

function findAtom(ssm: SSM, text: string): SSMAtom | undefined {
  return ssm.atoms.find((a) => a.text === text);
}

export async function runAccuracy(): Promise<AccuracyResult> {
  // Step 1: run pipeline (uses interceptor singleton).
  const ssm = await runPipeline(TARGET_URL, VIEWPORT);
  await closeBrowser(); // close interceptor browser before opening ground-truth browser

  // Step 2: open fresh Playwright browser for ground truth.
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: VIEWPORT.w, height: VIEWPORT.h } });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

  const points: AccuracyPoint[] = [];

  for (const tc of TEST_CASES) {
    const atom = findAtom(ssm, tc.atomText);

    // Get ground truth rect from browser.
    const rect = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }, tc.selector);

    if (!atom || !rect) {
      console.warn(`[accuracy] skipping "${tc.label}": atom=${!!atom} rect=${!!rect}`);
      continue;
    }

    const deltaX = Math.abs(atom.geom.x - rect.x);
    const deltaY = Math.abs(atom.geom.y - rect.y);
    const delta = tc.compareX
      ? Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      : deltaY;

    points.push({
      label: tc.label,
      atomText: tc.atomText,
      groundTruth: { x: Math.round(rect.x * 100) / 100, y: Math.round(rect.y * 100) / 100 },
      ssm: { x: atom.geom.x, y: atom.geom.y },
      deltaX: Math.round(deltaX * 100) / 100,
      deltaY: Math.round(deltaY * 100) / 100,
      delta: Math.round(delta * 100) / 100,
    });
  }

  await browser.close();

  const deltas = points.map((p) => p.delta);
  const avgDelta = deltas.length > 0
    ? Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 100) / 100
    : 0;
  const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;

  return {
    url: TARGET_URL,
    viewport: VIEWPORT,
    points,
    avgDelta,
    maxDelta,
  };
}

if (require.main === module) {
  runAccuracy()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

/**
 * Benchmark runner.
 *
 * Executes determinism, accuracy, and token benchmarks in sequence,
 * then writes benchmarks/RESULTS.md as markdown tables.
 *
 * Usage:
 *   npm run benchmark
 *   # or directly:
 *   ts-node benchmarks/run.ts
 */

import * as fs from "fs";
import * as path from "path";
import { runDeterminism, DeterminismResult } from "./determinism";
import { runAccuracy, AccuracyResult } from "./accuracy";
import { runTokens, TokensResult } from "./tokens";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function buildMarkdown(
  det: DeterminismResult,
  acc: AccuracyResult,
  tok: TokensResult,
  date: string
): string {
  const lines: string[] = [];

  lines.push("# Spatial-Tether Benchmark Results");
  lines.push("");
  lines.push(`**Date:** ${date}`);
  lines.push(`**Viewport:** ${acc.viewport.w}×${acc.viewport.h}`);
  lines.push("");

  // ── Determinism ─────────────────────────────────────────────────────────────
  lines.push("## 1. Determinism");
  lines.push("");
  lines.push(`Target: \`${det.hashes.length > 0 ? "https://github.com/Tetrahedroned/spatial-tether" : "n/a"}\``);
  lines.push(`Runs: ${det.runs} | Atoms per run: ${det.atomCount}`);
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| All hashes match | ${det.allMatch ? "**YES**" : "NO"} |`);
  lines.push(`| Variance detected | ${det.varianceDetected ? "YES" : "NO"} |`);
  lines.push(`| SHA-256 (atoms+collisions) | \`${det.hash.slice(0, 16)}…\` |`);
  lines.push(`| Runs | ${det.runs} |`);
  lines.push("");

  // ── Accuracy ─────────────────────────────────────────────────────────────────
  lines.push("## 2. Coordinate Accuracy");
  lines.push("");
  lines.push(`Target: \`${acc.url}\``);
  lines.push("Ground truth: Playwright `getBoundingClientRect()`");
  lines.push("");
  lines.push("| Element | Atom | GT x | GT y | SSM x | SSM y | Δx | Δy | Δ (px) |");
  lines.push("|---------|------|------|------|-------|-------|-----|-----|--------|");

  for (const p of acc.points) {
    lines.push(
      `| ${p.label} | \`${p.atomText}\` | ${p.groundTruth.x} | ${p.groundTruth.y} | ${p.ssm.x} | ${p.ssm.y} | ${p.deltaX} | ${p.deltaY} | ${p.delta} |`
    );
  }

  lines.push("");
  lines.push(`**Average delta:** ${acc.avgDelta} px | **Max delta:** ${acc.maxDelta} px`);
  lines.push("");

  // ── Tokens ───────────────────────────────────────────────────────────────────
  lines.push("## 3. Token Cost Comparison");
  lines.push("");
  lines.push(`Target: \`${tok.url}\``);
  lines.push("Estimates: base64_chars / 3 for screenshots, json_chars / 4 for SSM.");
  lines.push("");
  lines.push("| Representation | Size | Estimated Tokens |");
  lines.push("|---------------|------|-----------------|");
  lines.push(
    `| Screenshot (full-page PNG → base64) | ${fmt(tok.screenshot.bytes)} bytes raw / ${fmt(tok.screenshot.base64Chars)} base64 chars | **${fmt(tok.screenshot.estimatedTokens)}** |`
  );
  lines.push(
    `| SSM JSON (${fmt(tok.ssm.atomCount)} atoms) | ${fmt(tok.ssm.chars)} chars | **${fmt(tok.ssm.estimatedTokens)}** |`
  );
  lines.push("");
  lines.push(`**Ratio:** screenshot is **${tok.ratio}×** more tokens than SSM`);
  lines.push(`**Tokens saved per page:** ${fmt(tok.tokensSaved)}`);
  lines.push("");

  // ── Reproduce ────────────────────────────────────────────────────────────────
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```bash");
  lines.push("npm install -g spatial-tether");
  lines.push("npx playwright install chromium");
  lines.push("npm run benchmark");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);

  console.log("[benchmark] running determinism (10 pipeline runs)…");
  const det = await runDeterminism();
  console.log(`[benchmark] determinism done — allMatch=${det.allMatch}, atoms=${det.atomCount}`);

  console.log("[benchmark] running accuracy (example.com)…");
  const acc = await runAccuracy();
  console.log(`[benchmark] accuracy done — avgDelta=${acc.avgDelta}px, maxDelta=${acc.maxDelta}px`);

  console.log("[benchmark] running token comparison (github page)…");
  const tok = await runTokens();
  console.log(
    `[benchmark] tokens done — screenshot=${fmt(tok.screenshot.estimatedTokens)} tokens, ssm=${fmt(tok.ssm.estimatedTokens)} tokens, ratio=${tok.ratio}×`
  );

  const md = buildMarkdown(det, acc, tok, date);
  const outPath = path.join(__dirname, "RESULTS.md");
  fs.writeFileSync(outPath, md, "utf-8");
  console.log(`[benchmark] results written to ${outPath}`);

  // Print summary to stdout.
  console.log("\n── Summary ─────────────────────────────────────────────────");
  console.log(`Determinism:  ${det.allMatch ? "PASS" : "FAIL"} (${det.runs} runs, ${det.atomCount} atoms each)`);
  console.log(`Accuracy:     avg ${acc.avgDelta}px, max ${acc.maxDelta}px across ${acc.points.length} points`);
  console.log(`Token ratio:  ${tok.ratio}× (screenshot vs SSM) — ${fmt(tok.tokensSaved)} tokens saved per page`);
  console.log("────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("[benchmark] fatal:", err);
  process.exit(1);
});

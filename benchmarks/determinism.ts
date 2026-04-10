/**
 * Determinism benchmark.
 *
 * Runs the full pipeline 10× on the project's own GitHub page and SHA-256
 * hashes the atoms+collisions payload (excluding timestamp-derived fields
 * tether_id and captured_at). Reports whether all 10 hashes match.
 */

import * as crypto from "crypto";
import { intercept, closeBrowser } from "../src/interceptor";
import { registerFonts } from "../src/scaler";
import { layoutAtoms } from "../src/engine";
import { buildGravityMap, detectCollisions } from "../src/haptics";
import { buildSSM, SSM } from "../src/manifest";

const TARGET_URL = "https://github.com/Tetrahedroned/spatial-tether";
const VIEWPORT = { w: 1280, h: 800 };
const RUNS = 10;
const TIMEOUT_MS = 60_000;

async function runPipeline(url: string, viewport: { w: number; h: number }): Promise<SSM> {
  const raw = await intercept(url, viewport, TIMEOUT_MS);
  if (raw.fontUrls.length > 0) await registerFonts(raw.fontUrls);
  const wordAtoms = layoutAtoms(raw.atoms);
  const collisions = detectCollisions(wordAtoms);
  const gravityMap = buildGravityMap(raw.atoms, viewport, wordAtoms, collisions);
  return buildSSM(url, viewport, wordAtoms, gravityMap, collisions);
}

function hashPayload(ssm: SSM): string {
  // Exclude tether_id (timestamp-derived) and captured_at to test structural determinism.
  const payload = JSON.stringify({ atoms: ssm.atoms, collisions: ssm.collisions });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export interface DeterminismResult {
  runs: number;
  allMatch: boolean;
  varianceDetected: boolean;
  hash: string;       // hash of run 1 (representative)
  hashes: string[];   // all 10 hashes
  atomCount: number;
}

export async function runDeterminism(): Promise<DeterminismResult> {
  const hashes: string[] = [];
  let atomCount = 0;

  for (let i = 0; i < RUNS; i++) {
    const ssm = await runPipeline(TARGET_URL, VIEWPORT);
    hashes.push(hashPayload(ssm));
    if (i === 0) atomCount = ssm.atoms.length;
  }

  await closeBrowser();

  const first = hashes[0];
  const allMatch = hashes.every((h) => h === first);

  return {
    runs: RUNS,
    allMatch,
    varianceDetected: !allMatch,
    hash: first,
    hashes,
    atomCount,
  };
}

if (require.main === module) {
  runDeterminism()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

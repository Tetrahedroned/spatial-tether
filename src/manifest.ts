import * as crypto from "crypto";
import { WordAtom } from "./engine";
import { Collision } from "./haptics";

export type AtomRole =
  | "button"
  | "link"
  | "heading"
  | "content"
  | "input"
  | "image"
  | "unknown";

export type AtomIntent =
  | "action"
  | "navigation"
  | "title"
  | "content"
  | "form"
  | "unknown";

export interface SSMAtom {
  id: string;
  text: string;
  geom: { x: number; y: number; w: number; h: number };
  gravity: number;
  meta: { role: AtomRole; intent: AtomIntent };
}

export interface SSM {
  tether_id: string;
  url: string;
  viewport: { w: number; h: number };
  atoms: SSMAtom[];
  collisions: Collision[];
  captured_at: string; // ISO timestamp
}

// HTML tag → (role, intent) mapping based purely on semantics / ARIA.
const TAG_MAP: Record<string, { role: AtomRole; intent: AtomIntent }> = {
  button: { role: "button", intent: "action" },
  a: { role: "link", intent: "navigation" },
  h1: { role: "heading", intent: "title" },
  h2: { role: "heading", intent: "title" },
  h3: { role: "heading", intent: "title" },
  h4: { role: "heading", intent: "title" },
  h5: { role: "heading", intent: "title" },
  h6: { role: "heading", intent: "title" },
  p: { role: "content" as AtomRole, intent: "content" as AtomIntent },
  span: { role: "content" as AtomRole, intent: "content" as AtomIntent },
  li: { role: "content" as AtomRole, intent: "content" as AtomIntent },
  label: { role: "content" as AtomRole, intent: "form" as AtomIntent },
  input: { role: "input", intent: "form" },
  textarea: { role: "input", intent: "form" },
  select: { role: "input", intent: "form" },
};

// Explicit ARIA role override map.
const ARIA_MAP: Record<string, { role: AtomRole; intent: AtomIntent }> = {
  button: { role: "button", intent: "action" },
  link: { role: "link", intent: "navigation" },
  heading: { role: "heading", intent: "title" },
  textbox: { role: "input", intent: "form" },
  navigation: { role: "link", intent: "navigation" },
};

export function inferMeta(
  tag: string,
  ariaRole: string | null
): { role: AtomRole; intent: AtomIntent } {
  if (ariaRole && ARIA_MAP[ariaRole]) return ARIA_MAP[ariaRole];
  return TAG_MAP[tag] ?? { role: "unknown", intent: "unknown" };
}

export function buildTetherId(
  url: string,
  viewport: { w: number; h: number },
  timestamp: string
): string {
  const input = `${url}|${viewport.w}x${viewport.h}|${timestamp}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// Specificity order: button > link > heading/input > content/image > unknown.
const ROLE_SPECIFICITY: Record<AtomRole, number> = {
  button:  4,
  link:    3,
  heading: 2,
  input:   2,
  content: 1,
  image:   1,
  unknown: 0,
};

/**
 * Remove duplicate atoms that share the same text AND (x, y) position.
 * Keeps the atom with the more specific role (button > link > content > unknown).
 * Order of remaining atoms is preserved.
 */
function deduplicateSSMAtoms(atoms: SSMAtom[]): SSMAtom[] {
  const winners = new Map<string, SSMAtom>();

  for (const atom of atoms) {
    // Round coordinates to the nearest pixel for the dedup key.
    // This provides 1px tolerance for elements captured in overlapping
    // viewport zones during multi-pass scroll capture.
    const kx = Math.round(atom.geom.x);
    const ky = Math.round(atom.geom.y);
    const key = `${atom.text}|${kx}|${ky}`;
    const existing = winners.get(key);
    if (
      !existing ||
      ROLE_SPECIFICITY[atom.meta.role] > ROLE_SPECIFICITY[existing.meta.role]
    ) {
      winners.set(key, atom);
    }
  }

  // Preserve original order: filter to only the winning atom for each key.
  const winnerSet = new Set(winners.values());
  return atoms.filter((a) => winnerSet.has(a));
}

export function buildSSM(
  url: string,
  viewport: { w: number; h: number },
  wordAtoms: WordAtom[],
  gravityMap: Map<number, number>,
  collisions: Collision[]
): SSM {
  const now = new Date().toISOString();
  const tetherId = buildTetherId(url, viewport, now);

  const atoms: SSMAtom[] = wordAtoms.map((wa) => {
    const { role, intent } = inferMeta(wa.sourceTag, wa.ariaRole);
    return {
      id: wa.id,
      text: wa.text,
      geom: wa.geom,
      gravity: gravityMap.get(wa.elementIndex) ?? 0,
      meta: { role, intent },
    };
  });

  return {
    tether_id: tetherId,
    url,
    viewport,
    atoms: deduplicateSSMAtoms(atoms),
    collisions,
    captured_at: now,
  };
}

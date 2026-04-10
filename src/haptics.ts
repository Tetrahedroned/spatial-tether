import { RawAtom } from "./interceptor";
import { WordAtom } from "./engine";

export interface Collision {
  atomIdA: string;
  atomIdB: string;
  overlapX: number;
  overlapY: number;
}

/**
 * Gravity = (Element Area / Whitespace Buffer) * (1 / Neighbor Count)
 *
 * - Element Area: w * h of the source element's bounding box.
 * - Whitespace Buffer: the product of horizontal and vertical margin/padding
 *   space around the element relative to its neighbors. Approximated here as
 *   the area of the axis-aligned bounding box that encompasses the element
 *   plus a buffer zone (half the viewport width/height, clamped to 1).
 * - Neighbor Count: number of other raw atoms whose bounding boxes are within
 *   a 2x-element-size proximity window (minimum 1 to avoid division by zero).
 *
 * Result is clamped to [0, 1].
 */
export function calculateGravity(
  el: RawAtom,
  allElements: RawAtom[],
  viewport: { w: number; h: number }
): number {
  const { containerGeom: g } = el;
  const elementArea = g.w * g.h;

  // Proximity window: 2× the element's own dimensions (minimum 50px).
  const proximityW = Math.max(g.w * 2, 50);
  const proximityH = Math.max(g.h * 2, 50);

  const neighborCount = allElements.filter((other) => {
    if (other === el) return false;
    const og = other.containerGeom;
    const dx = Math.abs((og.x + og.w / 2) - (g.x + g.w / 2));
    const dy = Math.abs((og.y + og.h / 2) - (g.y + g.h / 2));
    return dx < proximityW && dy < proximityH;
  }).length;

  // Whitespace buffer: approximate as the surrounding "free area" —
  // the viewport slice minus the element area.
  const sliceArea = Math.max(proximityW * proximityH, 1);
  const whitespaceBuffer = Math.max(sliceArea - elementArea, 1);

  const raw = (elementArea / whitespaceBuffer) * (1 / Math.max(neighborCount, 1));

  // Clamp to [0, 1].
  return Math.min(1, Math.max(0, parseFloat(raw.toFixed(4))));
}

/**
 * Apply role-based minimum floors to a raw gravity score.
 * Floors only raise scores, never lower them.
 * Only called when no container penalty is active.
 *
 *   button / intent=action  → floor 0.4
 *   link  + text ≤ 15 chars → floor 0.25
 *   link  (any)             → floor 0.2
 */
function applyGravityFloor(el: RawAtom, score: number): number {
  const isButton = el.tag === "button" || el.ariaRole === "button";
  const isLink =
    el.tag === "a" ||
    el.ariaRole === "link" ||
    el.ariaRole === "navigation";

  let floor = 0;
  if (isButton) floor = Math.max(floor, 0.4);
  if (isLink && el.text.length <= 15) floor = Math.max(floor, 0.25);
  if (isLink) floor = Math.max(floor, 0.2);

  return Math.max(score, floor);
}

// ─── Layer 2: container type modifier ────────────────────────────────────────

// Parent tags that are too generic to be meaningful containers on their own.
const GENERIC_CONTAINERS = new Set(["div", "span", "li"]);
// Containers explicitly exempt from penalty.
const EXEMPT_TAGS = new Set(["form", "article", "main", "section"]);
const EXEMPT_ROLES = new Set(["form"]);
// Containers that indicate a navigation/toolbar context → penalty eligible.
const PENALTY_TAGS = new Set(["nav", "toolbar", "menubar", "breadcrumb"]);
const PENALTY_ROLES = new Set(["toolbar", "navigation", "menubar"]);

/**
 * Determine whether the element sits inside a penalty-eligible container.
 * Walk the immediate parent first; if it is generic (div/span/li), walk up
 * to the grandparent before deciding.
 */
function isPenaltyActive(el: RawAtom): boolean {
  const parentTag = el.parentTag ?? "";
  const parentRole = el.parentRole ?? null;
  const grandparentTag = el.grandparentTag ?? "";
  const grandparentRole = el.grandparentRole ?? null;
  const sibCount = el.siblingInteractiveCount ?? 0;

  const effectiveTag = GENERIC_CONTAINERS.has(parentTag) ? grandparentTag : parentTag;
  const effectiveRole = GENERIC_CONTAINERS.has(parentTag) ? grandparentRole : parentRole;

  // Explicit exemptions take priority.
  if (
    EXEMPT_TAGS.has(effectiveTag) ||
    (effectiveRole !== null && EXEMPT_ROLES.has(effectiveRole))
  ) {
    return false;
  }

  // header is penalty-eligible only when the sibling count is dense.
  if (effectiveTag === "header") {
    return sibCount > 5;
  }

  return (
    PENALTY_TAGS.has(effectiveTag) ||
    (effectiveRole !== null && PENALTY_ROLES.has(effectiveRole))
  );
}

// ─── Layer 3: density gradient ────────────────────────────────────────────────

/**
 * Map sibling interactive count to a density gradient modifier.
 * Only applied when penalty is active.
 */
function getGradientModifier(siblingCount: number): number {
  if (siblingCount <= 2)  return 1.00;
  if (siblingCount <= 5)  return 0.85;
  if (siblingCount <= 9)  return 0.70;
  if (siblingCount <= 14) return 0.55;
  return 0.40;
}

// ─── Layer 4: significance boost ─────────────────────────────────────────────

/**
 * Trigger words for the significance boost.
 * Exported as a mutable array so callers can extend it without code changes.
 */
export const SIGNIFICANCE_TRIGGERS: string[] = [
  "sign in", "log in", "login", "submit", "get started", "buy",
  "checkout", "register", "subscribe", "anmelden", "connexion",
  "acceder", "ingresar",
];

function normalizeText(text: string): string {
  return text.normalize("NFD").toLowerCase();
}

/**
 * Returns true if any of the element's text signals (visible text, aria-label,
 * title attribute) contain a significance trigger.
 */
function hasSignificanceTrigger(el: RawAtom): boolean {
  const sources = [el.text, el.ariaLabel ?? "", el.titleAttr ?? ""].map(normalizeText);
  const triggers = SIGNIFICANCE_TRIGGERS.map(normalizeText);
  return sources.some((src) => triggers.some((t) => src.includes(t)));
}

/** Returns true for submit-typed inputs and buttons. */
function isTypeSubmit(el: RawAtom): boolean {
  return el.inputType === "submit";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a map from elementIndex → gravity score.
 *
 * Four-layer scoring:
 *   1. Base gravity (spatial isolation formula)
 *   2. Container type — determines penalty eligibility
 *   3. Density gradient — continuous sibling-count penalty (penalty path only)
 *   4. Significance boost — 1.3× for CTA triggers (capped on penalty path)
 *
 * Role-based floors apply only when no container penalty is active.
 * Disabled elements: gravity = 0.0 (interactive flag set in buildSSM).
 *
 * Pass wordAtoms + collisions to enable the collision-signal sibling adjustment.
 */
export function buildGravityMap(
  rawAtoms: RawAtom[],
  viewport: { w: number; h: number },
  wordAtoms: WordAtom[] = [],
  collisions: Collision[] = []
): Map<number, number> {
  // Build a set of element indices whose word atoms are involved in collisions.
  const collidingIndices = new Set<number>();
  if (collisions.length > 0 && wordAtoms.length > 0) {
    const idToIndex = new Map<string, number>();
    for (const wa of wordAtoms) {
      idToIndex.set(wa.id, wa.elementIndex);
    }
    for (const col of collisions) {
      const ia = idToIndex.get(col.atomIdA);
      const ib = idToIndex.get(col.atomIdB);
      if (ia !== undefined) collidingIndices.add(ia);
      if (ib !== undefined) collidingIndices.add(ib);
    }
  }

  const map = new Map<number, number>();

  rawAtoms.forEach((el, idx) => {
    // Disabled elements always score 0.0; interactive flag handled in buildSSM.
    if (el.disabled === true) {
      map.set(idx, 0.0);
      return;
    }

    // Layer 1: base spatial gravity.
    const base = calculateGravity(el, rawAtoms, viewport);

    // Layer 2: is this element inside a penalty-eligible container?
    const penaltyActive = isPenaltyActive(el);

    let score: number;

    if (penaltyActive) {
      // Layer 3: density gradient, adjusted by visual density.
      let sibCount = el.siblingInteractiveCount ?? 0;
      if (collidingIndices.has(idx)) {
        sibCount += 3; // collision signal → treat as denser than reported
      }
      const gradientModifier = getGradientModifier(sibCount);
      // Elements already spatially sparse get 30% penalty relief.
      const finalDensityModifier = gradientModifier * (1 - base * 0.3);
      const baseAfterPenalty = base * finalDensityModifier;

      // Layer 4: significance boost with 50%-recovery cap.
      if (hasSignificanceTrigger(el) || isTypeSubmit(el)) {
        const penaltyApplied = base - baseAfterPenalty;
        const maxRecovery = penaltyApplied * 0.5;
        const maxBoostedScore = baseAfterPenalty + maxRecovery;
        score = Math.min(baseAfterPenalty * 1.3, maxBoostedScore);
      } else {
        score = baseAfterPenalty;
      }

      // Penalty-active clamp: [0.10, 1.0].
      score = Math.min(1.0, Math.max(0.10, parseFloat(score.toFixed(4))));
    } else {
      // No penalty: apply significance boost freely, then role floors.
      score = hasSignificanceTrigger(el) || isTypeSubmit(el)
        ? base * 1.3
        : base;

      score = applyGravityFloor(el, score);
      score = Math.min(1.0, Math.max(0.0, parseFloat(score.toFixed(4))));
    }

    map.set(idx, score);
  });

  return map;
}

/**
 * Detect overlapping atom bounding boxes.
 * Two atoms "collide" if their geom rectangles intersect (not merely touch).
 */
export function detectCollisions(atoms: WordAtom[]): Collision[] {
  const collisions: Collision[] = [];

  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i].geom;
      const b = atoms[j].geom;

      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

      if (overlapX > 0 && overlapY > 0) {
        collisions.push({
          atomIdA: atoms[i].id,
          atomIdB: atoms[j].id,
          overlapX: Math.round(overlapX * 100) / 100,
          overlapY: Math.round(overlapY * 100) / 100,
        });
      }
    }
  }

  return collisions;
}

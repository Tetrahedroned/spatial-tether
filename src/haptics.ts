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

/**
 * Build a map from elementIndex -> gravity score for all word atoms to inherit.
 */
export function buildGravityMap(
  rawAtoms: RawAtom[],
  viewport: { w: number; h: number }
): Map<number, number> {
  const map = new Map<number, number>();
  rawAtoms.forEach((el, idx) => {
    const base = calculateGravity(el, rawAtoms, viewport);
    map.set(idx, applyGravityFloor(el, base));
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

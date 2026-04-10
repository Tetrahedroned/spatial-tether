import { RawAtom } from "./interceptor";
import { measureWord } from "./scaler";

export interface WordAtom {
  id: string;
  text: string;
  geom: { x: number; y: number; w: number; h: number };
  sourceTag: string;
  ariaRole: string | null;
  elementIndex: number; // which source element this word belongs to
  disabled?: boolean;   // mirrors RawAtom.disabled for downstream SSM population
  // Form field atoms only:
  isField?: boolean;
  inputType?: string | null;
  placeholder?: string | null;
  fieldName?: string | null;
  fieldId?: string | null;
  fieldValue?: string | null;
  required?: boolean;
}

/**
 * Run the layout/wrapping arithmetic for all raw atoms.
 *
 * Strategy:
 *   - For each source element, the browser already computed its bounding box.
 *   - We flow words left-to-right within that box, wrapping when the
 *     accumulated width exceeds the container width.
 *   - Each word becomes an independent WordAtom with absolute (x,y).
 *
 * Speed target: the arithmetic here is O(words) with no I/O — sub-ms per element.
 */
export function layoutAtoms(rawAtoms: RawAtom[]): WordAtom[] {
  const result: WordAtom[] = [];
  let atomCounter = 0;

  for (let ei = 0; ei < rawAtoms.length; ei++) {
    const el = rawAtoms[ei];

    // Defense-in-depth: primary filter is in interceptor browser code, but
    // ariaHidden atoms passed directly (e.g. in tests) must also be excluded.
    if (el.ariaHidden === true) continue;

    // Form fields: single-atom elements — no word-splitting.
    if (el.isField === true) {
      // Hidden inputs produce no atom (selector excludes them in production;
      // this guard makes the unit-test path safe too).
      if (el.inputType === "hidden") continue;

      const absX = el.containerGeom.x;
      const absY = el.containerGeom.y + (el.scrollOffset ?? 0);
      const fieldKey = el.fieldId ?? el.fieldName ?? el.tag;
      const slug = slugify(fieldKey, atomCounter);
      result.push({
        id: slug,
        text: el.text,
        geom: {
          x: Math.round(absX * 100) / 100,
          y: Math.round(absY * 100) / 100,
          w: Math.round(el.containerGeom.w * 100) / 100,
          h: Math.round(el.containerGeom.h * 100) / 100,
        },
        sourceTag: el.tag,
        ariaRole: el.ariaRole,
        elementIndex: ei,
        disabled: el.disabled ?? false,
        isField: true,
        inputType: el.inputType ?? null,
        placeholder: el.placeholder ?? null,
        fieldName: el.fieldName ?? null,
        fieldId: el.fieldId ?? null,
        fieldValue: el.fieldValue ?? null,
        required: el.required ?? false,
      });
      atomCounter++;
      continue;
    }

    const { css, containerGeom, text, tag, ariaRole } = el;

    // Split on whitespace; filter empty tokens.
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const containerX = containerGeom.x;
    // containerGeom.y is viewport-relative; add scrollOffset to get absolute y.
    const containerY = containerGeom.y + (el.scrollOffset ?? 0);
    const containerW = containerGeom.w;

    let cursorX = 0; // relative to container left
    let cursorY = 0; // relative to container top

    // One space-width for word-break calculations.
    const spaceWidth = measureWord(
      " ",
      css.fontFamily,
      css.fontSize,
      css.fontWeight,
      css.fontStyle,
      css.letterSpacing,
      css.wordSpacing,
      css.lineHeight
    ).width;

    for (const word of words) {
      const metrics = measureWord(
        word,
        css.fontFamily,
        css.fontSize,
        css.fontWeight,
        css.fontStyle,
        css.letterSpacing,
        css.wordSpacing,
        css.lineHeight
      );

      // Wrap: if this word would exceed the container width and we're not
      // at the start of a line, advance to the next line.
      if (cursorX > 0 && cursorX + metrics.width > containerW) {
        cursorX = 0;
        cursorY += css.lineHeight;
      }

      // Absolute coordinates = container origin + local cursor.
      const absX = containerX + cursorX;
      const absY = containerY + cursorY;

      const slug = slugify(word, atomCounter);

      result.push({
        id: slug,
        text: word,
        geom: {
          x: Math.round(absX * 100) / 100,
          y: Math.round(absY * 100) / 100,
          w: Math.round(metrics.width * 100) / 100,
          h: Math.round(metrics.height * 100) / 100,
        },
        sourceTag: tag,
        ariaRole,
        elementIndex: ei,
        disabled: el.disabled ?? false,
      });

      atomCounter++;
      cursorX += metrics.width + spaceWidth;
    }
  }

  return result;
}

function slugify(word: string, index: number): string {
  const base = word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  return `${base || "atom"}-${index}`;
}

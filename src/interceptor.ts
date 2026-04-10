import { Browser, BrowserContext, chromium } from "playwright";

export interface RawAtom {
  text: string;
  tag: string;
  ariaRole: string | null;
  containerGeom: { x: number; y: number; w: number; h: number };
  scrollOffset?: number; // px scrolled from top when atom was captured
  // Button group detection fields (optional for backwards compat with tests)
  parentTag?: string;
  parentRole?: string | null;
  grandparentTag?: string | null;
  grandparentRole?: string | null;
  siblingInteractiveCount?: number;
  ariaHidden?: boolean;     // true → element is filtered out (no atom produced)
  disabled?: boolean;       // true → atom present but gravity=0, interactive=false
  ariaLabel?: string | null;
  titleAttr?: string | null;
  inputType?: string | null; // type attribute for <input>/<button>; "textarea"/"select" for those tags
  // Form field atoms (isField=true)
  isField?: boolean;
  placeholder?: string | null;
  fieldName?: string | null;
  fieldId?: string | null;
  fieldValue?: string | null;
  required?: boolean;
  css: {
    fontFamily: string;
    fontSize: number;       // px
    lineHeight: number;     // px
    letterSpacing: number;  // px
    wordSpacing: number;    // px
    textTransform: string;
    fontWeight: string;
    fontStyle: string;
  };
}

export interface RawContext {
  url: string;
  viewport: { w: number; h: number };
  atoms: RawAtom[];
  fontUrls: string[]; // @font-face src URLs
}

// Singleton persistent browser context — keeps warm to beat cold-start latency.
let _browser: Browser | null = null;
let _context: BrowserContext | null = null;

async function getContext(): Promise<BrowserContext> {
  if (!_context) {
    _browser = await chromium.launch({ headless: true });
    _context = await _browser.newContext();
  }
  return _context;
}

export async function closeBrowser(): Promise<void> {
  if (_context) await _context.close();
  if (_browser) await _browser.close();
  _context = null;
  _browser = null;
}

export async function intercept(
  url: string,
  viewport: { w: number; h: number } = { w: 1280, h: 800 },
  timeoutMs: number = 30_000
): Promise<RawContext> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  await page.setViewportSize({ width: viewport.w, height: viewport.h });

  const collectedFontUrls: string[] = [];

  // Capture font file responses in-flight.
  page.on("response", (res) => {
    const ct = res.headers()["content-type"] ?? "";
    if (
      ct.includes("font") ||
      res.url().match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)
    ) {
      collectedFontUrls.push(res.url());
    }
  });

  // Navigate; let any timeout error propagate to the caller after page cleanup.
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  } catch (err) {
    try { await page.close(); } catch { /* ignore secondary error */ }
    throw err;
  }

  // Scroll the full page in viewport-height increments, capturing atoms at each
  // position. getBoundingClientRect() returns viewport-relative coordinates, so
  // we record the scroll offset alongside each atom for the engine to adjust.
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const viewportH = viewport.h;
  const allAtoms: RawAtom[] = [];

  for (let scrollY = 0; scrollY < Math.max(pageHeight, 1); scrollY += viewportH) {
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    // Allow intersection-observer-triggered content to render.
    await page.waitForTimeout(300);

    const atoms = await page.evaluate(
      ({ scrollOffset, viewportH }: { scrollOffset: number; viewportH: number }) => {
        const LEAF_SELECTORS =
          "p, h1, h2, h3, h4, h5, h6, li, span, a, button, label, td, th, dt, dd, figcaption, caption, blockquote, cite, code, pre, small, strong, em, b, i";

        function applyTextTransform(text: string, transform: string): string {
          switch (transform) {
            case "uppercase":  return text.toUpperCase();
            case "lowercase":  return text.toLowerCase();
            case "capitalize": return text.replace(/\b\w/g, (c) => c.toUpperCase());
            default:           return text;
          }
        }

        // Walk up the DOM tree checking for aria-hidden=true on any ancestor.
        function isAriaHidden(node: Element | null): boolean {
          let n: Element | null = node;
          while (n) {
            if (n.getAttribute("aria-hidden") === "true") return true;
            n = n.parentElement;
          }
          return false;
        }

        // Count direct interactive siblings within the same parent.
        function countInteractiveSiblings(parent: Element | null, self: Element): number {
          if (!parent) return 0;
          const INTERACTIVE_TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"]);
          const INTERACTIVE_ROLES = new Set(["button", "link", "menuitem", "option", "tab"]);
          return Array.from(parent.children).filter(
            (child) =>
              child !== self &&
              (INTERACTIVE_TAGS.has(child.tagName) ||
                INTERACTIVE_ROLES.has(child.getAttribute("role") ?? ""))
          ).length;
        }

        const results: Array<{
          text: string;
          tag: string;
          ariaRole: string | null;
          containerGeom: { x: number; y: number; w: number; h: number };
          scrollOffset: number;
          parentTag: string;
          parentRole: string | null;
          grandparentTag: string | null;
          grandparentRole: string | null;
          siblingInteractiveCount: number;
          ariaHidden: boolean;
          disabled: boolean;
          ariaLabel: string | null;
          titleAttr: string | null;
          inputType: string | null;
          css: {
            fontFamily: string;
            fontSize: number;
            lineHeight: number;
            letterSpacing: number;
            wordSpacing: number;
            textTransform: string;
            fontWeight: string;
            fontStyle: string;
          };
        }> = [];

        document.querySelectorAll<HTMLElement>(LEAF_SELECTORS).forEach((el) => {
          const rawText = el.innerText?.trim();
          if (!rawText) return;

          // Filter elements hidden from accessibility tree entirely.
          if (isAriaHidden(el)) return;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;

          // Only capture elements whose top edge falls within the current
          // viewport slice. This guarantees each element is captured exactly
          // once across scroll passes.
          if (rect.top < 0 || rect.top >= viewportH) return;

          const cs = window.getComputedStyle(el);

          // Skip fixed/sticky elements on subsequent passes — they were already
          // captured at scroll=0 with correct absolute coordinates, and their
          // rect.top does not reflect document position when scrolled.
          const position = cs.position;
          if (scrollOffset > 0 && (position === "fixed" || position === "sticky")) return;

          const fontSize = parseFloat(cs.fontSize) || 16;
          const lineHeightRaw = cs.lineHeight;
          const lineHeight =
            lineHeightRaw === "normal" ? fontSize * 1.2 : parseFloat(lineHeightRaw);
          const letterSpacing =
            cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);
          const wordSpacing =
            cs.wordSpacing === "normal" ? 0 : parseFloat(cs.wordSpacing);
          const textTransform = cs.textTransform;

          const displayText = applyTextTransform(rawText, textTransform);

          const parent = el.parentElement;
          const grandparent = parent?.parentElement ?? null;
          const tag = el.tagName.toUpperCase();

          results.push({
            text: displayText,
            tag: el.tagName.toLowerCase(),
            ariaRole: el.getAttribute("role"),
            containerGeom: {
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
            },
            scrollOffset,
            parentTag: parent?.tagName.toLowerCase() ?? "",
            parentRole: parent?.getAttribute("role") ?? null,
            grandparentTag: grandparent?.tagName.toLowerCase() ?? null,
            grandparentRole: grandparent?.getAttribute("role") ?? null,
            siblingInteractiveCount: countInteractiveSiblings(parent, el),
            ariaHidden: false, // passed the isAriaHidden filter above
            disabled:
              el.hasAttribute("disabled") ||
              el.getAttribute("aria-disabled") === "true",
            ariaLabel: el.getAttribute("aria-label"),
            titleAttr: el.getAttribute("title"),
            inputType:
              tag === "INPUT" || tag === "BUTTON"
                ? (el as HTMLInputElement | HTMLButtonElement).type
                : null,
            css: {
              fontFamily: cs.fontFamily,
              fontSize,
              lineHeight,
              letterSpacing,
              wordSpacing,
              textTransform,
              fontWeight: cs.fontWeight,
              fontStyle: cs.fontStyle,
            },
          });
        });

        // ── Form field pass ────────────────────────────────────────────────
        // Capture input (non-hidden), textarea, select as single-atom elements.
        document.querySelectorAll<HTMLElement>(
          "input:not([type='hidden']), textarea, select"
        ).forEach((el) => {
          if (isAriaHidden(el)) return;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return;
          if (rect.top < 0 || rect.top >= viewportH) return;

          const cs = window.getComputedStyle(el);
          const position = cs.position;
          if (scrollOffset > 0 && (position === "fixed" || position === "sticky")) return;

          const tag = el.tagName.toUpperCase();
          const parent = el.parentElement;
          const grandparent = parent?.parentElement ?? null;

          const inputEl = el as HTMLInputElement;
          const fieldInputType =
            tag === "INPUT" ? inputEl.type : el.tagName.toLowerCase();

          const placeholder = inputEl.placeholder || null;
          const fieldName = el.getAttribute("name");
          const fieldId = el.id || null;
          const fieldValue =
            (el as HTMLInputElement).value || null;

          // Identifier text: prefer placeholder, then name, then id, then tag.
          const identText = placeholder ?? fieldName ?? fieldId ?? el.tagName.toLowerCase();

          const fontSize = parseFloat(cs.fontSize) || 16;
          const lineHeightRaw = cs.lineHeight;
          const lineHeight =
            lineHeightRaw === "normal" ? fontSize * 1.2 : parseFloat(lineHeightRaw);

          results.push({
            text: identText,
            tag: el.tagName.toLowerCase(),
            ariaRole: el.getAttribute("role"),
            containerGeom: {
              x: rect.left,
              y: rect.top,
              w: rect.width,
              h: rect.height,
            },
            scrollOffset,
            isField: true,
            parentTag: parent?.tagName.toLowerCase() ?? "",
            parentRole: parent?.getAttribute("role") ?? null,
            grandparentTag: grandparent?.tagName.toLowerCase() ?? null,
            grandparentRole: grandparent?.getAttribute("role") ?? null,
            siblingInteractiveCount: countInteractiveSiblings(parent, el),
            ariaHidden: false,
            disabled:
              el.hasAttribute("disabled") ||
              el.getAttribute("aria-disabled") === "true",
            ariaLabel: el.getAttribute("aria-label"),
            titleAttr: el.getAttribute("title"),
            inputType: fieldInputType,
            placeholder,
            fieldName,
            fieldId,
            fieldValue,
            required: (el as HTMLInputElement).required ?? false,
            css: {
              fontFamily: cs.fontFamily,
              fontSize,
              lineHeight,
              letterSpacing: 0,
              wordSpacing: 0,
              textTransform: "none",
              fontWeight: cs.fontWeight,
              fontStyle: cs.fontStyle,
            },
          });
        });

        return results;
      },
      { scrollOffset: scrollY, viewportH }
    );

    allAtoms.push(...(atoms as RawAtom[]));
  }

  // Restore scroll position before closing.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.close();

  return {
    url,
    viewport,
    atoms: allAtoms,
    fontUrls: [...new Set(collectedFontUrls)],
  };
}

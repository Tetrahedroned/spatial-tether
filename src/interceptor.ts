import { Browser, BrowserContext, chromium } from "playwright";

export interface RawAtom {
  text: string;
  tag: string;
  ariaRole: string | null;
  containerGeom: { x: number; y: number; w: number; h: number };
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
  viewport: { w: number; h: number } = { w: 1280, h: 800 }
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

  await page.goto(url, { waitUntil: "networkidle" });

  const atoms = await page.evaluate(() => {
    const LEAF_SELECTORS =
      "p, h1, h2, h3, h4, h5, h6, li, span, a, button, label, td, th, dt, dd, figcaption, caption, blockquote, cite, code, pre, small, strong, em, b, i";

    function applyTextTransform(text: string, transform: string): string {
      switch (transform) {
        case "uppercase":
          return text.toUpperCase();
        case "lowercase":
          return text.toLowerCase();
        case "capitalize":
          return text.replace(/\b\w/g, (c) => c.toUpperCase());
        default:
          return text;
      }
    }

    const results: Array<{
      text: string;
      tag: string;
      ariaRole: string | null;
      containerGeom: { x: number; y: number; w: number; h: number };
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

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const cs = window.getComputedStyle(el);
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

    return results;
  });

  await page.close();

  return {
    url,
    viewport,
    atoms: atoms as RawAtom[],
    fontUrls: [...new Set(collectedFontUrls)],
  };
}

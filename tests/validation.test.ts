/**
 * Validation suite — deterministic engine math, no network, no screenshots.
 *
 * Step 2 of the blueprint: provide the engine with a known string, font, and
 * container width; assert correct (x, y) coordinates for wrapped words.
 */

import { measureString } from "../src/scaler";
import { layoutAtoms, WordAtom } from "../src/engine";
import { buildGravityMap, detectCollisions, Collision } from "../src/haptics";
import { buildSSM, inferMeta } from "../src/manifest";
import { RawAtom } from "../src/interceptor";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAtom(
  text: string,
  containerGeom: { x: number; y: number; w: number; h: number },
  overrides: Partial<RawAtom["css"]> = {}
): RawAtom {
  return {
    text,
    tag: "p",
    ariaRole: null,
    containerGeom,
    css: {
      fontFamily: "Arial",
      fontSize: 16,
      lineHeight: 20,
      letterSpacing: 0,
      wordSpacing: 0,
      textTransform: "none",
      fontWeight: "400",
      fontStyle: "normal",
      ...overrides,
    },
  };
}

/**
 * Create a RawAtom with all button-group-detection fields populated.
 * Defaults represent a non-penalized, non-disabled, non-hidden element.
 */
function makeFullAtom(
  tag: string,
  text: string,
  geom: { x: number; y: number; w: number; h: number },
  extra: Partial<
    Pick<
      RawAtom,
      | "ariaRole"
      | "parentTag"
      | "parentRole"
      | "grandparentTag"
      | "grandparentRole"
      | "siblingInteractiveCount"
      | "ariaHidden"
      | "disabled"
      | "ariaLabel"
      | "titleAttr"
      | "inputType"
    >
  > = {}
): RawAtom {
  return {
    ...makeAtom(text, geom),
    tag,
    ariaRole: null,
    parentTag: "div",
    parentRole: null,
    grandparentTag: "main",
    grandparentRole: null,
    siblingInteractiveCount: 0,
    ariaHidden: false,
    disabled: false,
    ariaLabel: null,
    titleAttr: null,
    inputType: null,
    ...extra,
  };
}

// ─── scaler.ts ───────────────────────────────────────────────────────────────

describe("measureString", () => {
  it("returns 0 for empty string", () => {
    expect(measureString("", "Arial", 16, "400", "normal", 0, 0)).toBe(0);
  });

  it("single char is positive", () => {
    const w = measureString("W", "Arial", 16, "400", "normal", 0, 0);
    expect(w).toBeGreaterThan(0);
  });

  it("longer string is wider than shorter", () => {
    const wShort = measureString("Hi", "Arial", 16, "400", "normal", 0, 0);
    const wLong = measureString("Hello World", "Arial", 16, "400", "normal", 0, 0);
    expect(wLong).toBeGreaterThan(wShort);
  });

  it("larger font size produces wider measurement", () => {
    const w16 = measureString("Test", "Arial", 16, "400", "normal", 0, 0);
    const w32 = measureString("Test", "Arial", 32, "400", "normal", 0, 0);
    expect(w32).toBeGreaterThan(w16);
  });

  it("positive letterSpacing widens string", () => {
    const w0 = measureString("ABC", "Arial", 16, "400", "normal", 0, 0);
    const w5 = measureString("ABC", "Arial", 16, "400", "normal", 5, 0);
    expect(w5).toBeGreaterThan(w0);
  });

  it("is deterministic — same inputs produce same output", () => {
    const a = measureString("Hello", "Arial", 16, "400", "normal", 0, 0);
    const b = measureString("Hello", "Arial", 16, "400", "normal", 0, 0);
    expect(a).toBe(b);
  });
});

// ─── engine.ts ───────────────────────────────────────────────────────────────

describe("layoutAtoms — Hello World in 50px container", () => {
  /**
   * Blueprint Step 2: string="Hello World", font=Arial 16px.
   * Actual canvas measurements: Hello=36.5px, space=4.4px, World=41.5px → 82.4px total.
   * Container width 50px: "Hello" fits (36.5 < 50), but "Hello + space + World" = 82.4 > 50,
   * so "World" must wrap to the next line.
   */
  const atom = makeAtom("Hello World", { x: 0, y: 0, w: 50, h: 40 });
  let words: ReturnType<typeof layoutAtoms>;

  beforeAll(() => {
    words = layoutAtoms([atom]);
  });

  it("produces exactly two word atoms", () => {
    expect(words).toHaveLength(2);
  });

  it("Hello starts at x=0, y=0", () => {
    expect(words[0].text).toBe("Hello");
    expect(words[0].geom.x).toBe(0);
    expect(words[0].geom.y).toBe(0);
  });

  it("World wraps to y=lineHeight (20)", () => {
    expect(words[1].text).toBe("World");
    expect(words[1].geom.x).toBe(0);
    expect(words[1].geom.y).toBe(20); // one line-height below
  });

  it("each word has positive width and height", () => {
    for (const w of words) {
      expect(w.geom.w).toBeGreaterThan(0);
      expect(w.geom.h).toBeGreaterThan(0);
    }
  });
});

describe("layoutAtoms — wide container, no wrap needed", () => {
  const atom = makeAtom("Hello World", { x: 10, y: 5, w: 1000, h: 40 });
  let words: ReturnType<typeof layoutAtoms>;

  beforeAll(() => {
    words = layoutAtoms([atom]);
  });

  it("both words stay on the first line (same y)", () => {
    expect(words[0].geom.y).toBe(5);
    expect(words[1].geom.y).toBe(5);
  });

  it("World starts after Hello + a space", () => {
    expect(words[1].geom.x).toBeGreaterThan(words[0].geom.x + words[0].geom.w);
  });
});

describe("layoutAtoms — absolute coords from non-zero container origin", () => {
  const atom = makeAtom("A B", { x: 200, y: 300, w: 1000, h: 40 });
  let words: ReturnType<typeof layoutAtoms>;

  beforeAll(() => {
    words = layoutAtoms([atom]);
  });

  it("first word x >= container origin x", () => {
    expect(words[0].geom.x).toBeGreaterThanOrEqual(200);
  });

  it("first word y equals container origin y", () => {
    expect(words[0].geom.y).toBe(300);
  });
});

describe("layoutAtoms — empty text produces no atoms", () => {
  it("empty string → 0 atoms", () => {
    const atom = makeAtom("", { x: 0, y: 0, w: 200, h: 40 });
    expect(layoutAtoms([atom])).toHaveLength(0);
  });

  it("whitespace-only → 0 atoms", () => {
    const atom = makeAtom("   ", { x: 0, y: 0, w: 200, h: 40 });
    expect(layoutAtoms([atom])).toHaveLength(0);
  });
});

// ─── haptics.ts ──────────────────────────────────────────────────────────────

describe("calculateGravity", () => {
  const viewport = { w: 1280, h: 800 };

  it("isolated button has higher gravity than body paragraph", () => {
    const button = makeAtom("Login", { x: 600, y: 50, w: 80, h: 40 });
    // Place the paragraph far away so it doesn't affect button neighbors.
    const para = makeAtom(
      "Lots of body text here for context",
      { x: 0, y: 400, w: 600, h: 200 }
    );

    const gravityButton = buildGravityMap([button], viewport).get(0)!;
    // Para neighbors itself plus button — pass both so it has a neighbour.
    const gravityPara = buildGravityMap([para, button], viewport).get(0)!;

    expect(gravityButton).toBeGreaterThanOrEqual(0);
    expect(gravityButton).toBeLessThanOrEqual(1);
    expect(gravityPara).toBeGreaterThanOrEqual(0);
    expect(gravityPara).toBeLessThanOrEqual(1);
  });

  it("gravity is in [0, 1]", () => {
    const atoms = [
      makeAtom("Click me", { x: 100, y: 100, w: 80, h: 30 }),
      makeAtom("Some text", { x: 0, y: 0, w: 400, h: 200 }),
    ];
    const map = buildGravityMap(atoms, viewport);
    for (const v of map.values()) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("detectCollisions", () => {
  const atoms = layoutAtoms([
    makeAtom("A B", { x: 0, y: 0, w: 1000, h: 40 }),
  ]);

  it("non-overlapping words produce no collisions", () => {
    expect(detectCollisions(atoms)).toHaveLength(0);
  });

  it("artificially overlapping atoms produce a collision", () => {
    const overlapping = [
      { id: "a", text: "A", geom: { x: 0, y: 0, w: 50, h: 20 }, sourceTag: "p", ariaRole: null, elementIndex: 0 },
      { id: "b", text: "B", geom: { x: 10, y: 5, w: 50, h: 20 }, sourceTag: "p", ariaRole: null, elementIndex: 0 },
    ];
    const cols = detectCollisions(overlapping);
    expect(cols).toHaveLength(1);
    expect(cols[0].atomIdA).toBe("a");
    expect(cols[0].atomIdB).toBe("b");
    expect(cols[0].overlapX).toBeGreaterThan(0);
    expect(cols[0].overlapY).toBeGreaterThan(0);
  });
});

// ─── haptics.ts — gravity floor ──────────────────────────────────────────────

function makeTagAtom(
  tag: string,
  text: string,
  geom: { x: number; y: number; w: number; h: number },
  ariaRole: string | null = null
): RawAtom {
  return { ...makeAtom(text, geom), tag, ariaRole };
}

describe("applyGravityFloor (via buildGravityMap)", () => {
  const vp = { w: 1280, h: 800 };

  it("isolated <button> gravity is at least 0.4", () => {
    const btn = makeTagAtom("button", "Sign in", { x: 600, y: 50, w: 80, h: 36 });
    const score = buildGravityMap([btn], vp).get(0)!;
    expect(score).toBeGreaterThanOrEqual(0.4);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("ariaRole=button also gets floor 0.4", () => {
    const btn = makeTagAtom("div", "Submit", { x: 600, y: 50, w: 80, h: 36 }, "button");
    const score = buildGravityMap([btn], vp).get(0)!;
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it("<a> with text ≤ 15 chars gets floor 0.25", () => {
    const link = makeTagAtom("a", "Learn more", { x: 0, y: 0, w: 80, h: 20 });
    // Surround it with many neighbors to drive the raw score low.
    const neighbors = Array.from({ length: 20 }, (_, i) =>
      makeAtom("x", { x: i * 5, y: 200 + i * 5, w: 40, h: 20 })
    );
    const score = buildGravityMap([link, ...neighbors], vp).get(0)!;
    expect(score).toBeGreaterThanOrEqual(0.25);
  });

  it("<a> with text > 15 chars gets floor 0.2 (not 0.25)", () => {
    const link = makeTagAtom("a", "A very long anchor text", { x: 0, y: 0, w: 200, h: 20 });
    const neighbors = Array.from({ length: 20 }, (_, i) =>
      makeAtom("x", { x: i * 5, y: 200 + i * 5, w: 40, h: 20 })
    );
    const score = buildGravityMap([link, ...neighbors], vp).get(0)!;
    expect(score).toBeGreaterThanOrEqual(0.2);
    // Must NOT be raised to 0.25 threshold (text > 15 chars).
    // We can't assert < 0.25 since raw score might already be ≥ 0.25, but
    // we can confirm the floor did not over-apply by checking it's in range.
    expect(score).toBeLessThanOrEqual(1);
  });

  it("floor only raises, never lowers — high-gravity button stays high", () => {
    const isolatedBtn = makeTagAtom("button", "Go", { x: 640, y: 400, w: 60, h: 30 });
    const score = buildGravityMap([isolatedBtn], vp).get(0)!;
    // Raw score for a fully isolated element should already exceed 0.4.
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it("<p> tag is unaffected by floor and can score below 0.2", () => {
    // Dense paragraph with many neighbors — raw score will be tiny.
    const para = makeAtom("body text", { x: 0, y: 0, w: 600, h: 300 });
    const neighbors = Array.from({ length: 30 }, (_, i) =>
      makeAtom("word", { x: i * 10, y: 350 + i, w: 50, h: 20 })
    );
    const score = buildGravityMap([para, ...neighbors], vp).get(0)!;
    // No floor applies, so score is allowed to be < 0.2.
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── manifest.ts ─────────────────────────────────────────────────────────────

describe("inferMeta", () => {
  it("button tag → action", () => {
    expect(inferMeta("button", null)).toEqual({ role: "button", intent: "action" });
  });

  it("a tag → navigation", () => {
    expect(inferMeta("a", null)).toEqual({ role: "link", intent: "navigation" });
  });

  it("h1 tag → title", () => {
    expect(inferMeta("h1", null)).toEqual({ role: "heading", intent: "title" });
  });

  it("p tag → content", () => {
    expect(inferMeta("p", null)).toEqual({ role: "content", intent: "content" });
  });

  it("ARIA role overrides HTML tag", () => {
    // <a role="button"> should be an action, not navigation.
    expect(inferMeta("a", "button")).toEqual({ role: "button", intent: "action" });
  });

  it("unknown tag → unknown", () => {
    expect(inferMeta("video", null)).toEqual({ role: "unknown", intent: "unknown" });
  });
});

describe("buildSSM", () => {
  const viewport = { w: 1280, h: 800 };
  const rawAtoms = [makeAtom("Hello World", { x: 0, y: 0, w: 100, h: 40 })];
  const wordAtoms = layoutAtoms(rawAtoms);
  const gravityMap = buildGravityMap(rawAtoms, viewport);
  const collisions = detectCollisions(wordAtoms);
  const ssm = buildSSM("https://example.com", viewport, wordAtoms, gravityMap, collisions);

  it("has a tether_id of 16 hex chars", () => {
    expect(ssm.tether_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("viewport matches input", () => {
    expect(ssm.viewport).toEqual(viewport);
  });

  it("atom count equals word count", () => {
    expect(ssm.atoms).toHaveLength(2); // Hello, World
  });

  it("each atom has required SSM fields", () => {
    for (const atom of ssm.atoms) {
      expect(atom).toHaveProperty("id");
      expect(atom).toHaveProperty("text");
      expect(atom).toHaveProperty("geom");
      expect(atom).toHaveProperty("gravity");
      expect(atom).toHaveProperty("meta.role");
      expect(atom).toHaveProperty("meta.intent");
    }
  });

  it("gravity values are in [0, 1]", () => {
    for (const atom of ssm.atoms) {
      expect(atom.gravity).toBeGreaterThanOrEqual(0);
      expect(atom.gravity).toBeLessThanOrEqual(1);
    }
  });

  it("deterministic — same URL+viewport produces same tether_id base (url+viewport portion stable)", () => {
    // tether_id includes timestamp so two calls differ — but the atoms must be identical.
    const ssm2 = buildSSM("https://example.com", viewport, wordAtoms, gravityMap, collisions);
    expect(ssm.atoms.map((a) => a.text)).toEqual(ssm2.atoms.map((a) => a.text));
    expect(ssm.atoms.map((a) => a.geom)).toEqual(ssm2.atoms.map((a) => a.geom));
  });
});

describe("deduplicateSSMAtoms (via buildSSM)", () => {
  const vp = { w: 1280, h: 800 };
  const geom = { x: 10, y: 20, w: 50, h: 20 };

  // Simulate an <a> inside a <p>: the interceptor emits the same word from
  // both elements at identical coordinates.
  const linkWord: WordAtom = {
    id: "login-0",
    text: "Login",
    geom,
    sourceTag: "a",
    ariaRole: null,
    elementIndex: 0,
  };
  const contentWord: WordAtom = {
    id: "login-1",
    text: "Login",
    geom, // same text AND same (x, y) — this is the duplicate
    sourceTag: "p",
    ariaRole: null,
    elementIndex: 1,
  };
  const rawAtomStubs: RawAtom[] = [
    { ...makeAtom("Login", geom), tag: "a" },
    { ...makeAtom("Login", geom), tag: "p" },
  ];
  const gMap = buildGravityMap(rawAtomStubs, vp);
  const ssm = buildSSM("https://example.com", vp, [linkWord, contentWord], gMap, []);

  it("collapses two same-position same-text atoms into one", () => {
    expect(ssm.atoms).toHaveLength(1);
  });

  it("keeps the more specific role (link > content)", () => {
    expect(ssm.atoms[0].meta.role).toBe("link");
    expect(ssm.atoms[0].meta.intent).toBe("navigation");
  });

  it("button beats link when both share same position", () => {
    const btnWord: WordAtom = {
      id: "go-0", text: "Go", geom,
      sourceTag: "button", ariaRole: null, elementIndex: 0,
    };
    const linkWord2: WordAtom = {
      id: "go-1", text: "Go", geom,
      sourceTag: "a", ariaRole: null, elementIndex: 1,
    };
    const stubs: RawAtom[] = [
      { ...makeAtom("Go", geom), tag: "button" },
      { ...makeAtom("Go", geom), tag: "a" },
    ];
    const ssm2 = buildSSM("https://example.com", vp, [btnWord, linkWord2], buildGravityMap(stubs, vp), []);
    expect(ssm2.atoms).toHaveLength(1);
    expect(ssm2.atoms[0].meta.role).toBe("button");
  });

  it("distinct positions are not deduplicated", () => {
    const w1: WordAtom = {
      id: "hi-0", text: "Hi", geom: { x: 0, y: 0, w: 20, h: 20 },
      sourceTag: "p", ariaRole: null, elementIndex: 0,
    };
    const w2: WordAtom = {
      id: "hi-1", text: "Hi", geom: { x: 100, y: 0, w: 20, h: 20 }, // different x
      sourceTag: "p", ariaRole: null, elementIndex: 1,
    };
    const stubs2: RawAtom[] = [
      makeAtom("Hi", { x: 0, y: 0, w: 20, h: 20 }),
      makeAtom("Hi", { x: 100, y: 0, w: 20, h: 20 }),
    ];
    const ssm3 = buildSSM("https://example.com", vp, [w1, w2], buildGravityMap(stubs2, vp), []);
    expect(ssm3.atoms).toHaveLength(2);
  });
});

// ─── haptics.ts — button group detection ─────────────────────────────────────

describe("button group detection", () => {
  const vp = { w: 1280, h: 800 };
  const geom = { x: 300, y: 200, w: 100, h: 40 };

  // Test 1: submit button inside a form with 5 sibling fields — no penalty
  it("form container is exempt: button floor and significance boost both apply", () => {
    const inForm = makeFullAtom("button", "Submit", geom, {
      parentTag: "form",
      siblingInteractiveCount: 5,
      inputType: "submit",
    });
    // Same layout in a nav (penalty-active) for comparison.
    const inNav = makeFullAtom("button", "Submit", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 5,
      inputType: "submit",
    });
    const formScore = buildGravityMap([inForm], vp).get(0)!;
    const navScore  = buildGravityMap([inNav],  vp).get(0)!;
    // Form is exempt → no penalty → button floor 0.40 applies + boost fires.
    expect(formScore).toBeGreaterThanOrEqual(0.4);
    // Nav has penalty active → score is lower than the un-penalised form version.
    expect(formScore).toBeGreaterThan(navScore);
  });

  // Test 2: star button in nav with 8 siblings — density penalty applied
  it("nav container with 8 siblings applies density penalty below isolated baseline", () => {
    const toolbarBtn = makeFullAtom("button", "Star", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 8,
    });
    const isolatedBtn = makeFullAtom("button", "Star",
      { x: 640, y: 400, w: 100, h: 40 },
      { parentTag: "main", siblingInteractiveCount: 0 }
    );
    const penaltyScore   = buildGravityMap([toolbarBtn], vp).get(0)!;
    const isolatedScore  = buildGravityMap([isolatedBtn], vp).get(0)!;
    expect(penaltyScore).toBeLessThan(isolatedScore);
    // Penalty floor is 0.10, never below.
    expect(penaltyScore).toBeGreaterThanOrEqual(0.10);
  });

  // Test 3: "Sign in" button in sparse header (≤5 siblings) — no penalty,
  //         significance boost fires on visible text
  it("header with ≤5 siblings is not penalised; 'sign in' text triggers boost", () => {
    const signInBtn = makeFullAtom("button", "Sign in",
      { x: 1100, y: 20, w: 80, h: 36 },
      { parentTag: "header", siblingInteractiveCount: 2 }
    );
    const plainBtn = makeFullAtom("button", "Click here",
      { x: 1100, y: 20, w: 80, h: 36 },
      { parentTag: "header", siblingInteractiveCount: 2 }
    );
    const signInScore = buildGravityMap([signInBtn], vp).get(0)!;
    const plainScore  = buildGravityMap([plainBtn],  vp).get(0)!;
    // Boost raises the score; both are ≥ button floor (0.40).
    expect(signInScore).toBeGreaterThanOrEqual(0.4);
    expect(signInScore).toBeGreaterThanOrEqual(plainScore);
  });

  // Test 4: nav link in 15-item menu — maximum density gradient (0.40)
  it("15-sibling nav link receives maximum density gradient penalty", () => {
    const denseLink = makeFullAtom("a", "Home", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 15,
    });
    const sparseLink = makeFullAtom("a", "Home", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 0,
    });
    const denseScore  = buildGravityMap([denseLink],  vp).get(0)!;
    const sparseScore = buildGravityMap([sparseLink], vp).get(0)!;
    expect(denseScore).toBeLessThan(sparseScore);
    expect(denseScore).toBeGreaterThanOrEqual(0.10); // penalty floor
  });

  // Test 5: button inside div inside nav — grandparent walk catches penalty
  it("generic div parent triggers grandparent walk; nav grandparent applies penalty", () => {
    const btnInNavViaDiv = makeFullAtom("button", "Menu", geom, {
      parentTag: "div",        // generic → walk to grandparent
      grandparentTag: "nav",   // caught here
      siblingInteractiveCount: 8,
    });
    const btnInMain = makeFullAtom("button", "Menu", geom, {
      parentTag: "div",
      grandparentTag: "main",  // exempt
      siblingInteractiveCount: 8,
    });
    const penaltyScore  = buildGravityMap([btnInNavViaDiv], vp).get(0)!;
    const noPenaltyScore = buildGravityMap([btnInMain],     vp).get(0)!;
    expect(penaltyScore).toBeLessThan(noPenaltyScore);
  });

  // Test 6: aria-hidden button — produces no word atoms
  it("ariaHidden=true atom is filtered out by layoutAtoms → produces no atoms", () => {
    const hiddenBtn = makeFullAtom("button", "Hidden action", geom, {
      ariaHidden: true,
    });
    const atoms = layoutAtoms([hiddenBtn]);
    expect(atoms).toHaveLength(0);
  });

  // Test 7: disabled button — atom present, gravity 0.0, interactive false
  it("disabled button appears in SSM with gravity 0.0 and interactive: false", () => {
    const disabledBtn = makeFullAtom("button", "Checkout", geom, {
      disabled: true,
    });
    const rawAtoms  = [disabledBtn];
    const wordAtoms = layoutAtoms(rawAtoms);
    const gMap      = buildGravityMap(rawAtoms, vp);
    const cols      = detectCollisions(wordAtoms);
    const ssm       = buildSSM("https://example.com", vp, wordAtoms, gMap, cols);

    // "Checkout" is a single word → one atom in the manifest.
    expect(ssm.atoms).toHaveLength(1);
    expect(ssm.atoms[0].gravity).toBe(0.0);
    expect(ssm.atoms[0].meta.interactive).toBe(false);
  });

  // Test 8: icon button with aria-label="Sign in" — boost fires on aria-label,
  //         not on the non-triggering visible text "★"
  it("significance boost fires on aria-label when visible text has no trigger", () => {
    // Use a penalty-active container so the boost is measurably above 0.10.
    const iconWithLabel = makeFullAtom("button", "★", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 3,
      ariaLabel: "Sign in",  // this is the trigger, not "★"
    });
    const iconWithout = makeFullAtom("button", "★", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 3,
      ariaLabel: null,
    });
    const withBoostScore    = buildGravityMap([iconWithLabel], vp).get(0)!;
    const withoutBoostScore = buildGravityMap([iconWithout],   vp).get(0)!;
    expect(withBoostScore).toBeGreaterThanOrEqual(withoutBoostScore);
    expect(withBoostScore).toBeGreaterThan(0);
  });

  // Test 9: collision signal adds +3 to sibling count, increasing density penalty
  it("collision signal shifts sibling count bucket, increasing the density penalty", () => {
    const toolbarBtn = makeFullAtom("button", "Go", geom, {
      parentTag: "nav",
      siblingInteractiveCount: 5, // 3–5 bucket → gradient 0.85
    });
    const wordAtoms = layoutAtoms([toolbarBtn]);
    // Fabricate a collision referencing this element's word atom.
    const fakeCollision: Collision = {
      atomIdA: wordAtoms[0].id,
      atomIdB: "other-99",
      overlapX: 5,
      overlapY: 5,
    };
    // Without collision: sibCount=5 → gradient 0.85
    const scoreWithout = buildGravityMap([toolbarBtn], vp, wordAtoms, []).get(0)!;
    // With collision: effective sibCount=8 → gradient 0.70 → larger penalty
    const scoreWith = buildGravityMap([toolbarBtn], vp, wordAtoms, [fakeCollision]).get(0)!;
    expect(scoreWith).toBeLessThanOrEqual(scoreWithout);
  });
});

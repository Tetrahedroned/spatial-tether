# Spatial-Tether Benchmark Results

**Date:** 2026-04-10
**Viewport:** 1280×800

## 1. Determinism

Target: `https://github.com/Tetrahedroned/spatial-tether`
Runs: 10 | Atoms per run: 2099

| Metric | Value |
|--------|-------|
| All hashes match | **YES** |
| Variance detected | NO |
| SHA-256 (atoms+collisions) | `0de686c6e42be18e…` |
| Runs | 10 |

## 2. Coordinate Accuracy

Target: `https://example.com`
Ground truth: Playwright `getBoundingClientRect()`

| Element | Atom | GT x | GT y | SSM x | SSM y | Δx | Δy | Δ (px) |
|---------|------|------|------|-------|-------|-----|-----|--------|
| h1 word-1 (x+y) | `Example` | 256 | 120 | 256 | 120 | 0 | 0 | 0 |
| h1 word-2 (y only) | `Domain` | 256 | 120 | 364.31 | 120 | 108.31 | 0 | 0 |
| p[0] word-1 (x+y) | `This` | 256 | 169.08 | 256 | 169.08 | 0 | 0 | 0 |
| p[0] word-2 (y only) | `domain` | 256 | 169.08 | 290.73 | 169.08 | 34.73 | 0 | 0 |
| p[0] word-3 (y only) | `is` | 256 | 169.08 | 352.36 | 169.08 | 96.36 | 0 | 0 |

**Average delta:** 0 px | **Max delta:** 0 px

## 3. Token Cost Comparison

Target: `https://github.com/Tetrahedroned/spatial-tether`
Estimates: base64_chars / 3 for screenshots, json_chars / 4 for SSM.

| Representation | Size | Estimated Tokens |
|---------------|------|-----------------|
| Screenshot (full-page PNG → base64) | 1,044,803 bytes raw / 1,393,072 base64 chars | **464,357** |
| SSM JSON (2,099 atoms) | 431,697 chars | **107,924** |

**Ratio:** screenshot is **4.3×** more tokens than SSM
**Tokens saved per page:** 356,433

## Reproduce

```bash
npm install -g spatial-tether
npx playwright install chromium
npm run benchmark
```

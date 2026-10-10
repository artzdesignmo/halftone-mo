# Halftone Mo

Turn any image into risograph-style halftone poster art — right in your browser. No uploads, no servers, no sign-up.

![Halftone Mo demo](demo.png)

## Features

- **Real-time halftone preview** — dot size and screen-angle controls, rendered live on canvas
- **True duotone engine** — two ink screens printed at different angles with multiply blending, just like real risograph overprinting
- **Two ink color pickers** plus 6 curated duotone presets (classic riso combos: fluorescent pink + teal, blue + red, black + gold…)
- **Paper stocks** — white, cream, kraft, and a dark-paper mode that switches the ink blending automatically
- **Paper grain & texture toggle** — noise + vignette for a printed feel
- **Brightness / contrast** adjustments baked into the tone curve
- **One-click high-res PNG export** (3000px long edge, dot density matched to preview)
- **3 built-in generative sample artworks** — play immediately with zero uploads
- **100% offline** — vanilla HTML/CSS/JS + canvas, zero dependencies, zero network requests. Double-click `index.html` and go.

## Run it

No build step. No server. Just open `index.html` in any modern browser.

Tip: every control is also a URL parameter, so settings are shareable, e.g.
`index.html?sample=1&dots=14&angle=60&inkA=%23ff48b0&inkB=%2300a9a5`

## How it works

1. The source image is reduced to a luminance field (with brightness/contrast applied).
2. **Ink A** prints a halftone dot screen of the *shadows* at a fixed 15° angle.
3. **Ink B** prints a halftone dot screen of the *highlights* at your chosen angle — the separation avoids moiré, like real print screens.
4. Both inks composite with `multiply` on light paper (`screen` on dark paper), then grain is laid on top.

## License

MIT — see [LICENSE](LICENSE). Have fun, make posters.

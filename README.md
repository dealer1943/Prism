# Prism

Top-down light lab: black room, white laser, mirrors and prisms. Compose light art in the browser (Vite + Three.js).

## Vision

A quiet optical sandbox. Orthographic top-down camera. Light source is always white. Place a laser at any angle; bounce it with mirrors; bend it with prisms. The room stays black so beams read as luminous drawings.

## Play

```bash
npm install
npm run dev
```

Node `>=18 <21`. Works on Windows / Linux / macOS browsers.

| Input | Action |
| --- | --- |
| Tool menu / keys `1` `2` `3` | Laser / mirror / prism |
| Click empty space | Place current optic |
| Drag optic | Move |
| Scroll over optic | Fine rotate |
| `R` / Rotate tool | Step rotate |
| `E` | Erase |
| `M` / Shift-click | Move mode |
| Clear lab | Reset |

## Develop

```
src/
  main.ts          # lab boot, input, starter layout
  lab/
    types.ts
    optics.ts      # meshes + laser emit point
    rays.ts        # 2D raycast reflect / refract
  style.css
```

## Build slices (ship independently)

- **S1 (done):** Laser + mirrors — place, drag, scroll-rotate, soft white beams, bounce skip, modular `lab/`
- **S2 (next):** Prism enter/exit refraction polish + tool palette UX
- **S3 (next):** Save / load layouts (localStorage) + shareable JSON

## Roadmap

- Spectral split (still white source → RGB art mode toggle)
- Lenses, apertures, blockers
- Kinetic rotating optics
- Export SVG / PNG ray diagrams

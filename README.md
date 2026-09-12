# Prism

Top-down light lab: black room, white laser, mirrors and prisms. Compose light art in the browser (Vite + Three.js).

## Vision

A quiet optical sandbox. Orthographic top-down camera. Light source is always white. Place a laser at any angle; bounce it with mirrors; bend it with prisms. White stays white until it **exits a prism**, then disperses into R/G/B. The room stays black so beams read as luminous drawings.

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
| **Right-click optic** | Aim dial — drag ring, 1° snap, live `NNN°` |
| **Double-click optic** | Action ring — Clone (mirrors/prisms; one laser only) |
| Scroll over optic | Coarse ±1° rotate |
| `E` | Erase |
| `M` / Shift-click | Move mode |
| Save / Load | Browser localStorage |
| Export / Import | Shareable JSON layout |
| Clear lab | Reset |

## Develop

```
src/
  main.ts             # lab boot, input, starter layout
  ui/ringMenu.ts      # on-object rotate dial + action ring
  lab/
    types.ts
    optics.ts         # physical laser / mirror / prism meshes
    rays.ts           # reflect / refract + spectral split
    persist.ts        # save / load / JSON
  style.css
```

## Build slices

- **S1:** Laser + mirrors — place, drag, soft beams
- **S2:** Prism enter/exit refraction + TIR
- **S3:** Save / load layouts
- **Polish:** Ring aim UI, RGB dispersion, lab-laser look

## Optics notes

- White laser emits white only.
- On prism **exit**, white splits into R/G/B with IOR ≈ 1.514 / 1.520 / 1.528.
- Colored beams keep their channel through mirrors and further prisms.

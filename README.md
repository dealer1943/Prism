# Prism

## Vision

Prism is a top-down light lab: a black room, a placeable white laser with angle control, and optics — mirrors and prisms — that reflect and refract to draw light art. The camera is orthographic and top-down; light is white only. Interaction is drag/click to place and a rotate tool for aiming. The simplest honest implementation casts 2D ray segments as bright Three.js lines on a black plane. The long-term feel is a quiet optical sandbox for composing luminous diagrams and discovering accidental geometries.

## Play

```bash
npm install
npm run dev
```

Use the tool menu to place a laser, mirrors, or prisms. Switch to **Rotate** and click an optic to turn it. Rays update live. **Erase** removes nearest optic; **Clear optics** resets the table.

## Develop

```
prism/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    main.ts       # orthographic lab, 2D raycast reflect/refract, tools
    style.css
    vite-env.d.ts
```

## Roadmap

- Spectral white → RGB split through prisms
- Curved mirrors and lenses
- Save / share light art layouts
- Beam blockers and apertures
- Animated rotating optics for kinetic light art
- Export frames / SVG ray diagrams

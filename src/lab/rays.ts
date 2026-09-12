import * as THREE from "three";
import type { Optic } from "./types";
import { laserDir, laserOrigin } from "./optics";

const IOR_WHITE = 1.52;
const MAX_BOUNCES = 40;
const MAX_DIST = 52;

/** Spectral channels after prism dispersion (ROYGBIV). */
export type SpectralId =
  | "white"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "indigo"
  | "violet";

const SPECTRA: Record<
  Exclude<SpectralId, "white">,
  { ior: number; color: number; glow: number }
> = {
  red: { ior: 1.513, color: 0xff1a1a, glow: 0xff5555 },
  orange: { ior: 1.515, color: 0xff7a12, glow: 0xffaa55 },
  yellow: { ior: 1.517, color: 0xffe014, glow: 0xfff088 },
  green: { ior: 1.52, color: 0x1cff4a, glow: 0x88ffaa },
  blue: { ior: 1.523, color: 0x1a6aff, glow: 0x6699ff },
  indigo: { ior: 1.526, color: 0x4b0082, glow: 0x8866cc },
  violet: { ior: 1.53, color: 0x9b30ff, glow: 0xcc88ff },
};

const ROYGBIV: Exclude<SpectralId, "white">[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "indigo",
  "violet",
];

function iorFor(spectral: SpectralId): number {
  if (spectral === "white") return IOR_WHITE;
  return SPECTRA[spectral].ior;
}

function reflect(dir: THREE.Vector2, normal: THREE.Vector2): THREE.Vector2 {
  const n = normal.clone().normalize();
  return dir.clone().sub(n.multiplyScalar(2 * dir.dot(n))).normalize();
}

/** eta = n1/n2 relative; normal points against incoming if needed. */
function refract2d(dir: THREE.Vector2, normal: THREE.Vector2, eta: number): THREE.Vector2 | null {
  const n = normal.clone().normalize();
  const d = dir.clone().normalize();
  let cosi = THREE.MathUtils.clamp(-n.dot(d), -1, 1);
  let et = eta;
  let nn = n;
  if (cosi < 0) {
    cosi = -cosi;
    nn = n.clone().negate();
    et = 1 / eta;
  }
  const k = 1 - et * et * (1 - cosi * cosi);
  if (k < 0) return null; // TIR
  return d.multiplyScalar(et).add(nn.multiplyScalar(et * cosi - Math.sqrt(k))).normalize();
}

function raySegIntersect(
  origin: THREE.Vector2,
  dir: THREE.Vector2,
  a: THREE.Vector2,
  b: THREE.Vector2,
): number | null {
  const v1 = origin.clone().sub(a);
  const v2 = b.clone().sub(a);
  const v3 = new THREE.Vector2(-dir.y, dir.x);
  const den = v2.dot(v3);
  if (Math.abs(den) < 1e-9) return null;
  const t1 = (v2.x * v1.y - v2.y * v1.x) / den;
  const t2 = v1.dot(v3) / den;
  if (t1 >= 1e-4 && t2 >= 0 && t2 <= 1) return t1;
  return null;
}

function mirrorSegment(o: Optic): { a: THREE.Vector2; b: THREE.Vector2; normal: THREE.Vector2 } {
  const half = 0.75;
  const along = new THREE.Vector2(Math.cos(o.angle), Math.sin(o.angle));
  const normal = new THREE.Vector2(-Math.sin(o.angle), Math.cos(o.angle));
  return {
    a: o.pos.clone().add(along.clone().multiplyScalar(-half)),
    b: o.pos.clone().add(along.clone().multiplyScalar(half)),
    normal,
  };
}

function prismVerts(o: Optic): THREE.Vector2[] {
  const local = [
    new THREE.Vector2(0, 0.75),
    new THREE.Vector2(-0.65, -0.5),
    new THREE.Vector2(0.65, -0.5),
  ];
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return local.map(
    (v) => new THREE.Vector2(o.pos.x + v.x * c - v.y * s, o.pos.y + v.x * s + v.y * c),
  );
}

function hitMirror(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2) {
  const { a, b, normal } = mirrorSegment(o);
  const t = raySegIntersect(origin, dir, a, b);
  if (t === null) return null;
  const n = normal.clone();
  if (dir.dot(n) > 0) n.negate();
  return { t, normal: n };
}

function hitPrismFace(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2) {
  const verts = prismVerts(o);
  let bestT = Infinity;
  let bestN: THREE.Vector2 | null = null;
  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 3];
    const t = raySegIntersect(origin, dir, a, b);
    if (t !== null && t < bestT) {
      bestT = t;
      const edge = b.clone().sub(a);
      const n = new THREE.Vector2(-edge.y, edge.x).normalize();
      if (dir.dot(n) > 0) n.negate();
      bestN = n;
    }
  }
  if (!bestN || !Number.isFinite(bestT)) return null;
  return { t: bestT, normal: bestN };
}

function clearRays(rayGroup: THREE.Group) {
  while (rayGroup.children.length) {
    const c = rayGroup.children[0];
    rayGroup.remove(c);
    if (c instanceof THREE.Line || c instanceof THREE.Mesh) {
      c.geometry.dispose();
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of mats) m.dispose();
    }
  }
}

function beamColors(spectral: SpectralId): { core: number; glow: number } {
  if (spectral === "white") return { core: 0xffffff, glow: 0xaaccff };
  return { core: SPECTRA[spectral].color, glow: SPECTRA[spectral].glow };
}

function addRaySeg(
  rayGroup: THREE.Group,
  a: THREE.Vector2,
  b: THREE.Vector2,
  intensity: number,
  spectral: SpectralId,
) {
  const { core, glow } = beamColors(spectral);
  const y = 0.18;
  const pts = [new THREE.Vector3(a.x, y, a.y), new THREE.Vector3(b.x, y, b.y)];

  // Soft glow halo (additive)
  const glowGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const glowMat = new THREE.LineBasicMaterial({
    color: glow,
    transparent: true,
    opacity: Math.min(0.55, 0.18 + intensity * 0.35),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  rayGroup.add(new THREE.Line(glowGeo, glowMat));

  // Bright core
  const coreGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const coreMat = new THREE.LineBasicMaterial({
    color: core,
    transparent: true,
    opacity: Math.min(1, 0.55 + intensity * 0.45),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  rayGroup.add(new THREE.Line(coreGeo, coreMat));

  // Thin cylinder for volume feel when segment is long enough
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dz);
  if (len > 0.15) {
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, len, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: core,
        transparent: true,
        opacity: Math.min(0.85, 0.35 + intensity * 0.5),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    cyl.position.set((a.x + b.x) / 2, y, (a.y + b.y) / 2);
    cyl.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, 0, dz).normalize(),
    );
    rayGroup.add(cyl);

    const halo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, len, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: glow,
        transparent: true,
        opacity: Math.min(0.28, 0.08 + intensity * 0.18),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.position.copy(cyl.position);
    halo.quaternion.copy(cyl.quaternion);
    rayGroup.add(halo);
  }
}

interface Beam {
  origin: THREE.Vector2;
  dir: THREE.Vector2;
  intensity: number;
  skipId: number | null;
  insidePrismId: number | null;
  depth: number;
  spectral: SpectralId;
}

function pushBeam(queue: Beam[], beam: Omit<Beam, "spectral"> & { spectral?: SpectralId }) {
  queue.push({
    ...beam,
    spectral: beam.spectral ?? "white",
  });
}

export function traceRays(optics: Optic[], rayGroup: THREE.Group) {
  clearRays(rayGroup);
  const laser = optics.find((o) => o.kind === "laser");
  if (!laser) return;

  const queue: Beam[] = [
    {
      origin: laserOrigin(laser),
      dir: laserDir(laser),
      intensity: 1,
      skipId: laser.id,
      insidePrismId: null,
      depth: 0,
      spectral: "white",
    },
  ];

  let steps = 0;
  while (queue.length && steps++ < 280) {
    const beam = queue.shift()!;
    if (beam.intensity < 0.05 || beam.depth > MAX_BOUNCES) continue;

    let bestT = MAX_DIST;
    let hit: { optic: Optic; normal: THREE.Vector2; t: number } | null = null;

    for (const o of optics) {
      if (o.id === beam.skipId) continue;
      if (o.kind === "laser") continue;
      let h: { t: number; normal: THREE.Vector2 } | null = null;
      if (o.kind === "mirror") {
        if (beam.insidePrismId !== null) continue;
        h = hitMirror(o, beam.origin, beam.dir);
      } else if (o.kind === "prism") {
        if (beam.insidePrismId !== null && beam.insidePrismId !== o.id) continue;
        h = hitPrismFace(o, beam.origin, beam.dir);
      }
      if (h && h.t > 0.035 && h.t < bestT) {
        bestT = h.t;
        hit = { optic: o, normal: h.normal, t: h.t };
      }
    }

    const end = beam.origin.clone().add(beam.dir.clone().multiplyScalar(bestT));
    addRaySeg(rayGroup, beam.origin, end, beam.intensity, beam.spectral);
    if (!hit) continue;

    const nextOrigin = end.clone().add(beam.dir.clone().multiplyScalar(0.04));

    if (hit.optic.kind === "mirror") {
      pushBeam(queue, {
        origin: nextOrigin,
        dir: reflect(beam.dir, hit.normal),
        intensity: beam.intensity * 0.96,
        skipId: hit.optic.id,
        insidePrismId: null,
        depth: beam.depth + 1,
        spectral: beam.spectral,
      });
      continue;
    }

    // Prism face
    const entering = beam.insidePrismId === null;

    if (entering) {
      const ior = iorFor(beam.spectral);
      const eta = 1 / ior;
      const refracted = refract2d(beam.dir, hit.normal, eta);
      if (!refracted) {
        pushBeam(queue, {
          origin: nextOrigin,
          dir: reflect(beam.dir, hit.normal),
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: null,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      } else {
        pushBeam(queue, {
          origin: nextOrigin,
          dir: refracted,
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: hit.optic.id,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      }
      continue;
    }

    // Exiting prism: white → ROYGBIV laser fans; colored stays its channel.
    if (beam.spectral === "white") {
      for (const ch of ROYGBIV) {
        const eta = SPECTRA[ch].ior; // n_glass / n_air when exiting
        const refracted = refract2d(beam.dir, hit.normal, eta);
        if (!refracted) {
          pushBeam(queue, {
            origin: nextOrigin,
            dir: reflect(beam.dir, hit.normal),
            intensity: beam.intensity * 0.8,
            skipId: hit.optic.id,
            insidePrismId: hit.optic.id,
            depth: beam.depth + 1,
            spectral: "white",
          });
        } else {
          pushBeam(queue, {
            origin: nextOrigin,
            dir: refracted,
            intensity: beam.intensity * 0.82,
            skipId: hit.optic.id,
            insidePrismId: null,
            depth: beam.depth + 1,
            spectral: ch,
          });
        }
      }
    } else {
      const eta = iorFor(beam.spectral);
      const refracted = refract2d(beam.dir, hit.normal, eta);
      if (!refracted) {
        pushBeam(queue, {
          origin: nextOrigin,
          dir: reflect(beam.dir, hit.normal),
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: hit.optic.id,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      } else {
        pushBeam(queue, {
          origin: nextOrigin,
          dir: refracted,
          intensity: beam.intensity * 0.9,
          skipId: hit.optic.id,
          insidePrismId: null,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      }
    }
  }
}

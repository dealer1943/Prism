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
  red: { ior: 1.514, color: 0xff0000, glow: 0xff3333 },
  orange: { ior: 1.517, color: 0xff7f00, glow: 0xff9933 },
  yellow: { ior: 1.52, color: 0xffff00, glow: 0xffff66 },
  green: { ior: 1.526, color: 0x00ff00, glow: 0x66ff66 },
  blue: { ior: 1.53, color: 0x0000ff, glow: 0x3366ff },
  indigo: { ior: 1.534, color: 0x4b0082, glow: 0x6a1b9a },
  violet: { ior: 1.538, color: 0x8b00ff, glow: 0xaa55ff },
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

function prismFaces(o: Optic): { a: THREE.Vector2; b: THREE.Vector2; outward: THREE.Vector2; i: number }[] {
  const verts = prismVerts(o);
  const centroid = new THREE.Vector2(
    (verts[0].x + verts[1].x + verts[2].x) / 3,
    (verts[0].y + verts[1].y + verts[2].y) / 3,
  );
  const faces = [];
  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 3];
    const edge = b.clone().sub(a);
    let outward = new THREE.Vector2(-edge.y, edge.x).normalize();
    const mid = a.clone().add(b).multiplyScalar(0.5);
    // Ensure outward points away from centroid
    if (outward.dot(mid.clone().sub(centroid)) < 0) outward.negate();
    faces.push({ a, b, outward, i });
  }
  return faces;
}

function hitMirror(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2) {
  const { a, b, normal } = mirrorSegment(o);
  const t = raySegIntersect(origin, dir, a, b);
  if (t === null) return null;
  const n = normal.clone();
  if (dir.dot(n) > 0) n.negate();
  return { t, normal: n };
}

/** inside=false: only faces we approach from outside (dir·outward < 0).
 *  inside=true: only faces we approach from inside (dir·outward > 0) = exits.
 */
function hitPrismFace(
  o: Optic,
  origin: THREE.Vector2,
  dir: THREE.Vector2,
  inside: boolean,
  minT = 0.05,
) {
  let bestT = Infinity;
  let bestN: THREE.Vector2 | null = null;
  for (const f of prismFaces(o)) {
    const approach = dir.dot(f.outward);
    if (!inside && approach >= -1e-6) continue; // not hitting from outside
    if (inside && approach <= 1e-6) continue; // not leaving through this face
    const t = raySegIntersect(origin, dir, f.a, f.b);
    if (t !== null && t > minT && t < bestT) {
      bestT = t;
      // For refraction, normal should face against the incoming ray
      bestN = inside ? f.outward.clone().negate() : f.outward.clone().negate();
      // incoming from outside: outward points at us, we want normal opposing dir → -outward if dir·outward < 0
      // actually dir·outward < 0 outside means outward faces somewhat toward source; normal for Snell often outward.
      // Our refract2d expects normal that can be flipped via cosi. Use outward for enter (air→glass)
      // and outward for exit (glass→air) as geometric surface normal pointing out of glass.
      bestN = f.outward.clone();
    }
  }
  if (!bestN || !Number.isFinite(bestT)) return null;
  return { t: bestT, normal: bestN };
}


/** Keep continue-points on the correct side of a prism face (inside or outside). */
const FACE_EPS = 0.018;

function nudgeFromFace(
  hitPoint: THREE.Vector2,
  outward: THREE.Vector2,
  side: "inside" | "outside",
): THREE.Vector2 {
  const sign = side === "inside" ? -1 : 1;
  return hitPoint.clone().add(outward.clone().normalize().multiplyScalar(sign * FACE_EPS));
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
  const { core } = beamColors(spectral);
  const yCore = 0.22;
  const yUnder = 0.1;
  const pts = [new THREE.Vector3(a.x, yCore, a.y), new THREE.Vector3(b.x, yCore, b.y)];

  // Opaque core line — NormalBlending so ROYGBIV stays true (additive washes to white)
  const coreGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const coreMat = new THREE.LineBasicMaterial({
    color: core,
    transparent: true,
    opacity: Math.min(1, 0.95 + intensity * 0.05),
    depthWrite: false,
  });
  rayGroup.add(new THREE.Line(coreGeo, coreMat));

  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const len = Math.hypot(dx, dz);
  if (len > 0.12) {
    const mid = new THREE.Vector3((a.x + b.x) / 2, yCore, (a.y + b.y) / 2);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, 0, dz).normalize(),
    );

    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, len, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: core,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      }),
    );
    cyl.position.copy(mid);
    cyl.quaternion.copy(quat);
    rayGroup.add(cyl);

    // Wider undersurface reflection at 20% opacity
    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, len, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: core,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    );
    under.position.set(mid.x, yUnder, mid.z);
    under.quaternion.copy(quat);
    rayGroup.add(under);
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
      if (o.kind === "laser") continue;
      // While inside a prism, only that prism may be hit (for exit / TIR).
      // Do NOT skip the current prism via skipId — that blocked exit faces.
      if (beam.insidePrismId !== null) {
        if (o.kind !== "prism" || o.id !== beam.insidePrismId) continue;
      } else if (o.id === beam.skipId) {
        continue;
      }
      let h: { t: number; normal: THREE.Vector2 } | null = null;
      if (o.kind === "mirror") {
        h = hitMirror(o, beam.origin, beam.dir);
      } else if (o.kind === "prism") {
        const inside = beam.insidePrismId === o.id;
        h = hitPrismFace(o, beam.origin, beam.dir, inside, inside ? 0.02 : 0.03);
      }
      if (h && h.t > 0.01 && h.t < bestT) {
        bestT = h.t;
        hit = { optic: o, normal: h.normal, t: h.t };
      }
    }

    const end = beam.origin.clone().add(beam.dir.clone().multiplyScalar(bestT));
    addRaySeg(rayGroup, beam.origin, end, beam.intensity, beam.spectral);
    if (!hit) continue;

    // Mirror: tiny step along reflected path. Prism: stay on the face — nudge into glass on enter, out of glass on exit.
    if (hit.optic.kind === "mirror") {
      const reflected = reflect(beam.dir, hit.normal);
      pushBeam(queue, {
        origin: end.clone().add(reflected.clone().multiplyScalar(FACE_EPS)),
        dir: reflected,
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
        const bounced = reflect(beam.dir, hit.normal);
        pushBeam(queue, {
          origin: nudgeFromFace(end, hit.normal, "outside"),
          dir: bounced,
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: null,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      } else {
        // Continue from just inside the entry face so the path lives in the triangle
        pushBeam(queue, {
          origin: nudgeFromFace(end, hit.normal, "inside"),
          dir: refracted,
          intensity: beam.intensity * 0.95,
          skipId: null,
          insidePrismId: hit.optic.id,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      }
      continue;
    }

    // Exiting prism: white becomes SEVEN distinct ROYGBIV lasers.
    if (beam.spectral === "white") {
      // One glass→air refract (eta = n_glass/n_air), then fan colors in angle
      const base = refract2d(beam.dir, hit.normal, IOR_WHITE) ?? beam.dir.clone().normalize();
      const n = ROYGBIV.length;
      const exitOrigin = nudgeFromFace(end, hit.normal, "outside");
      ROYGBIV.forEach((ch, i) => {
        // ~3.6° steps → ~±10.8° fan so all seven read as separate forward beams
        const fan = ((i - (n - 1) / 2) * 3.6 * Math.PI) / 180;
        const ca = Math.cos(fan);
        const sa = Math.sin(fan);
        const dirOut = new THREE.Vector2(
          base.x * ca - base.y * sa,
          base.x * sa + base.y * ca,
        ).normalize();
        pushBeam(queue, {
          origin: exitOrigin.clone(),
          dir: dirOut,
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: null,
          depth: beam.depth + 1,
          spectral: ch,
        });
      });
    } else {
      const eta = iorFor(beam.spectral);
      const refracted = refract2d(beam.dir, hit.normal, eta);
      if (!refracted) {
        const bounced = reflect(beam.dir, hit.normal);
        pushBeam(queue, {
          origin: nudgeFromFace(end, hit.normal, "inside"),
          dir: bounced,
          intensity: beam.intensity * 0.92,
          skipId: hit.optic.id,
          insidePrismId: hit.optic.id,
          depth: beam.depth + 1,
          spectral: beam.spectral,
        });
      } else {
        pushBeam(queue, {
          origin: nudgeFromFace(end, hit.normal, "outside"),
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

import * as THREE from "three";
import type { Optic } from "./types";
import { laserDir, laserOrigin } from "./optics";

const IOR = 1.52;
const MAX_BOUNCES = 40;
const MAX_DIST = 52;

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
      // outward-ish: point against incoming
      if (dir.dot(n) > 0) n.negate();
      bestN = n;
    }
  }
  if (!bestN || !Number.isFinite(bestT)) return null;
  return { t: bestT, normal: bestN };
}

function clearRays(rayGroup: THREE.Group) {
  while (rayGroup.children.length) {
    const c = rayGroup.children[0] as THREE.Line;
    rayGroup.remove(c);
    c.geometry.dispose();
    (c.material as THREE.Material).dispose();
  }
}

function addRaySeg(rayGroup: THREE.Group, a: THREE.Vector2, b: THREE.Vector2, intensity: number) {
  const pts = [new THREE.Vector3(a.x, 0.16, a.y), new THREE.Vector3(b.x, 0.16, b.y)];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: Math.min(1, 0.45 + intensity * 0.55),
  });
  rayGroup.add(new THREE.Line(geo, mat));
  const geo2 = new THREE.BufferGeometry().setFromPoints(pts);
  const mat2 = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: Math.min(0.4, 0.14 + intensity * 0.22),
  });
  rayGroup.add(new THREE.Line(geo2, mat2));
}

interface Beam {
  origin: THREE.Vector2;
  dir: THREE.Vector2;
  intensity: number;
  skipId: number | null;
  insidePrismId: number | null;
  depth: number;
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
    },
  ];

  let steps = 0;
  while (queue.length && steps++ < 80) {
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
        // only consider this prism if we're outside any, or inside this one
        if (beam.insidePrismId !== null && beam.insidePrismId !== o.id) continue;
        h = hitPrismFace(o, beam.origin, beam.dir);
      }
      if (h && h.t > 0.035 && h.t < bestT) {
        bestT = h.t;
        hit = { optic: o, normal: h.normal, t: h.t };
      }
    }

    const end = beam.origin.clone().add(beam.dir.clone().multiplyScalar(bestT));
    addRaySeg(rayGroup, beam.origin, end, beam.intensity);
    if (!hit) continue;

    const nextOrigin = end.clone().add(beam.dir.clone().multiplyScalar(0.04));

    if (hit.optic.kind === "mirror") {
      queue.push({
        origin: nextOrigin,
        dir: reflect(beam.dir, hit.normal),
        intensity: beam.intensity * 0.96,
        skipId: hit.optic.id,
        insidePrismId: null,
        depth: beam.depth + 1,
      });
      continue;
    }

    // Prism face
    const entering = beam.insidePrismId === null;
    const eta = entering ? 1 / IOR : IOR;
    const refracted = refract2d(beam.dir, hit.normal, eta);
    if (!refracted) {
      // total internal reflection
      queue.push({
        origin: nextOrigin,
        dir: reflect(beam.dir, hit.normal),
        intensity: beam.intensity * 0.92,
        skipId: hit.optic.id,
        insidePrismId: hit.optic.id,
        depth: beam.depth + 1,
      });
    } else {
      queue.push({
        origin: nextOrigin,
        dir: refracted,
        intensity: beam.intensity * (entering ? 0.92 : 0.9),
        skipId: hit.optic.id,
        insidePrismId: entering ? hit.optic.id : null,
        depth: beam.depth + 1,
      });
    }
  }
}

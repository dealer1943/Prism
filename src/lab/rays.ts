import * as THREE from "three";
import type { Optic } from "./types";
import { laserDir, laserOrigin } from "./optics";

function reflect(dir: THREE.Vector2, normal: THREE.Vector2): THREE.Vector2 {
  const n = normal.clone().normalize();
  return dir.clone().sub(n.multiplyScalar(2 * dir.dot(n))).normalize();
}

function refract2d(dir: THREE.Vector2, normal: THREE.Vector2, eta: number): THREE.Vector2 {
  const n = normal.clone().normalize();
  let d = dir.clone().normalize();
  let cosi = -n.dot(d);
  let et = eta;
  if (cosi < 0) {
    cosi = -cosi;
    n.negate();
    et = 1 / eta;
  }
  const k = 1 - et * et * (1 - cosi * cosi);
  if (k < 0) return reflect(d, n);
  return d.multiplyScalar(et).add(n.multiplyScalar(et * cosi - Math.sqrt(k))).normalize();
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

function hitMirror(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2) {
  const half = 0.75;
  const along = new THREE.Vector2(Math.cos(o.angle), Math.sin(o.angle));
  const normal = new THREE.Vector2(-Math.sin(o.angle), Math.cos(o.angle));
  const a = o.pos.clone().add(along.clone().multiplyScalar(-half));
  const b = o.pos.clone().add(along.clone().multiplyScalar(half));
  const t = raySegIntersect(origin, dir, a, b);
  if (t === null) return null;
  const n = normal.clone();
  if (dir.dot(n) > 0) n.negate();
  return { t, normal: n };
}

function hitPrism(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2) {
  const local = [
    new THREE.Vector2(0, 0.75),
    new THREE.Vector2(-0.65, -0.5),
    new THREE.Vector2(0.65, -0.5),
  ];
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  const verts = local.map(
    (v) => new THREE.Vector2(o.pos.x + v.x * c - v.y * s, o.pos.y + v.x * s + v.y * c),
  );
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
    opacity: Math.min(1, 0.4 + intensity * 0.6),
  });
  rayGroup.add(new THREE.Line(geo, mat));
  // soft glow twin
  const geo2 = new THREE.BufferGeometry().setFromPoints(pts);
  const mat2 = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: Math.min(0.35, 0.12 + intensity * 0.2),
  });
  rayGroup.add(new THREE.Line(geo2, mat2));
}

export function traceRays(optics: Optic[], rayGroup: THREE.Group) {
  clearRays(rayGroup);
  const laser = optics.find((o) => o.kind === "laser");
  if (!laser) return;

  let origin = laserOrigin(laser);
  let dir = laserDir(laser);
  let intensity = 1;
  let skipId: number | null = laser.id;

  for (let bounce = 0; bounce < 32; bounce++) {
    let bestT = 48;
    let hit: { optic: Optic; normal: THREE.Vector2; t: number } | null = null;
    for (const o of optics) {
      if (o.id === skipId) continue;
      if (o.kind === "laser") continue;
      let h: { t: number; normal: THREE.Vector2 } | null = null;
      if (o.kind === "mirror") h = hitMirror(o, origin, dir);
      else if (o.kind === "prism") h = hitPrism(o, origin, dir);
      if (h && h.t > 0.04 && h.t < bestT) {
        bestT = h.t;
        hit = { optic: o, normal: h.normal, t: h.t };
      }
    }
    const end = origin.clone().add(dir.clone().multiplyScalar(bestT));
    addRaySeg(rayGroup, origin, end, intensity);
    if (!hit) break;
    origin = end.clone().add(dir.clone().multiplyScalar(0.03));
    skipId = hit.optic.id;
    if (hit.optic.kind === "mirror") {
      dir = reflect(dir, hit.normal);
      intensity *= 0.96;
    } else {
      // enter + exit approximation: bend twice along travel through prism
      dir = refract2d(dir, hit.normal, 1 / 1.5);
      intensity *= 0.88;
      // second face along new dir
      const h2 = hitPrism(hit.optic, origin, dir);
      if (h2 && h2.t > 0.05 && h2.t < 2.5) {
        const mid = origin.clone().add(dir.clone().multiplyScalar(h2.t));
        addRaySeg(rayGroup, origin, mid, intensity);
        origin = mid.add(dir.clone().multiplyScalar(0.03));
        dir = refract2d(dir, h2.normal, 1.5);
        intensity *= 0.9;
        skipId = hit.optic.id;
      }
    }
  }
}

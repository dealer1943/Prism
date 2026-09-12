import * as THREE from "three";
import type { Optic, OpticKind } from "./types";

let nextId = 1;

export function makeLaserMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.22, 0.38),
    new THREE.MeshBasicMaterial({ color: 0xf5f5f5 }),
  );
  body.position.set(0, 0.12, 0);
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.11, 0.4, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.48, 0.12, 0);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  glow.position.set(0.68, 0.12, 0);
  g.add(body, nose, glow);
  return g;
}

export function makeMirrorMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xc8e0ff }),
  );
  glass.position.y = 0.12;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x555566 }),
  );
  back.position.set(0, 0.12, 0.07);
  g.add(glass, back);
  return g;
}

export function makePrismMesh(): THREE.Object3D {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.75);
  shape.lineTo(-0.65, -0.5);
  shape.lineTo(0.65, -0.5);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.14, 0);
  return new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.5 }),
  );
}

export function createOptic(kind: OpticKind, x: number, z: number, angle = 0): Optic {
  let mesh: THREE.Object3D;
  if (kind === "laser") mesh = makeLaserMesh();
  else if (kind === "mirror") mesh = makeMirrorMesh();
  else mesh = makePrismMesh();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = -angle;
  return { id: nextId++, kind, pos: new THREE.Vector2(x, z), angle, mesh };
}

export function syncMesh(o: Optic) {
  o.mesh.position.set(o.pos.x, 0, o.pos.y);
  o.mesh.rotation.y = -o.angle;
}

/** Emission point slightly ahead of laser body along aim. */
export function laserOrigin(o: Optic): THREE.Vector2 {
  return o.pos.clone().add(new THREE.Vector2(Math.cos(o.angle), Math.sin(o.angle)).multiplyScalar(0.7));
}

export function laserDir(o: Optic): THREE.Vector2 {
  return new THREE.Vector2(Math.cos(o.angle), Math.sin(o.angle)).normalize();
}

import * as THREE from "three";
import type { Optic, OpticKind } from "./types";

let nextId = 1;

export function makeLaserMesh(): THREE.Object3D {
  const g = new THREE.Group();

  const barrelMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1e,
    metalness: 0.92,
    roughness: 0.28,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a32,
    metalness: 0.85,
    roughness: 0.35,
  });
  const apertureMat = new THREE.MeshStandardMaterial({
    color: 0x050508,
    metalness: 0.4,
    roughness: 0.6,
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 2.4,
    metalness: 0.1,
    roughness: 0.4,
  });

  // Cylindrical body along +X
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.72, 20), barrelMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0.05, 0.14, 0);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 20), accentMat);
  collar.rotation.z = Math.PI / 2;
  collar.position.set(-0.28, 0.14, 0);

  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.22, 16), barrelMat);
  nose.rotation.z = Math.PI / 2;
  nose.position.set(0.48, 0.14, 0);

  // Recessed aperture ring
  const aperture = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.04, 16), apertureMat);
  aperture.rotation.z = Math.PI / 2;
  aperture.position.set(0.6, 0.14, 0);

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), tipMat);
  tip.position.set(0.68, 0.14, 0);

  const light = new THREE.PointLight(0xffffff, 1.6, 4.5, 2);
  light.position.set(0.72, 0.14, 0);

  g.add(body, collar, nose, aperture, tip, light);
  return g;
}

export function makeMirrorMesh(): THREE.Object3D {
  const g = new THREE.Group();
  // Visible even in a black room: bright face + lit frame (avoid pure chrome on black).
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.12, 0.1),
    new THREE.MeshStandardMaterial({
      color: 0xd8e8ff,
      metalness: 0.55,
      roughness: 0.22,
      emissive: 0x6a90c8,
      emissiveIntensity: 0.55,
    }),
  );
  glass.position.y = 0.14;
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.16, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x8a90a0,
      metalness: 0.45,
      roughness: 0.45,
      emissive: 0x222830,
      emissiveIntensity: 0.25,
    }),
  );
  frame.position.set(0, 0.14, 0.02);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.28, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x555566,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0x111118,
      emissiveIntensity: 0.2,
    }),
  );
  stand.position.set(0, 0.02, 0.08);
  g.add(frame, glass, stand);
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
    new THREE.MeshStandardMaterial({
      color: 0xcfe8ff,
      metalness: 0.05,
      roughness: 0.12,
      transparent: true,
      opacity: 0.42,
      emissive: 0x203040,
      emissiveIntensity: 0.2,
    }),
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

/** Tangent (perpendicular to aim) for clone offset. */
export function opticTangent(o: Optic): THREE.Vector2 {
  return new THREE.Vector2(-Math.sin(o.angle), Math.cos(o.angle));
}

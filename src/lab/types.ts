import type * as THREE from "three";

export type OpticKind = "laser" | "mirror" | "prism";

export interface Optic {
  id: number;
  kind: OpticKind;
  /** XZ plane as Vector2(x, z) */
  pos: THREE.Vector2;
  /** Radians; 0 = +X */
  angle: number;
  mesh: THREE.Object3D;
}

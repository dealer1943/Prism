import * as THREE from "three";

type OpticKind = "laser" | "mirror" | "prism";

interface Optic {
  kind: OpticKind;
  pos: THREE.Vector2;
  angle: number;
  mesh: THREE.Object3D;
}

const canvas = document.getElementById("c") as HTMLCanvasElement;
const toolEl = document.getElementById("tool") as HTMLSelectElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const aspect = window.innerWidth / window.innerHeight;
const viewH = 20;
const camera = new THREE.OrthographicCamera(
  (-viewH * aspect) / 2,
  (viewH * aspect) / 2,
  viewH / 2,
  -viewH / 2,
  0.1,
  100
);
camera.position.set(0, 20, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshBasicMaterial({ color: 0x050508 })
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(40, 40, 0x1a1a22, 0x121218);
scene.add(grid);

const optics: Optic[] = [];
const rayGroup = new THREE.Group();
scene.add(rayGroup);

function makeLaserMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.2, 0.35),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  body.position.y = 0.1;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.35, 8),
    new THREE.MeshBasicMaterial({ color: 0xdddddd })
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.4, 0.1, 0);
  g.add(body, nose);
  return g;
}

function makeMirrorMesh(): THREE.Object3D {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.08, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xaaccff })
  );
  glass.position.y = 0.1;
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.06, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x666677 })
  );
  back.position.set(0, 0.1, 0.08);
  g.add(glass, back);
  return g;
}

function makePrismMesh(): THREE.Object3D {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.7);
  shape.lineTo(-0.6, -0.45);
  shape.lineTo(0.6, -0.45);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.12, 0);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xcceeff, transparent: true, opacity: 0.55 }));
}

function placeOptic(kind: OpticKind, x: number, z: number) {
  let mesh: THREE.Object3D;
  if (kind === "laser") mesh = makeLaserMesh();
  else if (kind === "mirror") mesh = makeMirrorMesh();
  else mesh = makePrismMesh();
  mesh.position.set(x, 0, z);
  const optic: Optic = { kind, pos: new THREE.Vector2(x, z), angle: kind === "laser" ? 0 : Math.PI / 4, mesh };
  mesh.rotation.y = -optic.angle;
  scene.add(mesh);
  optics.push(optic);
  if (kind === "laser") {
    // only one laser — remove previous lasers
    for (let i = optics.length - 2; i >= 0; i--) {
      if (optics[i].kind === "laser") {
        scene.remove(optics[i].mesh);
        optics.splice(i, 1);
      }
    }
  }
  traceRays();
}

function screenToWorld(clientX: number, clientY: number): THREE.Vector3 {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1
  );
  const v = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
  return new THREE.Vector3(v.x, 0, v.z);
}

function nearestOptic(x: number, z: number, maxDist = 1.2): Optic | null {
  let best: Optic | null = null;
  let bestD = maxDist;
  for (const o of optics) {
    const d = Math.hypot(o.pos.x - x, o.pos.y - z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

canvas.addEventListener("pointerdown", (e) => {
  const w = screenToWorld(e.clientX, e.clientY);
  const tool = toolEl.value;
  if (tool === "rotate") {
    const o = nearestOptic(w.x, w.z);
    if (o) {
      o.angle += Math.PI / 8;
      o.mesh.rotation.y = -o.angle;
      traceRays();
    }
    return;
  }
  if (tool === "erase") {
    const o = nearestOptic(w.x, w.z);
    if (o) {
      scene.remove(o.mesh);
      optics.splice(optics.indexOf(o), 1);
      traceRays();
    }
    return;
  }
  placeOptic(tool as OpticKind, w.x, w.z);
});

clearBtn.addEventListener("click", () => {
  optics.splice(0).forEach((o) => scene.remove(o.mesh));
  traceRays();
});

function reflect(dir: THREE.Vector2, normal: THREE.Vector2): THREE.Vector2 {
  const n = normal.clone().normalize();
  return dir.clone().sub(n.multiplyScalar(2 * dir.dot(n)));
}

function refractApprox(dir: THREE.Vector2, normal: THREE.Vector2, eta: number): THREE.Vector2 {
  // Snell-ish 2D bend toward/away from normal for stub prism
  const n = normal.clone().normalize();
  const d = dir.clone().normalize();
  const c = -n.dot(d);
  const bent = d.clone().add(n.clone().multiplyScalar((1 - eta) * c * 0.85)).normalize();
  return bent;
}

function hitMirror(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2): { t: number; normal: THREE.Vector2 } | null {
  // Segment centered at o.pos, oriented by angle (mirror faces along angle normal)
  const half = 0.7;
  const along = new THREE.Vector2(Math.cos(o.angle), Math.sin(o.angle));
  const normal = new THREE.Vector2(-Math.sin(o.angle), Math.cos(o.angle));
  const a = o.pos.clone().add(along.clone().multiplyScalar(-half));
  const b = o.pos.clone().add(along.clone().multiplyScalar(half));
  const r = raySegIntersect(origin, dir, a, b);
  if (!r) return null;
  if (dir.dot(normal) > 0) normal.negate();
  return { t: r, normal };
}

function hitPrism(o: Optic, origin: THREE.Vector2, dir: THREE.Vector2): { t: number; normal: THREE.Vector2 } | null {
  const verts = [
    new THREE.Vector2(0, 0.7),
    new THREE.Vector2(-0.6, -0.45),
    new THREE.Vector2(0.6, -0.45),
  ].map((v) => {
    const c = Math.cos(o.angle);
    const s = Math.sin(o.angle);
    return new THREE.Vector2(o.pos.x + v.x * c - v.y * s, o.pos.y + v.x * s + v.y * c);
  });
  let bestT = Infinity;
  let bestN: THREE.Vector2 | null = null;
  for (let i = 0; i < 3; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 3];
    const t = raySegIntersect(origin, dir, a, b);
    if (t !== null && t < bestT && t > 1e-4) {
      bestT = t;
      const edge = b.clone().sub(a);
      bestN = new THREE.Vector2(-edge.y, edge.x).normalize();
      if (dir.dot(bestN) > 0) bestN.negate();
    }
  }
  if (!bestN || !isFinite(bestT)) return null;
  return { t: bestT, normal: bestN };
}

function raySegIntersect(origin: THREE.Vector2, dir: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number | null {
  const v1 = origin.clone().sub(a);
  const v2 = b.clone().sub(a);
  const v3 = new THREE.Vector2(-dir.y, dir.x);
  const dot = v2.dot(v3);
  if (Math.abs(dot) < 1e-8) return null;
  const t1 = v2.cross(v1) / dot;
  const t2 = v1.dot(v3) / dot;
  if (t1 >= 0 && t2 >= 0 && t2 <= 1) return t1;
  return null;
}

function clearRays() {
  while (rayGroup.children.length) {
    const c = rayGroup.children[0] as THREE.Line;
    rayGroup.remove(c);
    c.geometry.dispose();
    (c.material as THREE.Material).dispose();
  }
}

function addRaySeg(a: THREE.Vector2, b: THREE.Vector2, intensity = 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.x, 0.15, a.y),
    new THREE.Vector3(b.x, 0.15, b.y),
  ]);
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: Math.min(1, 0.35 + intensity * 0.65),
  });
  rayGroup.add(new THREE.Line(geo, mat));
}

function traceRays() {
  clearRays();
  const laser = optics.find((o) => o.kind === "laser");
  if (!laser) return;

  let origin = laser.pos.clone();
  let dir = new THREE.Vector2(Math.cos(laser.angle), Math.sin(laser.angle)).normalize();
  let intensity = 1;

  for (let bounce = 0; bounce < 24; bounce++) {
    let bestT = 40;
    let hit: { optic: Optic; normal: THREE.Vector2; t: number } | null = null;
    for (const o of optics) {
      if (o === laser && bounce === 0) continue;
      let h: { t: number; normal: THREE.Vector2 } | null = null;
      if (o.kind === "mirror") h = hitMirror(o, origin, dir);
      else if (o.kind === "prism") h = hitPrism(o, origin, dir);
      if (h && h.t > 0.05 && h.t < bestT) {
        bestT = h.t;
        hit = { optic: o, normal: h.normal, t: h.t };
      }
    }
    const end = origin.clone().add(dir.clone().multiplyScalar(bestT));
    addRaySeg(origin, end, intensity);
    if (!hit) break;
    origin = end.clone().add(dir.clone().multiplyScalar(0.02));
    if (hit.optic.kind === "mirror") {
      dir = reflect(dir, hit.normal).normalize();
      intensity *= 0.95;
    } else {
      dir = refractApprox(dir, hit.normal, 1.45).normalize();
      intensity *= 0.85;
    }
  }
}

// Starter layout
placeOptic("laser", -6, 0);
placeOptic("mirror", 0, 2);
placeOptic("prism", 3, -1);
optics[1].angle = -Math.PI / 3;
optics[1].mesh.rotation.y = -optics[1].angle;
optics[2].angle = Math.PI / 6;
optics[2].mesh.rotation.y = -optics[2].angle;
traceRays();

window.addEventListener("resize", () => {
  const a = window.innerWidth / window.innerHeight;
  camera.left = (-viewH * a) / 2;
  camera.right = (viewH * a) / 2;
  camera.top = viewH / 2;
  camera.bottom = -viewH / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

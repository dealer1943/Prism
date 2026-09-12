import * as THREE from "three";
import { createOptic, syncMesh } from "./lab/optics";
import { traceRays } from "./lab/rays";
import type { Optic, OpticKind } from "./lab/types";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const toolEl = document.getElementById("tool") as HTMLSelectElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const hud = document.getElementById("hud") as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
const viewH = 22;
let aspect = window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(
  (-viewH * aspect) / 2,
  (viewH * aspect) / 2,
  viewH / 2,
  -viewH / 2,
  0.1,
  100,
);
camera.position.set(0, 24, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshBasicMaterial({ color: 0x030306 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(44, 44, 0x1c1c28, 0x101018);
scene.add(grid);

const optics: Optic[] = [];
const rayGroup = new THREE.Group();
scene.add(rayGroup);

function redraw() {
  traceRays(optics, rayGroup);
}

function place(kind: OpticKind, x: number, z: number) {
  if (kind === "laser") {
    for (let i = optics.length - 1; i >= 0; i--) {
      if (optics[i].kind === "laser") {
        scene.remove(optics[i].mesh);
        optics.splice(i, 1);
      }
    }
  }
  const angle = kind === "laser" ? 0 : Math.PI / 4;
  const o = createOptic(kind, x, z, angle);
  scene.add(o.mesh);
  optics.push(o);
  redraw();
  setHud(`${kind} placed · drag to move · scroll to rotate`);
}

function screenToWorld(clientX: number, clientY: number): THREE.Vector3 {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  const v = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
  return new THREE.Vector3(v.x, 0, v.z);
}

function nearest(x: number, z: number, maxDist = 1.35): Optic | null {
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

type DragMode = null | { optic: Optic; ox: number; oz: number; px: number; pz: number };
let drag: DragMode = null;

canvas.addEventListener("pointerdown", (e) => {
  const w = screenToWorld(e.clientX, e.clientY);
  const tool = toolEl.value;

  if (tool === "rotate") {
    const o = nearest(w.x, w.z);
    if (o) {
      o.angle += Math.PI / 12;
      syncMesh(o);
      redraw();
    }
    return;
  }
  if (tool === "erase") {
    const o = nearest(w.x, w.z);
    if (o) {
      scene.remove(o.mesh);
      optics.splice(optics.indexOf(o), 1);
      redraw();
    }
    return;
  }
  if (tool === "move" || e.shiftKey) {
    const o = nearest(w.x, w.z);
    if (o) {
      drag = { optic: o, ox: o.pos.x, oz: o.pos.y, px: w.x, pz: w.z };
      canvas.setPointerCapture(e.pointerId);
      setHud("Dragging · release to drop");
      return;
    }
  }
  if (tool === "laser" || tool === "mirror" || tool === "prism") {
    // click empty = place; click existing = start drag
    const o = nearest(w.x, w.z, 0.9);
    if (o) {
      drag = { optic: o, ox: o.pos.x, oz: o.pos.y, px: w.x, pz: w.z };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    place(tool, w.x, w.z);
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const w = screenToWorld(e.clientX, e.clientY);
  drag.optic.pos.set(drag.ox + (w.x - drag.px), drag.oz + (w.z - drag.pz));
  syncMesh(drag.optic);
  redraw();
});

canvas.addEventListener("pointerup", () => {
  if (drag) setHud("Moved · scroll over optic to rotate");
  drag = null;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY);
    const o = nearest(w.x, w.z, 1.6);
    if (!o) return;
    o.angle += Math.sign(e.deltaY) * (Math.PI / 36);
    syncMesh(o);
    redraw();
  },
  { passive: false },
);

clearBtn.addEventListener("click", () => {
  optics.splice(0).forEach((o) => scene.remove(o.mesh));
  redraw();
  setHud("Cleared · place a laser to cast light");
});

function setHud(msg: string) {
  hud.textContent = msg;
}

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "1") toolEl.value = "laser";
  if (k === "2") toolEl.value = "mirror";
  if (k === "3") toolEl.value = "prism";
  if (k === "r") toolEl.value = "rotate";
  if (k === "e") toolEl.value = "erase";
  if (k === "m") toolEl.value = "move";
  if (k === "c" && (e.ctrlKey || e.metaKey)) return;
  if (k === "escape") {
    optics.splice(0).forEach((o) => scene.remove(o.mesh));
    redraw();
  }
});

// Starter: laser + two mirrors (S1 demo path)
place("laser", -7, 0);
place("mirror", -1, 3);
place("mirror", 4, -2);
optics[1].angle = -Math.PI / 2.8;
optics[2].angle = Math.PI / 3.2;
syncMesh(optics[1]);
syncMesh(optics[2]);
redraw();
setHud("S1: laser + mirrors · 1/2/3 tools · drag move · scroll rotate · R/E keys");

window.addEventListener("resize", () => {
  aspect = window.innerWidth / window.innerHeight;
  camera.left = (-viewH * aspect) / 2;
  camera.right = (viewH * aspect) / 2;
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

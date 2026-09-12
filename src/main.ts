import * as THREE from "three";
import { createOptic, syncMesh, opticTangent } from "./lab/optics";
import { traceRays } from "./lab/rays";
import type { Optic, OpticKind } from "./lab/types";
import {
  saveLocal,
  loadLocal,
  downloadJson,
  parseLayoutFile,
  type Layout,
} from "./lab/persist";
import {
  openRotateRing,
  openActionRing,
  closeRingMenu,
  isRingMenuOpen,
} from "./ui/ringMenu";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const toolEl = document.getElementById("tool") as HTMLSelectElement;
const clearBtn = document.getElementById("clear") as HTMLButtonElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const toolsRoot = document.getElementById("tools");
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const loadBtn = document.getElementById("load") as HTMLButtonElement | null;
const exportBtn = document.getElementById("export") as HTMLButtonElement | null;
const importBtn = document.getElementById("import") as HTMLButtonElement | null;
const importFile = document.getElementById("importFile") as HTMLInputElement | null;

function setTool(name: string) {
  toolEl.value = name;
  toolsRoot?.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tool") === name);
  });
}
toolsRoot?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button[data-tool]") as HTMLButtonElement | null;
  if (!btn) return;
  setTool(btn.dataset.tool || "laser");
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

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

// Lab lighting — room stays black; standard materials need a little fill.
scene.add(new THREE.AmbientLight(0x8090a8, 0.85));
scene.add(new THREE.HemisphereLight(0xc8d8ff, 0x101018, 0.45));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(4, 18, -6);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aacc, 0.45);
fill.position.set(-8, 12, 4);
scene.add(fill);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x030306, metalness: 0.2, roughness: 0.9 }),
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

function clearOptics() {
  optics.splice(0).forEach((o) => scene.remove(o.mesh));
  redraw();
}

function applyLayout(layout: Layout) {
  clearOptics();
  for (const item of layout.optics) {
    const o = createOptic(item.kind, item.x, item.z, item.angle);
    scene.add(o.mesh);
    optics.push(o);
  }
  redraw();
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
  setHud(`${kind} placed · drag to move · right-click rotate · double-click clone`);
}

function screenToWorld(clientX: number, clientY: number): THREE.Vector3 {
  const ndc = new THREE.Vector2(
    (clientX / window.innerWidth) * 2 - 1,
    -(clientY / window.innerHeight) * 2 + 1,
  );
  const v = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(camera);
  return new THREE.Vector3(v.x, 0, v.z);
}

function worldToScreen(x: number, z: number): { x: number; y: number } {
  const v = new THREE.Vector3(x, 0, z).project(camera);
  return {
    x: ((v.x + 1) / 2) * window.innerWidth,
    y: ((-v.y + 1) / 2) * window.innerHeight,
  };
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
let suppressClickUntil = 0;

function cloneOptic(o: Optic) {
  if (o.kind === "laser") {
    setHud("Only one laser — clone disabled (move the laser instead)");
    return;
  }
  const t = opticTangent(o).multiplyScalar(0.8);
  const clone = createOptic(o.kind, o.pos.x + t.x, o.pos.y + t.y, o.angle);
  scene.add(clone.mesh);
  optics.push(clone);
  redraw();
  setHud(`Cloned ${o.kind} · offset along tangent`);
}

function openRotateFor(o: Optic, clientX: number, clientY: number) {
  const scr = worldToScreen(o.pos.x, o.pos.y);
  // Prefer object projection; fall back to click if offscreen
  const x = Number.isFinite(scr.x) ? scr.x : clientX;
  const y = Number.isFinite(scr.y) ? scr.y : clientY;
  openRotateRing({
    x,
    y,
    angle: o.angle,
    onChange: (rad) => {
      o.angle = rad;
      syncMesh(o);
      redraw();
    },
    onClose: () => {
      const deg = Math.round((((o.angle * 180) / Math.PI) % 360 + 360) % 360);
      setHud(`Aimed ${String(deg).padStart(3, "0")}° · right-click to fine-tune`);
    },
  });
}

function openActionsFor(o: Optic, clientX: number, clientY: number) {
  const scr = worldToScreen(o.pos.x, o.pos.y);
  const x = Number.isFinite(scr.x) ? scr.x : clientX;
  const y = Number.isFinite(scr.y) ? scr.y : clientY;
  const isLaser = o.kind === "laser";
  openActionRing({
    x,
    y,
    items: [
      {
        id: "clone",
        label: "Clone",
        disabled: isLaser,
        note: isLaser ? "Only one laser allowed" : undefined,
      },
    ],
    onSelect: (id) => {
      if (id === "clone") cloneOptic(o);
    },
    onClose: () => {},
  });
}

// Prevent browser context menu on canvas right-click
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

canvas.addEventListener("pointerdown", (e) => {
  // Right-click → ring rotate; do not start drag
  if (e.button === 2) {
    e.preventDefault();
    drag = null;
    const w = screenToWorld(e.clientX, e.clientY);
    const o = nearest(w.x, w.z, 1.6);
    if (o) {
      suppressClickUntil = performance.now() + 400;
      openRotateFor(o, e.clientX, e.clientY);
    } else if (isRingMenuOpen()) {
      closeRingMenu();
    }
    return;
  }

  if (e.button !== 0) return;
  if (isRingMenuOpen()) return;
  if (performance.now() < suppressClickUntil) return;
  // Second click of a double-click: do not start drag / place
  if (e.detail >= 2) {
    drag = null;
    return;
  }

  const w = screenToWorld(e.clientX, e.clientY);
  const tool = toolEl.value;

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
    const o = nearest(w.x, w.z, 0.9);
    if (o) {
      drag = { optic: o, ox: o.pos.x, oz: o.pos.y, px: w.x, pz: w.z };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    place(tool, w.x, w.z);
  }
});

canvas.addEventListener("dblclick", (e) => {
  e.preventDefault();
  drag = null;
  suppressClickUntil = performance.now() + 400;
  const w = screenToWorld(e.clientX, e.clientY);
  const o = nearest(w.x, w.z, 1.5);
  if (o) openActionsFor(o, e.clientX, e.clientY);
});

canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const w = screenToWorld(e.clientX, e.clientY);
  drag.optic.pos.set(drag.ox + (w.x - drag.px), drag.oz + (w.z - drag.pz));
  syncMesh(drag.optic);
  redraw();
});

canvas.addEventListener("pointerup", () => {
  if (drag) setHud("Moved · right-click optic to aim · double-click to clone");
  drag = null;
});

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    if (isRingMenuOpen()) return;
    const w = screenToWorld(e.clientX, e.clientY);
    const o = nearest(w.x, w.z, 1.6);
    if (!o) return;
    // Coarse scroll still available; primary aim is the ring dial
    o.angle += Math.sign(e.deltaY) * (Math.PI / 180);
    syncMesh(o);
    redraw();
  },
  { passive: false },
);

clearBtn.addEventListener("click", () => {
  clearOptics();
  setHud("Cleared · place a laser to cast light");
});

saveBtn?.addEventListener("click", () => {
  saveLocal(optics);
  setHud("Saved layout to this browser");
});
loadBtn?.addEventListener("click", () => {
  const layout = loadLocal();
  if (!layout) {
    setHud("No saved layout found");
    return;
  }
  applyLayout(layout);
  setHud("Loaded saved layout");
});
exportBtn?.addEventListener("click", () => {
  downloadJson(optics);
  setHud("Exported prism-layout.json");
});
importBtn?.addEventListener("click", () => importFile?.click());
importFile?.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  const layout = parseLayoutFile(text);
  importFile.value = "";
  if (!layout) {
    setHud("Invalid layout JSON");
    return;
  }
  applyLayout(layout);
  setHud(`Imported ${layout.optics.length} optics`);
});

function setHud(msg: string) {
  hud.textContent = msg;
}

window.addEventListener("keydown", (e) => {
  if (isRingMenuOpen() && e.key === "Escape") return; // ringMenu handles Esc
  const k = e.key.toLowerCase();
  if (k === "1") setTool("laser");
  if (k === "2") setTool("mirror");
  if (k === "3") setTool("prism");
  if (k === "e") setTool("erase");
  if (k === "m") setTool("move");
  if (k === "c" && (e.ctrlKey || e.metaKey)) return;
  if (k === "escape" && !isRingMenuOpen()) {
    clearOptics();
    redraw();
  }
});

// Starter: laser → mirror → prism (dispersion demo path)
place("laser", -8, 0);
place("mirror", -2, 3.5);
place("prism", 2.5, 0.5);
place("mirror", 7, -3);
optics[1].angle = -Math.PI / 2.6;
optics[2].angle = Math.PI / 5;
optics[3].angle = Math.PI / 2.8;
for (const o of optics) syncMesh(o);
redraw();
setHud("Right-click aim · double-click clone · white→ROYGBIV on prism exit");

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

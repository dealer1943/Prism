/** On-object radial / ring UI overlays (HTML). */

export type RingCloseReason = "outside" | "esc" | "commit" | "replace";

export interface RotateRingOptions {
  /** Screen-space center (client coords). */
  x: number;
  y: number;
  /** Initial optic angle in radians. */
  angle: number;
  onChange: (angleRad: number, degrees: number) => void;
  onClose: (reason: RingCloseReason) => void;
}

export interface ActionRingItem {
  id: string;
  label: string;
  disabled?: boolean;
  note?: string;
}

export interface ActionRingOptions {
  x: number;
  y: number;
  items: ActionRingItem[];
  onSelect: (id: string) => void;
  onClose: (reason: RingCloseReason) => void;
}

let activeRoot: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

function teardown(reason: RingCloseReason, onClose: (r: RingCloseReason) => void) {
  if (escHandler) {
    window.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  if (activeRoot) {
    activeRoot.remove();
    activeRoot = null;
  }
  onClose(reason);
}

export function closeRingMenu() {
  if (escHandler) {
    window.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  if (activeRoot) {
    activeRoot.remove();
    activeRoot = null;
  }
}

export function isRingMenuOpen(): boolean {
  return activeRoot !== null;
}

function bindEsc(onClose: (r: RingCloseReason) => void) {
  escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      teardown("esc", onClose);
    }
  };
  window.addEventListener("keydown", escHandler);
}

/** Live rotate dial: drag around the ring; snaps to integer degrees. */
export function openRotateRing(opts: RotateRingOptions) {
  closeRingMenu();

  const root = document.createElement("div");
  root.className = "ring-menu rotate-ring";
  root.style.left = `${opts.x}px`;
  root.style.top = `${opts.y}px`;
  root.innerHTML = `
    <div class="ring-backdrop"></div>
    <div class="ring-dial" role="slider" aria-valuemin="0" aria-valuemax="359" aria-label="Rotate">
      <div class="ring-track"></div>
      <div class="ring-knob"></div>
      <div class="ring-label">000°</div>
    </div>
  `;
  document.body.appendChild(root);
  activeRoot = root;

  const dial = root.querySelector(".ring-dial") as HTMLElement;
  const knob = root.querySelector(".ring-knob") as HTMLElement;
  const label = root.querySelector(".ring-label") as HTMLElement;
  const backdrop = root.querySelector(".ring-backdrop") as HTMLElement;

  let currentDeg = Math.round((((opts.angle * 180) / Math.PI) % 360 + 360) % 360);
  let dragging = false;

  function applyDeg(deg: number, commitVisual = true) {
    currentDeg = ((Math.round(deg) % 360) + 360) % 360;
    const rad = (currentDeg * Math.PI) / 180;
    if (commitVisual) {
      label.textContent = `${String(currentDeg).padStart(3, "0")}°`;
      knob.style.transform = `rotate(${currentDeg}deg)`;
      dial.setAttribute("aria-valuenow", String(currentDeg));
    }
    opts.onChange(rad, currentDeg);
  }

  applyDeg(currentDeg);

  function angleFromEvent(e: PointerEvent): number {
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    // Screen Y down → world +Z; matches optic angle convention (0 = +X).
    return (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    applyDeg(angleFromEvent(e));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    dial.releasePointerCapture?.(e.pointerId);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    teardown("commit", opts.onClose);
  };

  dial.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    applyDeg(angleFromEvent(e));
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  });

  backdrop.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    teardown("outside", opts.onClose);
  });

  bindEsc(opts.onClose);
}

/** Compact action ring (e.g. Clone). */
export function openActionRing(opts: ActionRingOptions) {
  closeRingMenu();

  const root = document.createElement("div");
  root.className = "ring-menu action-ring";
  root.style.left = `${opts.x}px`;
  root.style.top = `${opts.y}px`;

  const backdrop = document.createElement("div");
  backdrop.className = "ring-backdrop";
  root.appendChild(backdrop);

  const nest = document.createElement("div");
  nest.className = "action-nest";
  root.appendChild(nest);

  opts.items.forEach((item, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action-slice";
    btn.dataset.id = item.id;
    btn.textContent = item.label;
    if (item.disabled) {
      btn.disabled = true;
      btn.title = item.note || "";
    }
    const n = opts.items.length;
    const a0 = -90 + (360 / n) * i;
    btn.style.setProperty("--slice-rot", `${a0}deg`);
    nest.appendChild(btn);

    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.disabled) return;
      const id = item.id;
      teardown("commit", opts.onClose);
      opts.onSelect(id);
    });
  });

  if (opts.items.some((it) => it.note && it.disabled)) {
    const note = document.createElement("div");
    note.className = "action-note";
    note.textContent = opts.items.find((it) => it.disabled && it.note)?.note || "";
    root.appendChild(note);
  }

  document.body.appendChild(root);
  activeRoot = root;

  backdrop.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    teardown("outside", opts.onClose);
  });

  bindEsc(opts.onClose);
}

import type { Optic, OpticKind } from "./types";

export interface LayoutOptic {
  kind: OpticKind;
  x: number;
  z: number;
  angle: number;
}

export interface Layout {
  v: 1;
  optics: LayoutOptic[];
}

const KEY = "prism-lab-layout-v1";

export function serialize(optics: Optic[]): Layout {
  return {
    v: 1,
    optics: optics.map((o) => ({
      kind: o.kind,
      x: o.pos.x,
      z: o.pos.y,
      angle: o.angle,
    })),
  };
}

export function saveLocal(optics: Optic[]) {
  localStorage.setItem(KEY, JSON.stringify(serialize(optics)));
}

export function loadLocal(): Layout | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Layout;
    if (data?.v !== 1 || !Array.isArray(data.optics)) return null;
    return data;
  } catch {
    return null;
  }
}

export function downloadJson(optics: Optic[], filename = "prism-layout.json") {
  const blob = new Blob([JSON.stringify(serialize(optics), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function parseLayoutFile(text: string): Layout | null {
  try {
    const data = JSON.parse(text) as Layout;
    if (data?.v !== 1 || !Array.isArray(data.optics)) return null;
    return data;
  } catch {
    return null;
  }
}

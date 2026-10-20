"use client";

import { useEffect, useRef } from "react";

// First-person pixel-art arena drawn on a tiny canvas and scaled up with
// nearest-neighbour sampling. The arena is a small raycast (floor, two side
// stands and a back stand) rendered once; the player, ball, scoreboard and
// camera flashes are redrawn each frame on top of it.

const W = 320;
const H = 180;
const HORIZON = 70;
const FOCAL = 100;
const EYE = 6; // camera height, feet
const SIDE = 34; // side stands, feet from centre line
const BACK = 38; // back stand, feet from camera
const BASELINE = 30;
const HOOP_Z = BASELINE - 5.25;
const CYCLE = 10_000; // ms for one run out, layup and run back
const FPS = 20;

type RGB = [number, number, number];

function project(x: number, y: number, z: number): [number, number] {
  return [W / 2 + (FOCAL * x) / z, HORIZON + (FOCAL * (EYE - y)) / z];
}

function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

function shade([r, g, b]: RGB, f: number): RGB {
  return [r * f, g * f, b * f];
}

const WOOD = ["#c98a4b", "#d39a5a", "#bf7f42", "#dba567"].map(hex);
const PAINT = hex("#b5441b");
const APRON = hex("#1e3a8a");
const SHIRTS = ["#ea580c", "#f8fafc", "#1d4ed8", "#facc15", "#dc2626", "#16a34a", "#111827", "#a855f7"].map(hex);
const SKIN = ["#f1c27d", "#c68642", "#8d5524", "#e0ac69", "#5c3a21"].map(hex);
const SEAT = hex("#3b2a3a");
const STEP = hex("#1b1b24");
const LED_ON = hex("#fb923c");
const LED_OFF = hex("#26150b");
const LINE = hex("#f8f1e2");

// Spectator / ad board texture for a stand wall. `u` runs along the wall in
// feet, `y` is height above the floor in feet.
function stand(u: number, y: number): RGB | null {
  if (y < 0) return null;
  if (y < 3.2) {
    const col = Math.floor(u * 1.4);
    const lit = col % 6 < 4 && y > 0.9 && y < 2.4;
    return lit ? LED_ON : LED_OFF;
  }
  const ry = (y - 3.2) / 2.2;
  const row = Math.floor(ry);
  const v = ry - row;
  if (v < 0.22) return STEP;
  const col = Math.floor(u / 1.7 + row * 0.5);
  const cu = u / 1.7 + row * 0.5 - col;
  if (hash(col, row) < 0.12) return SEAT; // empty seat
  const sv = (v - 0.22) / 0.78;
  const dim = Math.max(0.35, 0.75 - row * 0.02);
  if (sv > 0.55 && sv < 0.9 && cu > 0.3 && cu < 0.7) return shade(SKIN[Math.floor(hash(row, col) * SKIN.length)], dim);
  if (sv <= 0.55 && cu > 0.12 && cu < 0.88) return shade(SHIRTS[Math.floor(hash(col + 7, row) * SHIRTS.length)], dim);
  return shade(SEAT, dim);
}

function floor(x: number, z: number): RGB {
  const inCourt = Math.abs(x) <= 25 && z <= BASELINE;
  const plank = Math.floor((x + 100) / 0.9);
  const board = Math.floor((z + hash(plank, 3) * 6) / 6);
  const base = inCourt
    ? Math.abs(x) <= 8 && z >= BASELINE - 19
      ? PAINT
      : WOOD[Math.floor(hash(plank, board) * WOOD.length)]
    : shade(APRON, 0.8 + hash(plank, board) * 0.25);
  // Seam between planks, and the court gets darker towards the far end.
  const seam = (x + 100) / 0.9 - plank < 0.12 ? 0.85 : 1;
  return shade(base, seam * Math.min(1, 1.15 - z / 120));
}

function renderArena(): { image: ImageData; crowd: Int32Array } {
  const image = new ImageData(W, H);
  const d = image.data;
  const crowd: number[] = [];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const dx = px + 0.5 - W / 2;
      const dy = py + 0.5 - HORIZON;
      const zFloor = dy > 0 ? (FOCAL * EYE) / dy : Infinity;
      const zSide = dx !== 0 ? (FOCAL * SIDE) / Math.abs(dx) : Infinity;
      const z = Math.min(zFloor, zSide, BACK);
      const x = (dx * z) / FOCAL;
      const y = EYE - (dy * z) / FOCAL;
      let c: RGB;
      if (z === zFloor) c = floor(x, z);
      else {
        c = (z === zSide ? stand(z, y) : stand(x + 60, y)) ?? STEP;
        if (y > 3.2) crowd.push(py * W + px);
      }
      const i = (py * W + px) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }

  const plot = (x: number, y: number, [r, g, b]: RGB) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  };
  const segment = (a: [number, number], b: [number, number]) => {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let k = 0; k <= n; k++) plot(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, LINE);
  };
  // Court lines as world-space polylines; points too close to the camera are dropped.
  const courtLine = (pts: [number, number][]) => {
    for (let k = 1; k < pts.length; k++) {
      const [x0, z0] = pts[k - 1];
      const [x1, z1] = pts[k];
      if (z0 < 2 || z1 < 2) continue;
      segment(project(x0, 0, z0), project(x1, 0, z1));
    }
  };
  courtLine([[-25, 2], [-25, BASELINE], [25, BASELINE], [25, 2]]);
  courtLine([[-8, BASELINE], [-8, BASELINE - 19], [8, BASELINE - 19], [8, BASELINE]]);
  const arc = (cx: number, cz: number, r: number, from: number, to: number) => {
    const pts: [number, number][] = [];
    for (let k = 0; k <= 48; k++) {
      const t = from + ((to - from) * k) / 48;
      pts.push([cx + r * Math.sin(t), cz - r * Math.cos(t)]);
    }
    courtLine(pts);
  };
  arc(0, BASELINE - 19, 6, -Math.PI / 2, Math.PI / 2);
  const corner = Math.asin(22 / 23.75);
  arc(0, HOOP_Z, 23.75, -corner, corner);
  const cornerZ = HOOP_Z - 23.75 * Math.cos(corner);
  courtLine([[-22, BASELINE], [-22, cornerZ]]);
  courtLine([[22, BASELINE], [22, cornerZ]]);
  return { image, crowd: Int32Array.from(crowd) };
}

function drawHoop(ctx: CanvasRenderingContext2D) {
  const box = (x0: number, y0: number, z: number, x1: number, y1: number, color: string) => {
    const [ax, ay] = project(x0, y0, z);
    const [bx, by] = project(x1, y1, z);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(ax), Math.round(ay), Math.max(1, Math.round(bx - ax)), Math.max(1, Math.round(by - ay)));
  };
  box(-2.5, 3, BASELINE + 1, 2.5, 0, "#1e40af"); // padded base
  box(-0.35, 12, BASELINE + 2, 0.35, 3, "#9ca3af"); // pole
  box(-0.3, 12, 27, 0.3, 11.3, "#6b7280"); // arm
  box(-3, 12.5, 26, 3, 9, "#f8fafc");
  box(-2.75, 12.25, 26, 2.75, 9.25, "#c7d7e6");
  box(-1, 11.5, 26, 1, 10, "#ef4444");
  box(-0.8, 11.3, 26, 0.8, 10.15, "#c7d7e6");
  box(-0.15, 10.2, 25.5, 0.15, 9.9, "#ea580c"); // bracket
  // Net, then rim.
  ctx.fillStyle = "#e5e7eb";
  for (let k = 0; k <= 4; k++) {
    const t = (k / 4) * Math.PI;
    const [tx, ty] = project(0.75 * Math.cos(t), 10, HOOP_Z - 0.4 * Math.sin(t));
    const [bx, by] = project(0.45 * Math.cos(t), 8.4, HOOP_Z);
    const n = Math.max(1, Math.round(by - ty));
    for (let s = 0; s <= n; s++) ctx.fillRect(Math.round(tx + ((bx - tx) * s) / n), Math.round(ty + s), 1, 1);
  }
  ctx.fillStyle = "#ff5a1f";
  for (let k = 0; k < 32; k++) {
    const t = (k / 32) * Math.PI * 2;
    const [x, y] = project(0.75 * Math.cos(t), 10, HOOP_Z + 0.75 * Math.sin(t));
    ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
}

// 10 x 22 sprites. Head, torso and legs are stacked.
const HEAD = {
  front: ["...hhhh...", "..hhhhhh..", "..kkkkkk..", "..kekkek..", "..kkkkkk..", "...kkkk..."],
  back: ["...hhhh...", "..hhhhhh..", "..hhhhhh..", ".khhhhhhk.", "..hhhhhh..", "...kkkk..."],
  jump: ["...hhhh...", "k.hhhhhh.k", "k.hhhhhh.k", "kkhhhhhhkk", "k.hhhhhh.k", "k..kkkk..k"],
};
const TORSO = {
  front: [".jjjjjjjj.", "kjjjjjjjjk", "kjjnjnnjjk", "kjjnjjnjjk", "kjjjjjjjjk", ".jjjjjjjj."],
  back: [".jjjjjjjj.", "knnnjnnnjk", "kjjnjjjnjk", "knnnjnnnjk", "knjjjjjnjk", ".nnnjnnnj."],
  jump: ["kjjjjjjjjk", ".nnnjnnnj.", ".jjnjjjnj.", ".nnnjnnnj.", ".njjjjjnj.", ".nnnjnnnj."],
};
const SHORTS = ["..ssssss..", "..ssssss..", "..ss..ss.."];
const LEGS = {
  a: ["..kk..kk..", "..kk..kk..", "..kk..ww..", "..ww..bb..", "..ww......", "..ww......", ".bbb......"],
  b: ["..kk..kk..", "..kk..kk..", "..ww..kk..", "..bb..ww..", "......ww..", "......ww..", "......bbb."],
  stand: ["..kk..kk..", "..kk..kk..", "..kk..kk..", "..ww..ww..", "..ww..ww..", "..ww..ww..", ".bbb..bbb."],
  tuck: ["..kk..kk..", "..kk..kk..", "..ww..ww..", "..ww..ww..", "..bb..bb..", "..........", ".........."],
};
const SPRITE_COLORS: Record<string, string> = {
  h: "#1a1110",
  k: "#8d5a3b",
  e: "#1a1110",
  j: "#ea580c",
  n: "#fff7ed",
  s: "#c2410c",
  w: "#f5f5f4",
  b: "#111827",
};

type Pose = "front" | "back" | "jump";

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, z: number, lift: number, pose: Pose, legs: keyof typeof LEGS) {
  const rows = [...HEAD[pose], ...TORSO[pose], ...SHORTS, ...LEGS[legs]];
  const [fx, fy] = project(x, lift, z);
  const [, groundY] = project(x, 0, z);
  const cell = (FOCAL * 6.6) / z / rows.length;
  // Shadow stays on the floor while the player is in the air.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  const sw = Math.round(cell * (8 - lift));
  ctx.fillRect(Math.round(fx - sw / 2), Math.round(groundY - cell * 0.6), sw, Math.max(1, Math.round(cell)));
  rows.forEach((row, r) => {
    const y0 = Math.round(fy - (rows.length - r) * cell);
    const y1 = Math.round(fy - (rows.length - r - 1) * cell);
    for (let c = 0; c < row.length; c++) {
      const color = SPRITE_COLORS[row[c]];
      if (!color) continue;
      const x0 = Math.round(fx + (c - 5) * cell);
      const x1 = Math.round(fx + (c - 4) * cell);
      ctx.fillStyle = color;
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
  });
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, z: number) {
  const [cx, cy] = project(x, y, z);
  const r = Math.max(1, (FOCAL * 0.45) / z);
  const n = Math.ceil(r);
  for (let j = -n; j <= n; j++) {
    for (let i = -n; i <= n; i++) {
      if (i * i + j * j > r * r) continue;
      ctx.fillStyle = j === 0 && r > 2 ? "#3b1a08" : i + j < 0 ? "#fb923c" : "#d9530f";
      ctx.fillRect(Math.round(cx + i), Math.round(cy + j), 1, 1);
    }
  }
}

// 3 x 5 digits for the scoreboard.
const DIGITS = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function drawNumber(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  [...value].forEach((ch, k) => {
    const bits = DIGITS[Number(ch)];
    for (let p = 0; p < 15; p++) if (bits[p] === "1") ctx.fillRect(x + k * 4 + (p % 3), y + Math.floor(p / 3), 1, 1);
  });
}

function drawScoreboard(ctx: CanvasRenderingContext2D, home: number, away: number, clock: number) {
  // One row, low enough to clear the title band that covers the top of the scene.
  ctx.fillStyle = "#0b0b12";
  ctx.fillRect(138, 33, 44, 11);
  ctx.fillStyle = "#374151";
  ctx.fillRect(138, 33, 44, 1);
  ctx.fillRect(138, 43, 44, 1);
  ctx.fillRect(160, 0, 1, 33); // hanging cable
  drawNumber(ctx, String(home % 1000).padStart(3, "0"), 141, 36, "#fb923c");
  drawNumber(ctx, String(clock).padStart(2, "0"), 157, 36, "#ef4444");
  drawNumber(ctx, String(away % 1000).padStart(3, "0"), 168, 36, "#fde68a");
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function drawFrame(ctx: CanvasRenderingContext2D, arena: HTMLCanvasElement, crowd: Int32Array, elapsed: number) {
  ctx.drawImage(arena, 0, 0);

  // Camera flashes in the crowd.
  ctx.fillStyle = "#ffffff";
  for (let k = 0; k < 3; k++) {
    const p = crowd[Math.floor(Math.random() * crowd.length)];
    ctx.fillRect(p % W, Math.floor(p / W), 1, 1);
  }

  const u = (elapsed % CYCLE) / CYCLE;
  const laps = Math.floor(elapsed / CYCLE);
  const step = Math.floor(elapsed / 130) % 2 ? "a" : "b";
  const bob = 0.2 * Math.abs(Math.sin((elapsed / 130) * Math.PI));
  const dribble = (x: number, z: number) => drawBall(ctx, x + 1.1, 0.45 + 2.5 * Math.abs(Math.cos((elapsed / 260) * Math.PI)), z - 0.3);

  const scored = u >= 0.48 ? 1 : 0;
  const shot = (((u - 0.48 + 1) % 1) * CYCLE) / 1000;
  drawScoreboard(ctx, 98 + 2 * (laps + scored), 101, Math.max(0, 24 - Math.floor(shot)));

  if (u < 0.42) {
    // Drive from the right wing to the basket, back to the camera.
    const a = u / 0.42;
    const x = lerp(11, -0.6, a);
    const z = lerp(9, 21, a);
    dribble(x, z);
    drawPlayer(ctx, x, z, bob, "back", step);
  } else if (u < 0.52) {
    // Layup.
    const s = (u - 0.42) / 0.1;
    const x = lerp(-0.6, -0.3, s);
    const z = lerp(21, 22.8, s);
    const lift = 3.2 * Math.sin(Math.PI * s);
    if (s < 0.6) drawPlayer(ctx, x, z, lift, "jump", "tuck");
    if (s < 0.45) drawBall(ctx, x + 0.3, lift + 7.2, z + 0.2);
    else if (s < 0.6) {
      const k = (s - 0.45) / 0.15;
      drawBall(ctx, lerp(x + 0.3, 0, k), lerp(lift + 7.2, 10.4, k), lerp(z + 0.2, HOOP_Z, k));
    } else {
      const k = (s - 0.6) / 0.4;
      drawBall(ctx, 0, 10 - 9.55 * k * k, HOOP_Z);
    }
    if (s >= 0.6) drawPlayer(ctx, x, z, lift, "jump", "tuck");
  } else if (u < 0.58) {
    // Land, turn and collect the rebound.
    const s = (u - 0.52) / 0.06;
    drawBall(ctx, lerp(0, 0.8, s), lerp(0.45, 3, s) + 3 * Math.sin(Math.PI * s), lerp(HOOP_Z, 22.5, s));
    drawPlayer(ctx, -0.3, 22.8, 0, "front", "stand");
  } else {
    // Run back out to the right wing, towards the camera.
    const a = (u - 0.58) / 0.42;
    const x = lerp(-0.3, 11, a);
    const z = lerp(22.8, 9, a);
    drawPlayer(ctx, x, z, bob, "front", step);
    dribble(x, z);
  }
}

export function CourtBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const arena = document.createElement("canvas");
    arena.width = W;
    arena.height = H;
    const arenaCtx = arena.getContext("2d")!;
    const { image, crowd } = renderArena();
    arenaCtx.putImageData(image, 0, 0);
    drawHoop(arenaCtx);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawFrame(ctx, arena, crowd, CYCLE * 0.2);
      return;
    }

    const start = performance.now();
    let last = -Infinity;
    let raf = requestAnimationFrame(function tick(now) {
      if (now - last >= 1000 / FPS) {
        last = now;
        drawFrame(ctx, arena, crowd, now - start);
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full bg-[#0b0b12] object-cover [image-rendering:pixelated]"
    />
  );
}

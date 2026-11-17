import { GRAND_SIZE, TILE_SIZE } from "../shared/constants";
import { type IslandInfo, islandHeights, type ShapeId } from "../shared/islands";

/*
 * The grand map, drawn flat from above in the same survey style as the
 * island: dark sea, grey land, a contour every 5 m and a white coastline.
 */

/* Pixels a side for one island's picture. */
const IMAGE = 200;
/* Height samples a side for a quick preview (the game's own islands use the full grid). */
const PREVIEW_GRID = 97;
const BAND = 5;
/* Metres between the faint depth contours offshore. */
const DEPTH_BAND = 3;

/* Draw an island's heights (n a side, over its tile) as a contour picture with clear sea. */
export function islandImage(heights: Float32Array, n: number, size = IMAGE) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const scale = (n - 1) / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = Math.min(n - 1.001, (px + 0.5) * scale);
      const gz = Math.min(n - 1.001, (py + 0.5) * scale);
      const j = Math.floor(gx);
      const i = Math.floor(gz);
      const fx = gx - j;
      const fz = gz - i;
      const k = i * n + j;
      h[py * size + px] =
        (heights[k] * (1 - fx) + heights[k + 1] * fx) * (1 - fz) +
        (heights[k + n] * (1 - fx) + heights[k + n + 1] * fx) * fz;
    }
  }
  const band = (v: number) => Math.floor(v / BAND);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const k = py * size + px;
      const v = h[k];
      const o = k * 4;
      const right = px + 1 < size ? h[k + 1] : v;
      const down = py + 1 < size ? h[k + size] : v;
      if (v <= 0) {
        /* Shallows show faintly, so a lagoon or a reef reads, with depth contours like a chart. */
        const shallow = v > -6 ? (1 - -v / 6) * 26 : 0;
        const depth = (d: number) => Math.floor(d / DEPTH_BAND);
        const sounding = v > -13 && (depth(right) !== depth(v) || depth(down) !== depth(v));
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = sounding ? Math.max(shallow, 34) : shallow;
        if (right > 0 || down > 0) img.data[o + 3] = 255;
        continue;
      }
      const coast =
        right <= 0 || down <= 0 || (px > 0 && h[k - 1] <= 0) || (py > 0 && h[k - size] <= 0);
      const contour = band(right) !== band(v) || band(down) !== band(v);
      /* Light from the north-west, like the island in the game. */
      const shade = Math.max(
        -1,
        Math.min(1, (h[k] - (px > 0 && py > 0 ? h[k - size - 1] : v)) * 0.25),
      );
      let c = 74 + v * 1.4 + shade * 16;
      if (contour) c = 196;
      if (coast) c = 250;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.max(0, Math.min(255, c));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const previews = new Map<string, HTMLCanvasElement>();

/* A quick picture of what an island of this shape and seed would look like. */
export function previewImage(shape: ShapeId, seed: number) {
  const key = `${shape}:${seed}`;
  let canvas = previews.get(key);
  if (!canvas) {
    canvas = islandImage(islandHeights(shape, seed, PREVIEW_GRID), PREVIEW_GRID);
    if (previews.size > 64) previews.clear();
    previews.set(key, canvas);
  }
  return canvas;
}

export type MapIsland = { info: IslandInfo; image: HTMLCanvasElement; mine: boolean };
export type MapPlayer = {
  id: number;
  name: string;
  x: number;
  z: number;
  yaw: number;
  me: boolean;
};

export type MapView = {
  islands: MapIsland[];
  players: MapPlayer[];
};

/* Where the grand map sits on a canvas: a square, `size` pixels a side, from (ox, oy). */
export type MapFrame = { ox: number; oy: number; size: number };

/* The biggest square that fits the canvas once the edges are kept clear for the HUD. */
export function fitFrame(
  width: number,
  height: number,
  inset: { top: number; bottom: number; side: number },
): MapFrame {
  const w = width - inset.side * 2;
  const h = height - inset.top - inset.bottom;
  const size = Math.max(10, Math.min(w, h));
  return { ox: inset.side + (w - size) / 2, oy: inset.top + (h - size) / 2, size };
}

/* World (x, z) to canvas pixels. North (-z) is up. */
export function toCanvas(f: MapFrame, x: number, z: number) {
  return {
    x: f.ox + (x / GRAND_SIZE + 0.5) * f.size,
    y: f.oy + (z / GRAND_SIZE + 0.5) * f.size,
  };
}

export function toWorld(f: MapFrame, px: number, py: number) {
  return {
    x: ((px - f.ox) / f.size - 0.5) * GRAND_SIZE,
    z: ((py - f.oy) / f.size - 0.5) * GRAND_SIZE,
  };
}

/* The same face and weight as the menu and the belt. */
const LABEL = `700 13px Almarai, sans-serif`;

export type Ghost = {
  x: number;
  z: number;
  image: HTMLCanvasElement;
  ok: boolean;
  /* Just under the pointer, not yet picked. */
  faint?: boolean;
};

/* An island picture washed red: somewhere it can't go. */
const tinted = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function redden(image: HTMLCanvasElement) {
  let out = tinted.get(image);
  if (out) return out;
  out = document.createElement("canvas");
  out.width = image.width;
  out.height = image.height;
  const ctx = out.getContext("2d");
  if (ctx) {
    ctx.drawImage(image, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = "rgba(255,80,80,0.6)";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  tinted.set(image, out);
  return out;
}

const SEA = "#0a0a0a";

/* Draw the whole grand map: the sea, every island, everyone on it, and an island to place. */
export function drawMap(
  ctx: CanvasRenderingContext2D,
  f: MapFrame,
  view: MapView,
  ghosts: readonly Ghost[],
  dpr: number,
) {
  /* One sea, edge to edge: the map's bounds show only in where an island will go. */
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tile = (TILE_SIZE / GRAND_SIZE) * f.size;
  const draw = (image: HTMLCanvasElement, x: number, z: number) => {
    const p = toCanvas(f, x, z);
    ctx.drawImage(image, p.x - tile / 2, p.y - tile / 2, tile, tile);
  };

  /* Islands, with a faint glow off the coast; names go on last so nothing covers them. */
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.12)";
  ctx.shadowBlur = tile * 0.08;
  for (const o of view.islands) draw(o.image, o.info.x, o.info.z);
  ctx.restore();

  for (const ghost of ghosts) {
    ctx.globalAlpha = ghost.faint ? 0.4 : 0.92;
    draw(ghost.ok ? ghost.image : redden(ghost.image), ghost.x, ghost.z);
    ctx.globalAlpha = 1;
  }

  ctx.font = LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  for (const o of view.islands) {
    const p = toCanvas(f, o.info.x, o.info.z);
    const y = p.y + tile * 0.36;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(o.info.name, p.x, y);
    ctx.fillStyle = o.mine ? "#ffffff" : "#9a9a9a";
    ctx.fillText(o.info.name, p.x, y);
  }

  /* Everyone out there: a dot, and an arrow for you. */
  for (const pl of view.players) {
    const p = toCanvas(f, pl.x, pl.z);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (pl.me) {
      ctx.save();
      ctx.translate(p.x, p.y);
      /* yaw 0 faces -z, which is up on the map. */
      ctx.rotate(-pl.yaw);
      ctx.moveTo(0, -7);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

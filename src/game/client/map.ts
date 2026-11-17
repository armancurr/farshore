import type { Team } from "../shared/catalogue";
import { GRAND_SIZE } from "../shared/constants";
import type { IslandInfo } from "../shared/islands";
import { ROAD_HALF } from "../shared/paths";

/*
 * The grand map, drawn flat from above in the world's colours: teal sea,
 * slate-violet land, a lighter contour every 5 m and a pale coastline.
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
      /* The land's colour (#555879), lifted a little with height and light. */
      const lift = Math.max(0.75, Math.min(1.35, 0.9 + v * 0.006 + shade * 0.1));
      let rgb = [85 * lift, 88 * lift, 121 * lift];
      if (contour) rgb = [129, 132, 171];
      if (coast) rgb = [242, 251, 250];
      for (let ch = 0; ch < 3; ch++) img.data[o + ch] = Math.max(0, Math.min(255, rgb[ch]));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/*
 * A plot's raid standing, for the map: its colours, the seconds left on its
 * shield (0: none), who took its Hearth, and whether raiders are on it now.
 */
export type MapRaid = { team: Team; shield: number; captor: string | null; attacked: boolean };
export type MapIsland = { info: IslandInfo; image: HTMLCanvasElement; raid?: MapRaid };
export type MapPlayer = {
  id: number;
  name: string;
  x: number;
  z: number;
  yaw: number;
  me: boolean;
  /* Raiding someone's land: drawn red. */
  raider?: boolean;
};

/* The team colours as the map draws them. */
export const TEAM_COLOR: Record<Team, string> = {
  blue: "#5b9cf0",
  red: "#ef5b50",
  yellow: "#f4cd4f",
  green: "#67c972",
};

/* A long span of time, as a person would say it: "7h 12m", "12m", "40s". */
export function span(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return m ? `${m}m` : `${s}s`;
}

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

const SEA = "#48b3af";
/* Your own land, picked out on the map. */
const MINE = "#ffd27a";

/* Draw the whole grand map: the sea, every island, and everyone on it. */
export function drawMap(ctx: CanvasRenderingContext2D, f: MapFrame, view: MapView, dpr: number) {
  /* One sea, edge to edge. */
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = SEA;
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const tileOf = (o: IslandInfo) => (o.size / GRAND_SIZE) * f.size;
  const draw = (image: HTMLCanvasElement, o: IslandInfo) => {
    const p = toCanvas(f, o.x, o.z);
    const tile = tileOf(o);
    ctx.drawImage(image, p.x - tile / 2, p.y - tile / 2, tile, tile);
  };

  /* Islands, with a faint glow off the coast; names go on last so nothing covers them. */
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  ctx.shadowColor = "rgba(20,40,60,0.25)";
  ctx.shadowBlur = (1000 / GRAND_SIZE) * f.size * 0.08;
  for (const o of view.islands) draw(o.image, o.info);
  ctx.restore();

  /*
   * Plots: a shield is a pale bubble over the land, a raid a red ring
   * pulsing out from it, and the Hearth a dot in the plot's colours (the
   * captor's while a raid's shield lasts). Your own gets a ring round it,
   * so it can be found at a glance.
   */
  const now = performance.now() / 1000;
  for (const o of view.islands) {
    const p = toCanvas(f, o.info.x, o.info.z);
    const r = Math.max(7, tileOf(o.info) * 0.5);
    const raid = o.raid;
    if (raid && raid.shield > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(190,240,255,0.22)";
      ctx.strokeStyle = "rgba(220,250,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (raid?.attacked) {
      for (const k of [0, 0.5]) {
        const ph = (now * 0.8 + k) % 1;
        ctx.strokeStyle = `rgba(255,74,61,${(1 - ph) * 0.95})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.7 + ph * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (o.info.plot?.mine) {
      ctx.strokeStyle = MINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (raid) {
      ctx.fillStyle = TEAM_COLOR[raid.team];
      ctx.strokeStyle = "rgba(0,0,0,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.font = LABEL;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  for (const o of view.islands) {
    const p = toCanvas(f, o.info.x, o.info.z);
    const plot = o.info.plot;
    /* Plots go by their owner's name, a little below the land so a small one isn't covered. */
    const y = p.y + (plot ? Math.max(9, tileOf(o.info) * 0.5) : tileOf(o.info) * 0.36);
    const label = plot ? (plot.mine ? `${plot.owner} (you)` : plot.owner) : o.info.name;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(label, p.x, y);
    ctx.fillStyle = plot?.mine ? MINE : o.info.harbor ? "#ffffff" : "#d8d8e6";
    ctx.fillText(label, p.x, y);
    /* Under a plot's name: a raid going on, or how long its shield has left. */
    const raid = o.raid;
    const note = raid?.attacked
      ? "Under attack"
      : raid && raid.shield > 0
        ? `${raid.captor ? `Taken by ${raid.captor} · ` : ""}Shield ${span(raid.shield)}`
        : null;
    if (note) {
      ctx.save();
      ctx.font = `700 11px Almarai, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeText(note, p.x, y + 15);
      ctx.fillStyle = raid?.attacked ? "#ff7a6e" : "#c9f3ff";
      ctx.fillText(note, p.x, y + 15);
      ctx.restore();
    }
  }

  /* Everyone out there: a dot, and an arrow for you. */
  for (const pl of view.players) {
    const p = toCanvas(f, pl.x, pl.z);
    ctx.fillStyle = pl.raider ? "#ff4a3d" : "#ffffff";
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
      ctx.arc(p.x, p.y, pl.raider ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/*
 * Where a plot would go, while you choose a spot for it: the land it could
 * take (filled), the open sea it needs round it (dashed), and its tile;
 * green when the spot will do, red when it won't.
 */
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  f: MapFrame,
  g: { x: number; z: number; size: number; reach: number; gap: number; ok: boolean },
) {
  const p = toCanvas(f, g.x, g.z);
  const k = f.size / GRAND_SIZE;
  const color = g.ok ? "#7ee2a1" : "#ff7a6e";
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(10, (g.reach + g.gap) * k), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([2, 3]);
  const tile = Math.max(8, g.size * k);
  ctx.strokeRect(p.x - tile / 2, p.y - tile / 2, tile, tile);
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(4, g.reach * k), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/*
 * The island's roads and places, inked over its picture: the roads as
 * solid lines, each place a small ring, so the map shows where to go.
 */
export function drawRoutes(
  canvas: HTMLCanvasElement,
  island: {
    ox: number;
    oz: number;
    half: number;
    paths: readonly (readonly { x: number; z: number }[])[];
    places: readonly {
      x: number;
      z: number;
      kind: string;
      deck?: { x: number; z: number; hx: number; hz: number; rot: number };
    }[];
  },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const k = canvas.width / (island.half * 2);
  const px = (x: number) => (x - island.ox + island.half) * k;
  const pz = (z: number) => (z - island.oz + island.half) * k;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 236, 214, 0.9)";
  /* As wide as the road itself, but never a hairline. */
  ctx.lineWidth = Math.max(1.5, ROAD_HALF * 2 * k);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const line of island.paths) {
    ctx.beginPath();
    line.forEach((p, i) => (i ? ctx.lineTo(px(p.x), pz(p.z)) : ctx.moveTo(px(p.x), pz(p.z))));
    ctx.stroke();
  }
  /* The piers, drawn to size, out over the water. */
  ctx.fillStyle = "#a8774f";
  for (const p of island.places) {
    const d = p.deck;
    if (!d) continue;
    ctx.save();
    ctx.translate(px(d.x), pz(d.z));
    ctx.rotate(-d.rot);
    ctx.fillRect(-Math.max(1.5, d.hx * k), -d.hz * k, Math.max(3, d.hx * 2 * k), d.hz * 2 * k);
    ctx.restore();
  }
  ctx.fillStyle = "#f2665e";
  ctx.strokeStyle = "#f4efe6";
  for (const p of island.places) {
    if (p.deck) continue;
    ctx.beginPath();
    ctx.arc(px(p.x), pz(p.z), Math.max(2, canvas.width / 70), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

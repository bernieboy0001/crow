import {
  createCanvas,
  Path2D,
  type CanvasRenderingContext2D,
  type CanvasTextAlign,
  type CanvasTextBaseline
} from "@napi-rs/canvas";
import type { CheckResult } from "./sources";
import type { WatchRule } from "./rules";
import type { SocMatch, SocTeam, FormRow } from "./soccer";

// ---------------------------------------------------------------------------
// The Crows — scorecard renderer
//
// Apple Sports-style scoreboard: two team badges and a giant score up top,
// a quiet metadata strip below, light theme, no chrome. Rendered to 1200px-W
// PNG and sent to iMessage as a plain attachment (no app install needed).
// ---------------------------------------------------------------------------

export const CARD_W = 1200;

const C = {
  bgTop: "#FFFFFF",
  bgBottom: "#F3F5F8",
  line: "#E7EBF1",
  card: "#F5F7FA",
  cardLine: "#E9EDF3",
  ink: "#13181F",
  inkSoft: "#5B6676",
  muted: "#9AA3B0",
  faint: "#C6CDD6",
  disc: "#161B22",
  discSoft: "#ECF0F5",
  green: "#1D9A53",
  amber: "#B25E00",
  red: "#E23D4E",
  slate: "#8A94A3"
} as const;

const UI = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
const NUM = "'Segoe UI','Arial',sans-serif";

const MASK_R = 40;

type Ctx = CanvasRenderingContext2D;

type TextOpts = {
  x: number;
  y: number;
  size?: number;
  weight?: number | string;
  family?: string;
  color?: string;
  align?: CanvasTextAlign;
  base?: CanvasTextBaseline;
  tracking?: string;
  maxWidth?: number;
};

function text(ctx: Ctx, s: string, o: TextOpts): void {
  ctx.save();
  ctx.font = `${o.weight ?? 600} ${o.size ?? 18}px ${o.family ?? UI}`;
  ctx.fillStyle = o.color ?? C.ink;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = o.base ?? "alphabetic";
  if (o.tracking) (ctx as { letterSpacing?: string }).letterSpacing = o.tracking;
  if (o.maxWidth !== undefined) ctx.fillText(s, o.x, o.y, o.maxWidth);
  else ctx.fillText(s, o.x, o.y);
  ctx.restore();
}

function measureText(ctx: Ctx, s: string, size: number, weight: number, family?: string, tracking?: string): number {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family ?? UI}`;
  if (tracking) (ctx as { letterSpacing?: string }).letterSpacing = tracking;
  const w = ctx.measureText(s).width;
  ctx.restore();
  return w;
}

/** Largest font size at/under `size` that fits `s` in `maxW`. */
function fitText(
  ctx: Ctx,
  s: string,
  size: number,
  weight: number,
  maxW: number,
  family?: string
): number {
  let siz = size;
  while (siz > 12 && measureText(ctx, s, siz, weight, family) > maxW) siz -= 2;
  return siz;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function disc(ctx: Ctx, cx: number, cy: number, d: number, abbr: string, filled: boolean): void {
  const r = d / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = filled ? C.disc : C.discSoft;
  ctx.fill();
  if (!filled) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = C.cardLine;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  text(ctx, abbr, {
    x: cx,
    y: cy + 2,
    size: fitText(ctx, abbr, 40, 700, d * 0.56, NUM),
    weight: 700,
    family: NUM,
    color: filled ? "#FFFFFF" : C.inkSoft,
    align: "center",
    base: "middle",
    tracking: "0.04em"
  });
}

function sparkPath(ctx: Ctx, xs: number[], pts: number[], cy0: number, ch: number): { line: Path2D; area: Path2D } {
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const range = hi - lo;
  const flat = !(range > 0);
  const pad = 8;
  const ys = pts.map((v) =>
    flat ? cy0 + ch / 2 : cy0 + pad + (1 - (v - lo) / range) * (ch - pad * 2)
  );
  const line = new Path2D();
  line.moveTo(xs[0]!, ys[0]!);
  for (let i = 1; i < xs.length; i++) {
    const mx = (xs[i - 1]! + xs[i]!) / 2;
    const my = (ys[i - 1]! + ys[i]!) / 2;
    line.quadraticCurveTo(xs[i - 1]!, ys[i - 1]!, mx, my);
  }
  line.lineTo(xs[xs.length - 1]!, ys[ys.length - 1]!);
  const area = new Path2D(line);
  area.lineTo(xs[xs.length - 1]!, cy0 + ch);
  area.lineTo(xs[0]!, cy0 + ch);
  area.closePath();
  return { line, area };
}

function formTile(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  rows: FormRow[],
  opts: { short: string; color: string }
): void {
  ctx.fillStyle = C.card;
  rr(ctx, x, y, w, h, 22);
  ctx.fill();
  rr(ctx, x, y, w, h, 22);
  ctx.strokeStyle = C.cardLine;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  text(ctx, (opts.short || "TEAM").toUpperCase(), { x: x + 34, y: y + 52, size: 14, weight: 700, color: C.muted, tracking: "0.22em" });

  const trend = trendText(rows);
  if (trend) {
    text(ctx, trend, {
      x: x + w - 34,
      y: y + 52,
      size: 14,
      weight: 700,
      color: opts.color,
      align: "right",
      tracking: "0.18em"
    });
  }

  const sq = 40;
  const gap = 11;
  const letters = rows.length ? rows.map((r) => r.letter) : [];
  letters.forEach((l, i) => {
    const sx = x + 34 + i * (sq + gap);
    const sy = y + 82;
    const fill = l === "W" ? C.green : l === "L" ? C.red : C.faint;
    ctx.fillStyle = fill;
    rr(ctx, sx, sy, sq, sq, 10);
    ctx.fill();
    text(ctx, l, {
      x: sx + sq / 2,
      y: sy + sq / 2,
      size: 18,
      weight: 700,
      family: NUM,
      color: l === "D" ? C.ink : "#FFFFFF",
      align: "center",
      base: "middle"
    });
  });

  const pts = formPointsAsc(rows);
  if (pts.length >= 2) {
    const cx0 = x + 34;
    const cy0 = y + 148;
    const cw = w - 68;
    const ch = y + h - 38 - cy0;
    const xs = pts.map((_, i) => cx0 + (cw * i) / (pts.length - 1));
    const { line, area } = sparkPath(ctx, xs, pts, cy0, ch);
    const grad = ctx.createLinearGradient(cx0, cy0, cx0, cy0 + ch);
    grad.addColorStop(0, hexA(opts.color, 0.18));
    grad.addColorStop(1, hexA(opts.color, 0));
    ctx.fillStyle = grad;
    ctx.fill(area);
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(line);
    const lastX = xs[xs.length - 1]!;
    const lastY = sparkY(pts, cy0, ch);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fillStyle = opts.color;
    ctx.fill();
  }
}

function sparkY(pts: number[], cy0: number, ch: number): number {
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const range = hi - lo;
  const flat = !(range > 0);
  const pad = 8;
  const last = pts[pts.length - 1]!;
  return flat ? cy0 + ch / 2 : cy0 + pad + (1 - (last - lo) / range) * (ch - pad * 2);
}

function statGroup(
  ctx: Ctx,
  cx: number,
  y: number,
  label: string,
  value: string,
  valueMaxW = 320
): void {
  text(ctx, label.toUpperCase(), { x: cx, y: y + 48, size: 13, weight: 700, color: C.muted, align: "center", tracking: "0.26em" });
  const size = fitText(ctx, value, 27, 650, valueMaxW);
  text(ctx, value, { x: cx, y: y + 103, size, weight: 650, color: C.ink, align: "center", maxWidth: valueMaxW });
}

function maskCorners(ctx: Ctx, w: number, h: number, r: number): void {
  ctx.save();
  rr(ctx, 0, 0, w, h, r);
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// scoreboard scene (shared by alerts + predictions)
// ---------------------------------------------------------------------------

interface ScoreScene {
  homeShort: string;
  awayShort: string;
  homeName: string;
  awayName: string;
  homeScore: string;
  awayScore: string;
  homeColored: boolean;
  awayColored: boolean;
  homeScoreColored: boolean;
  awayScoreColored: boolean;
  headerLabel: string;
  statusLabel?: string;
  statusColor?: string;
  cols: { label: string; value: string }[];
  h: number;
}

function drawScene(ctx: Ctx, s: ScoreScene): void {
  const H = s.h;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, H);

  // header
  text(ctx, s.headerLabel, { x: 52, y: 58, size: 15, weight: 700, color: C.muted, tracking: "0.26em" });
  if (s.statusLabel && s.statusColor) {
    const dotR = 5;
    text(ctx, s.statusLabel, {
      x: CARD_W - 118,
      y: 58,
      size: 15,
      weight: 700,
      color: s.statusColor,
      align: "right",
      tracking: "0.18em"
    });
    ctx.beginPath();
    ctx.arc(CARD_W - 118, 53, dotR, 0, Math.PI * 2);
    ctx.fillStyle = s.statusColor;
    ctx.fill();
  }
  ctx.save();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(52, 84);
  ctx.lineTo(CARD_W - 52, 84);
  ctx.stroke();
  ctx.restore();

  // scoreboard row: badge disc — name — giant score (mirrored for away)
  const discD = 118;
  const leftDisc = 168;
  const rightDisc = CARD_W - 168;
  disc(ctx, leftDisc, 252, discD, s.homeShort, s.homeColored);
  disc(ctx, rightDisc, 252, discD, s.awayShort, s.awayColored);

  const nameSize = fitText(ctx, s.homeName, 24, 650, 268);
  text(ctx, s.homeName, {
    x: 248,
    y: 258,
    size: nameSize,
    weight: 650,
    color: s.homeScoreColored ? C.ink : C.muted,
    maxWidth: 268
  });
  text(ctx, s.awayName, {
    x: CARD_W - 248,
    y: 258,
    size: fitText(ctx, s.awayName, 24, 650, 268),
    weight: 650,
    color: s.awayScoreColored ? C.ink : C.muted,
    align: "right",
    maxWidth: 268
  });

  const hScoreSize = fitText(ctx, s.homeScore, 128, 700, 300, NUM);
  text(ctx, s.homeScore, {
    x: 588,
    y: 272,
    size: hScoreSize,
    weight: 700,
    family: NUM,
    color: s.homeScoreColored ? C.ink : C.faint,
    align: "right",
    maxWidth: 300
  });
  text(ctx, s.awayScore, {
    x: 612,
    y: 272,
    size: fitText(ctx, s.awayScore, 128, 700, 300, NUM),
    weight: 700,
    family: NUM,
    color: s.awayScoreColored ? C.ink : C.faint,
    align: "left",
    maxWidth: 300
  });

  // metadata strip
  const stripY = 388;
  const stripH = 168;
  ctx.save();
  ctx.fillStyle = C.card;
  rr(ctx, 52, stripY, CARD_W - 104, stripH, 22);
  ctx.fill();
  rr(ctx, 52, stripY, CARD_W - 104, stripH, 22);
  ctx.strokeStyle = C.cardLine;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  const n = s.cols.length;
  s.cols.forEach((c, i) => {
    statGroup(ctx, 52 + ((CARD_W - 104) / n) * (i + 0.5), stripY, c.label, c.value);
  });

  text(ctx, "THE CROWS", { x: CARD_W / 2, y: H - 42, size: 13, weight: 700, color: C.faint, align: "center", tracking: "0.42em" });

  maskCorners(ctx, CARD_W, H, MASK_R);
}

// ---------------------------------------------------------------------------
// public builders → PNG buffers
// ---------------------------------------------------------------------------

export interface CardImage {
  png: Buffer;
  name: string;
  caption: string;
}

interface StatusInfo {
  label: string;
  color: string;
  state: number;
}

function statusOf(meta: CheckResult["meta"], rule: WatchRule): StatusInfo {
  const state = typeof meta?.state === "number" ? meta.state : 0;
  const isGoal = rule.condition.comparator === "changed";
  if (state === 0) return { label: "PRE-MATCH", color: C.amber, state };
  if (state === 1) return { label: isGoal ? "GOAL!" : "LIVE", color: C.green, state };
  return { label: "FULL TIME", color: C.muted, state };
}

function winnerOf(homeScore: string, awayScore: string, state: number): "home" | "away" | undefined {
  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a) || state !== 2) return undefined;
  return h > a ? "home" : a > h ? "away" : undefined;
}

function splitScore(score: string): [string, string] {
  const m = score.split(/[-–:]/).map((s) => s.trim());
  return [m[0] || "–", m[1] || "–"];
}

function shortOf(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return (full.slice(0, 3) || "???").toUpperCase();
  return parts
    .slice(0, 4)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();
}

/** Live score / goal / full-time card fired by the poller. */
export function soccerAlertCard(rule: WatchRule, meta: CheckResult["meta"]): CardImage {
  const home = typeof meta?.home === "string" && meta.home ? meta.home : rule.target;
  const away = typeof meta?.matchOpp === "string" && meta.matchOpp ? meta.matchOpp : rule.target;
  const score = typeof meta?.score === "string" && meta.score ? meta.score : "0-0";
  const [hs, as] = splitScore(score);
  const st = statusOf(meta, rule);
  const winner = winnerOf(hs, as, st.state);

  const canvas = createCanvas(CARD_W, 640);
  const ctx = canvas.getContext("2d");
  drawScene(ctx, {
    h: 640,
    homeShort: shortOf(home),
    awayShort: shortOf(away),
    homeName: home,
    awayName: away,
    homeScore: hs,
    awayScore: as,
    homeColored: winner !== "away",
    awayColored: winner !== "home",
    homeScoreColored: winner !== "away",
    awayScoreColored: winner !== "home",
    headerLabel: "SOCCER · THE CROWS",
    statusLabel: st.label,
    statusColor: st.color,
    cols: [
      { label: "Watch", value: rule.label },
      { label: "Stage", value: st.state === 0 ? "Not started" : st.state === 1 ? "In play" : "Finished" },
      { label: "Score", value: score }
    ]
  });
  return {
    png: canvas.toBuffer("image/png"),
    name: "crows-scorecard.png",
    caption: `${home} ${score} ${away}`
  };
}

export interface PredictSpec {
  home: SocTeam;
  away: SocTeam;
  homeForm: FormRow[];
  awayForm: FormRow[];
  state: SocMatch["state"];
  predictedScore?: string;
  confidence?: number;
  reasoning?: string;
}

/** The crows' call: predicted scoreboard + each side's last-5 form. */
export function predictCard(spec: PredictSpec): CardImage {
  const [hs, as] = splitScore(spec.predictedScore ?? "");
  const h = Number(hs);
  const a = Number(as);
  const pickHome =
    Number.isFinite(h) && Number.isFinite(a) && h !== a ? h > a : undefined;
  const conf = spec.confidence !== undefined && Number.isFinite(spec.confidence) ? spec.confidence : undefined;
  const confColor = conf === undefined ? C.muted : conf >= 0.65 ? C.green : C.amber;

  const canvas = createCanvas(CARD_W, 720);
  const ctx = canvas.getContext("2d");
  drawScene(ctx, {
    h: 720,
    homeShort: shortOf(spec.home.short || spec.home.name),
    awayShort: shortOf(spec.away.short || spec.away.name),
    homeName: spec.home.name,
    awayName: spec.away.name,
    homeScore: hs,
    awayScore: as,
    homeColored: pickHome === undefined || pickHome,
    awayColored: pickHome === undefined || !pickHome,
    homeScoreColored: pickHome === undefined || pickHome,
    awayScoreColored: pickHome === undefined || !pickHome,
    headerLabel: "SOCCER · THE CROWS",
    statusLabel: conf === undefined ? "THE CALL" : `THE CALL · ${Math.round(conf * 100)}%`,
    statusColor: confColor,
    cols: [
      { label: "Stage", value: spec.state === "pre" ? "Match preview" : spec.state === "in" ? "Live" : "Review" },
      { label: "Reasoning", value: spec.reasoning ? trimTo(spec.reasoning, 44) : "I hold a mind and a beady eye" },
      { label: "Form", value: `${formLetters(spec.homeForm)} · ${formLetters(spec.awayForm)}` }
    ]
  });

  const tileY = 388;
  const gap = 20;
  const tileW = (CARD_W - 104 - gap) / 2;
  const tileH = 232;
  formTile(ctx, 52, tileY, tileW, tileH, spec.homeForm, {
    short: spec.home.short || spec.home.name,
    color: trendColor(spec.homeForm)
  });
  formTile(ctx, 52 + tileW + gap, tileY, tileW, tileH, spec.awayForm, {
    short: spec.away.short || spec.away.name,
    color: trendColor(spec.awayForm)
  });

  return {
    png: canvas.toBuffer("image/png"),
    name: "crows-call.png",
    caption: `${spec.home.name} vs ${spec.away.name} — ${hs}-${as}`
  };
}

// ---- small helpers ---------------------------------------------------------

function formLetters(rows: FormRow[]): string {
  return rows.length ? rows.map((r) => r.letter).join("") : "—";
}

function formPointsAsc(rows: FormRow[]): number[] {
  return rows.map((r) => (r.letter === "W" ? 1 : r.letter === "D" ? 0.5 : 0));
}

function trendScore(rows: FormRow[]): number {
  if (!rows.length) return 0;
  return rows.reduce<number>((acc, r) => acc + (r.letter === "W" ? 1 : r.letter === "D" ? 0.5 : 0), 0) / rows.length;
}

function trendText(rows: FormRow[]): string {
  if (rows.length < 2) return "";
  const recent = trendScore(rows.slice(0, 2));
  const earlier = trendScore(rows.slice(-2));
  return recent > earlier ? "HOT" : recent < earlier ? "COLD" : "FLAT";
}

function trendColor(rows: FormRow[]): string {
  const t = trendText(rows);
  return t === "HOT" ? C.green : t === "COLD" ? C.red : C.slate;
}

function trimTo(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}
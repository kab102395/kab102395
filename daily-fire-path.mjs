#!/usr/bin/env node
import fs from "node:fs";

const file = process.env.OUTPUT_PATH || "github-jet.svg";
const username = process.env.GH_USERNAME || "kab102395";
const LOOP_SECONDS = 20;
const GRID_X = 145;
const GRID_Y = 112;
const CELL = 13;
const STEP = 17;
const JET_Y = 294;
const JET_START_X = GRID_X + 5;
const JET_END_X = GRID_X + 51 * STEP + 5;
const LEFT_GUN_X = -20.5;
const RIGHT_GUN_X = 20.5;
const GUN_Y = -9;

let svg = fs.readFileSync(file, "utf8");

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedText) {
  let seed = hashString(seedText) || 1;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967295;
  };
}

function themeForFill(fill) {
  const value = String(fill).toUpperCase();
  if (value === "#6EE7B7") return { core: "#FFF7CC", glow: "#FACC15", impact: "#FDE047" };
  if (value === "#10B981") return { core: "#ECFCCB", glow: "#84CC16", impact: "#BEF264" };
  if (value === "#047857") return { core: "#D1FAE5", glow: "#22C55E", impact: "#86EFAC" };
  if (value === "#064E3B") return { core: "#CCFBF1", glow: "#10B981", impact: "#6EE7B7" };
  return { core: "#E0F2FE", glow: "#38BDF8", impact: "#7DD3FC" };
}

function shipXAt(time) {
  const t = clamp(time, 0, 1);
  if (t <= 0.5) return JET_START_X + (JET_END_X - JET_START_X) * (t / 0.5);
  return JET_END_X - (JET_END_X - JET_START_X) * ((t - 0.5) / 0.5);
}

function muzzleXAt(time, side) {
  return shipXAt(time) + (side === "left" ? LEFT_GUN_X : RIGHT_GUN_X);
}

function parseTelemetry() {
  const shield = Number(svg.match(/SHIELD <\/tspan><tspan class="white">(\d+)%<\/tspan>/)?.[1] ?? 100);
  const combo = Number(svg.match(/COMBO <\/tspan><tspan class="white">x(\d+)/)?.[1] ?? 0);
  return {
    shield: clamp(Number.isFinite(shield) ? shield : 100, 0, 100),
    combo: Math.max(0, Number.isFinite(combo) ? combo : 0),
  };
}

function parseActiveTiles() {
  const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="13" height="13" rx="2\.5" fill="(#[0-9A-Fa-f]{6})"[^>]*><title>(\d+) contributions on ([^<]+)<\/title><\/rect>/g;
  const tiles = [];
  let match;
  while ((match = rectRe.exec(svg)) !== null) {
    const count = Number(match[4]) || 0;
    if (count <= 0) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    tiles.push({
      x,
      y,
      cx: x + CELL / 2,
      cy: y + CELL / 2,
      col: Math.round((x - GRID_X) / STEP),
      row: Math.round((y - GRID_Y) / STEP),
      fill: match[3],
      count,
      date: match[5],
      theme: themeForFill(match[3]),
    });
  }
  return tiles;
}

function selectDailyTargets(activeTiles, dateSeed) {
  if (!activeTiles.length) return [];
  if (activeTiles.length <= 18) return activeTiles.slice();

  const rng = makeRng(`${username}:daily-target-count:${dateSeed}`);
  const ratio = 0.50 + rng() * 0.22;
  const desired = clamp(Math.round(activeTiles.length * ratio), 18, Math.min(activeTiles.length, 64));

  const ranked = activeTiles.map((tile) => {
    const local = makeRng(`${username}:daily-target:${dateSeed}:${tile.date}`);
    const contributionBoost = Math.min(0.14, Math.log2(tile.count + 1) * 0.012);
    return {
      tile,
      score: local() + contributionBoost,
    };
  }).sort((a, b) => b.score - a.score);

  const selected = [];
  const columnUse = new Map();
  for (const entry of ranked) {
    const hits = columnUse.get(entry.tile.col) ?? 0;
    if (hits >= 3 && selected.length < desired - 5) continue;
    selected.push(entry.tile);
    columnUse.set(entry.tile.col, hits + 1);
    if (selected.length >= desired) break;
  }

  if (selected.length < desired) {
    for (const entry of ranked) {
      if (selected.includes(entry.tile)) continue;
      selected.push(entry.tile);
      if (selected.length >= desired) break;
    }
  }
  return selected;
}

function orderIntoDailyPath(targets, dateSeed) {
  if (!targets.length) return [];
  const rng = makeRng(`${username}:daily-path-order:${dateSeed}`);
  const remaining = targets.slice();
  const path = [];
  let current = remaining.splice(Math.floor(rng() * remaining.length), 1)[0];
  path.push(current);

  while (remaining.length) {
    const sampleSize = Math.min(remaining.length, 7);
    let bestIndex = -1;
    let bestScore = Infinity;

    for (let n = 0; n < sampleSize; n++) {
      const index = Math.floor(rng() * remaining.length);
      const candidate = remaining[index];
      const distance = Math.hypot(candidate.cx - current.cx, candidate.cy - current.cy);
      const score = distance * (0.55 + rng() * 1.25) + rng() * 90 - Math.log2(candidate.count + 1) * 4;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex < 0) bestIndex = Math.floor(rng() * remaining.length);
    current = remaining.splice(bestIndex, 1)[0];
    path.push(current);
  }
  return path;
}

function assignTiming(path, dateSeed) {
  if (!path.length) return [];
  const rng = makeRng(`${username}:daily-shot-timing:${dateSeed}:${path.length}`);
  const start = 0.055;
  const end = 0.945;
  const span = end - start;
  const spacing = path.length > 1 ? span / (path.length - 1) : span;
  const jitterMax = Math.min(spacing * 0.27, 0.0065);

  return path.map((tile, index) => {
    const base = path.length === 1 ? 0.5 : start + spacing * index;
    const jitter = index === 0 || index === path.length - 1 ? 0 : (rng() - 0.5) * 2 * jitterMax;
    const scanRng = makeRng(`${username}:daily-scan:${dateSeed}:${tile.date}:${index}`);
    const radius = 8 + scanRng() * 11;
    const a1 = scanRng() * Math.PI * 2;
    const a2 = a1 + 0.75 + scanRng() * 1.45;
    const a3 = a2 + 0.55 + scanRng() * 1.15;
    return {
      ...tile,
      index,
      shotAt: clamp(base + jitter, 0.04, 0.96),
      side: scanRng() < 0.5 ? "left" : "right",
      scan: {
        a: { x: Math.cos(a1) * radius, y: Math.sin(a1) * radius },
        b: { x: Math.cos(a2) * radius * 0.62, y: Math.sin(a2) * radius * 0.62 },
        c: { x: Math.cos(a3) * radius * 0.26, y: Math.sin(a3) * radius * 0.26 },
      },
    };
  });
}

function timeline(shotAt, totalTargets) {
  const averageGap = totalTargets > 1 ? 0.89 / (totalTargets - 1) : 0.12;
  const acquireLead = clamp(averageGap * 0.62, 0.009, 0.024);
  const t0 = clamp(shotAt - acquireLead, 0.001, 0.985);
  const sweep1 = clamp(shotAt - acquireLead * 0.58, t0 + 0.001, 0.989);
  const sweep2 = clamp(shotAt - acquireLead * 0.30, sweep1 + 0.001, 0.992);
  const lock = clamp(shotAt - Math.min(0.0032, averageGap * 0.17), sweep2 + 0.0008, 0.995);
  const hit = clamp(shotAt, lock + 0.0008, 0.996);
  const fade = clamp(hit + Math.min(0.0045, averageGap * 0.15), hit + 0.0008, 0.998);
  const end = clamp(fade + Math.min(0.0055, averageGap * 0.20), fade + 0.0008, 0.999);
  return {
    t0,
    sweep1,
    sweep2,
    lock,
    hit,
    fade,
    end,
    keyTimes: `0;${t0.toFixed(4)};${sweep1.toFixed(4)};${sweep2.toFixed(4)};${lock.toFixed(4)};${hit.toFixed(4)};${fade.toFixed(4)};${end.toFixed(4)};1`,
  };
}

function movingMuzzleValues(times, side) {
  return [
    muzzleXAt(0, side),
    muzzleXAt(times.t0, side),
    muzzleXAt(times.sweep1, side),
    muzzleXAt(times.sweep2, side),
    muzzleXAt(times.lock, side),
    muzzleXAt(times.hit, side),
    muzzleXAt(times.fade, side),
    muzzleXAt(times.end, side),
    muzzleXAt(1, side),
  ].map((value) => value.toFixed(1)).join(";");
}

function buildReticle(targets) {
  if (!targets.length) return "";
  const frames = [];
  const push = (time, x, y, opacity) => {
    let t = clamp(time, 0, 1);
    const last = frames[frames.length - 1];
    if (last) t = Math.max(t, last.time + 0.0001);
    frames.push({ time: Math.min(t, 1), x, y, opacity });
  };

  push(0, targets[0].cx, targets[0].cy, 0);
  for (const target of targets) {
    const times = timeline(target.shotAt, targets.length);
    push(times.t0 - 0.0005, target.cx, target.cy, 0);
    push(times.t0, target.cx + target.scan.a.x, target.cy + target.scan.a.y, 0.42);
    push(times.sweep1, target.cx + target.scan.b.x, target.cy + target.scan.b.y, 0.70);
    push(times.sweep2, target.cx + target.scan.c.x, target.cy + target.scan.c.y, 0.90);
    push(times.lock, target.cx, target.cy, 1);
    push(times.hit, target.cx, target.cy, 1);
    push(times.fade, target.cx, target.cy, 0.45);
  }
  push(1, targets[targets.length - 1].cx, targets[targets.length - 1].cy, 0);

  const values = frames.map((frame) => `${frame.x.toFixed(1)} ${frame.y.toFixed(1)}`).join(";");
  const keyTimes = frames.map((frame) => frame.time.toFixed(4)).join(";");
  const opacity = frames.map((frame) => frame.opacity.toFixed(2)).join(";");

  return `<g id="fire-control-reticle" transform="translate(${targets[0].cx.toFixed(1)} ${targets[0].cy.toFixed(1)})" opacity="0">
    <animateTransform attributeName="transform" type="translate" values="${values}" keyTimes="${keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
    <animate attributeName="opacity" values="${opacity}" keyTimes="${keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    <circle cx="0" cy="0" r="16" fill="none" stroke="#22D3EE" stroke-width="1.3" opacity=".82"/>
    <circle cx="0" cy="0" r="24" fill="none" stroke="#38BDF8" stroke-width=".9" stroke-dasharray="6 3" opacity=".5"><animate attributeName="stroke-dashoffset" values="0;18" dur="1.2s" repeatCount="indefinite"/></circle>
    <line x1="0" y1="-14" x2="0" y2="-6" stroke="#22D3EE" stroke-width="1.4"/>
    <line x1="0" y1="6" x2="0" y2="14" stroke="#22D3EE" stroke-width="1.4"/>
    <line x1="-14" y1="0" x2="-6" y2="0" stroke="#22D3EE" stroke-width="1.4"/>
    <line x1="6" y1="0" x2="14" y2="0" stroke="#22D3EE" stroke-width="1.4"/>
    <circle cx="0" cy="0" r="2" fill="#FACC15"><animate attributeName="opacity" values="1;.28;1" dur=".65s" repeatCount="indefinite"/></circle>
  </g>`;
}

function buildShot(target, shield, totalTargets, side = target.side, shotAt = target.shotAt, secondary = false) {
  const times = timeline(shotAt, totalTargets);
  const muzzleValues = movingMuzzleValues(times, side);
  const muzzleX = muzzleXAt(shotAt, side).toFixed(1);
  const muzzleY = JET_Y + GUN_Y;
  const beamWidth = secondary ? 1.0 : shield >= 65 ? 3.8 : shield >= 30 ? 3.1 : 2.5;
  const glowOpacity = secondary ? 0.66 : shield >= 65 ? 0.94 : shield >= 30 ? 0.76 : 0.58;

  return `<g class="combat-shot${secondary ? " combat-shot-secondary" : ""}" data-target-date="${target.date}" data-target-count="${target.count}" data-gun="${side}">
    <line x1="${muzzleX}" y1="${muzzleY}" x2="${target.cx}" y2="${target.cy}" stroke="${target.theme.glow}" stroke-width="${beamWidth}" opacity="0" filter="url(#laserGlow)">
      <animate attributeName="x1" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;0;${glowOpacity};.18;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </line>
    <line x1="${muzzleX}" y1="${muzzleY}" x2="${target.cx}" y2="${target.cy}" stroke="${target.theme.core}" stroke-width="${secondary ? 0.9 : 1.2}" opacity="0">
      <animate attributeName="x1" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;0;1;.12;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </line>
    <circle cx="${muzzleX}" cy="${muzzleY}" r="${secondary ? 2 : 2.8}" fill="#FFFFFF" opacity="0" filter="url(#laserGlow)">
      <animate attributeName="cx" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;0;1;.08;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </circle>
    ${secondary ? "" : `<circle cx="${target.cx}" cy="${target.cy}" r="0" fill="none" stroke="${target.theme.impact}" stroke-width="1.7" opacity="0"><animate attributeName="r" values="0;0;0;0;3;13;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;0;0;1;.45;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></circle><circle cx="${target.cx}" cy="${target.cy}" r="4" fill="#FFFFFF" opacity="0"><animate attributeName="opacity" values="0;0;0;0;1;.10;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/></circle>`}
  </g>`;
}

function buildCombatLayer(targets, shield, combo) {
  const parts = [buildReticle(targets)];
  targets.forEach((target, index) => {
    parts.push(buildShot(target, shield, targets.length));
    if (combo >= 18 && index % 11 === 5) {
      const opposite = target.side === "left" ? "right" : "left";
      parts.push(buildShot(target, shield, targets.length, opposite, clamp(target.shotAt + 0.0048, 0.03, 0.985), true));
    }
  });
  return `<g id="combat-layer">\n${parts.filter(Boolean).join("\n")}\n</g>`;
}

const dateSeed = new Date().toISOString().slice(0, 10);
const { shield, combo } = parseTelemetry();
const activeTiles = parseActiveTiles();
const selected = selectDailyTargets(activeTiles, dateSeed);
const targets = assignTiming(orderIntoDailyPath(selected, dateSeed), dateSeed);

const combatStart = svg.indexOf('<g id="combat-layer">');
const jetStart = svg.indexOf('  <g id="jet"');
if (combatStart < 0 || jetStart < 0 || combatStart > jetStart) {
  throw new Error("Could not locate generated combat layer before jet");
}

const combat = buildCombatLayer(targets, shield, combo);
svg = svg.slice(0, combatStart) + combat + "\n" + svg.slice(jetStart);
svg = svg.replace(/STATEFUL PROFILE ENGINE v\d+ · [^<]+/g, "STATEFUL PROFILE ENGINE v6 · DAILY RANDOM FIRE PATH");
fs.writeFileSync(file, svg, "utf8");
console.log(`Daily fire path ${dateSeed}: ${targets.length}/${activeTiles.length} active contribution days targeted.`);

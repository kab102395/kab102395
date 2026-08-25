#!/usr/bin/env node
import fs from "node:fs";

const file = process.env.OUTPUT_PATH || "github-jet.svg";
const username = process.env.GH_USERNAME || "kab102395";
const GRID_X = 145;
const GRID_Y = 112;
const CELL = 13;
const STEP = 17;
const JET_Y = 294;
const LOOP_SECONDS = 20;
const JET_START_X = GRID_X + 5;
const JET_END_X = GRID_X + 51 * STEP + 5;
const LEFT_GUN_X = -20.5;
const RIGHT_GUN_X = 20.5;
const GUN_Y = -9;

let svg = fs.readFileSync(file, "utf8");

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
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

// Must match the SVG animateTransform exactly. This is deliberately linear so
// combat origins and the rendered ship can never disagree about patrol position.
function shipXAt(time) {
  const t = clamp(time, 0, 1);
  if (t <= 0.5) return JET_START_X + (JET_END_X - JET_START_X) * (t / 0.5);
  return JET_END_X - (JET_END_X - JET_START_X) * ((t - 0.5) / 0.5);
}

function muzzleXAt(time, side) {
  return shipXAt(time) + (side === "left" ? LEFT_GUN_X : RIGHT_GUN_X);
}

function themeForFill(fill) {
  const f = String(fill).toUpperCase();
  if (f === "#6EE7B7") return { core: "#FFF7CC", glow: "#FACC15", impact: "#FDE047" };
  if (f === "#10B981") return { core: "#ECFCCB", glow: "#84CC16", impact: "#BEF264" };
  if (f === "#047857") return { core: "#D1FAE5", glow: "#22C55E", impact: "#86EFAC" };
  if (f === "#064E3B") return { core: "#CCFBF1", glow: "#10B981", impact: "#6EE7B7" };
  return { core: "#E0F2FE", glow: "#38BDF8", impact: "#7DD3FC" };
}

function parseTelemetry() {
  const shield = Number(svg.match(/SHIELD <\/tspan><tspan class="white">(\d+)%<\/tspan>/)?.[1] ?? 100);
  const combo = Number(svg.match(/COMBO <\/tspan><tspan class="white">x(\d+)/)?.[1] ?? 0);
  return { shield: clamp(shield, 0, 100), combo: Math.max(0, combo) };
}

function parseActiveTiles() {
  const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="13" height="13" rx="2\.5" fill="(#[0-9A-Fa-f]{6})"[^>]*><title>(\d+) contributions on ([^<]+)<\/title><\/rect>/g;
  const tiles = [];
  let m;
  while ((m = rectRe.exec(svg)) !== null) {
    const count = Number(m[4]) || 0;
    if (count <= 0) continue;
    const x = Number(m[1]);
    const y = Number(m[2]);
    tiles.push({
      x,
      y,
      cx: x + CELL / 2,
      cy: y + CELL / 2,
      col: Math.round((x - GRID_X) / STEP),
      row: Math.round((y - GRID_Y) / STEP),
      fill: m[3],
      count,
      date: m[5],
    });
  }
  return tiles;
}

function pickTargets(tiles, combo) {
  if (!tiles.length) return [];
  const dateSeed = new Date().toISOString().slice(0, 10);
  const rng = makeRng(`${username}:${dateSeed}:${combo}`);
  const desired = Math.min(14, Math.max(8, 8 + Math.floor(combo / 8)));
  const candidates = tiles
    .map((tile) => ({ ...tile, weight: tile.count * 2 + rng() * 10 }))
    .sort((a, b) => b.weight - a.weight);

  const selected = [];
  for (const tile of candidates) {
    const tooClose = selected.some((t) => Math.abs(t.col - tile.col) < 2 && Math.abs(t.row - tile.row) < 2);
    if (tooClose) continue;
    selected.push(tile);
    if (selected.length >= desired) break;
  }

  return selected.map((tile, index) => {
    const forwardPass = rng() > 0.34;
    const colFraction = clamp(tile.col / 51, 0, 1);
    const aligned = forwardPass ? colFraction * 0.5 : 1 - colFraction * 0.5;
    const shotAt = clamp(aligned + (rng() - 0.5) * 0.018, 0.025, 0.975);
    return { ...tile, index, shotAt, theme: themeForFill(tile.fill) };
  }).sort((a, b) => a.shotAt - b.shotAt);
}

function timeline(t) {
  // Tight burst: lock precedes fire; beam is bright for only a few frames.
  const t0 = clamp(t - 0.010, 0.001, 0.992);
  const lock = clamp(t - 0.004, t0 + 0.001, 0.994);
  const hit = clamp(t, lock + 0.001, 0.996);
  const fade = clamp(t + 0.0045, hit + 0.001, 0.998);
  const end = clamp(t + 0.009, fade + 0.001, 0.999);
  return { t0, lock, hit, fade, end, keyTimes: `0;${t0.toFixed(4)};${lock.toFixed(4)};${hit.toFixed(4)};${fade.toFixed(4)};${end.toFixed(4)};1` };
}

function movingMuzzleValues(times, side) {
  const values = [
    muzzleXAt(0, side),
    muzzleXAt(times.t0, side),
    muzzleXAt(times.lock, side),
    muzzleXAt(times.hit, side),
    muzzleXAt(times.fade, side),
    muzzleXAt(times.end, side),
    muzzleXAt(1, side),
  ];
  return values.map((v) => v.toFixed(1)).join(";");
}

function buildShot(t, i, shield, combo, forceSide = null, shotAtOverride = null, secondary = false) {
  const side = forceSide || (i % 2 === 0 ? "left" : "right");
  const shotAt = shotAtOverride ?? t.shotAt;
  const times = timeline(shotAt);
  const muzzleValues = movingMuzzleValues(times, side);
  const initialMuzzleX = muzzleXAt(shotAt, side).toFixed(1);
  const muzzleY = JET_Y + GUN_Y;
  const beamWidth = secondary ? 1.1 : shield >= 65 ? 4.2 : shield >= 30 ? 3.4 : 2.7;
  const glowOpacity = secondary ? 0.72 : shield >= 65 ? 0.96 : shield >= 30 ? 0.78 : 0.6;

  return `  <g class="combat-shot${secondary ? " combat-shot-secondary" : ""}" data-target-date="${t.date}" data-target-count="${t.count}" data-gun="${side}">
    ${secondary ? "" : `<g class="target-lock" opacity="0">
      <circle cx="${t.cx}" cy="${t.cy}" r="12" fill="none" stroke="${t.theme.glow}" stroke-width="1.1" stroke-dasharray="4 3"/>
      <path d="M${t.cx - 9} ${t.cy - 9} h5 M${t.cx - 9} ${t.cy - 9} v5 M${t.cx + 9} ${t.cy - 9} h-5 M${t.cx + 9} ${t.cy - 9} v5 M${t.cx - 9} ${t.cy + 9} h5 M${t.cx - 9} ${t.cy + 9} v-5 M${t.cx + 9} ${t.cy + 9} h-5 M${t.cx + 9} ${t.cy + 9} v-5" stroke="#FACC15" stroke-width="1.15" fill="none"/>
      <animate attributeName="opacity" values="0;0;.35;.95;0;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </g>`}
    <line x1="${initialMuzzleX}" y1="${muzzleY}" x2="${t.cx}" y2="${t.cy}" stroke="${t.theme.glow}" stroke-width="${beamWidth}" opacity="0" filter="url(#laserGlow)">
      <animate attributeName="x1" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;${glowOpacity};.18;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </line>
    <line x1="${initialMuzzleX}" y1="${muzzleY}" x2="${t.cx}" y2="${t.cy}" stroke="${t.theme.core}" stroke-width="${secondary ? 1 : 1.25}" opacity="0">
      <animate attributeName="x1" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;1;.12;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </line>
    <circle cx="${initialMuzzleX}" cy="${muzzleY}" r="${secondary ? 2.2 : 3}" fill="#FFFFFF" opacity="0" filter="url(#laserGlow)">
      <animate attributeName="cx" values="${muzzleValues}" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>
      <animate attributeName="opacity" values="0;0;0;1;.08;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </circle>
    ${secondary ? "" : `<circle cx="${t.cx}" cy="${t.cy}" r="0" fill="none" stroke="${t.theme.impact}" stroke-width="1.8" opacity="0">
      <animate attributeName="r" values="0;0;0;3;14;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0;0;1;.48;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </circle>
    <circle cx="${t.cx}" cy="${t.cy}" r="4" fill="#FFFFFF" opacity="0">
      <animate attributeName="opacity" values="0;0;0;1;.12;0;0" keyTimes="${times.keyTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>
    </circle>`}
  </g>`;
}

function buildCombatLayer(targets, shield, combo) {
  const shots = [];
  targets.forEach((t, i) => {
    const primarySide = i % 2 === 0 ? "left" : "right";
    shots.push(buildShot(t, i, shield, combo, primarySide));
    if (combo >= 16 && i % 4 === 1) {
      const opposite = primarySide === "left" ? "right" : "left";
      shots.push(buildShot(t, i, shield, combo, opposite, clamp(t.shotAt + 0.011, 0.03, 0.985), true));
    }
  });
  return `<g id="combat-layer">\n${shots.join("\n")}\n</g>`;
}

function buildShield(shield, color) {
  const radius = 33;
  const circumference = 2 * Math.PI * radius;
  const background = `<circle cx="0" cy="0" r="${radius}" fill="none" stroke="#162033" stroke-width="2.5" opacity=".72"/>`;

  if (shield >= 99.95) {
    return `${background}
    <circle data-shield-state="full" cx="0" cy="0" r="${radius}" fill="none" stroke="${color}" stroke-width="3" filter="url(#glow)" opacity=".94"><animate attributeName="opacity" values=".64;1;.64" dur="2s" repeatCount="indefinite"/></circle>`;
  }

  const arc = circumference * (shield / 100);
  const gap = Math.max(0.1, circumference - arc);
  return `${background}
    <circle data-shield-state="partial" cx="0" cy="0" r="${radius}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${gap.toFixed(2)}" transform="rotate(-90)" filter="url(#glow)" opacity=".9"><animate attributeName="opacity" values=".5;1;.5" dur="2s" repeatCount="indefinite"/></circle>`;
}

function ensureDefs() {
  if (!svg.includes('id="laserGlow"')) {
    svg = svg.replace('</defs>', `  <filter id="laserGlow" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="2.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>\n</defs>`);
  }
  if (!svg.includes('id="plasmaFlame"')) {
    svg = svg.replace('</defs>', `  <linearGradient id="plasmaFlame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".2" stop-color="#38BDF8"/><stop offset=".58" stop-color="#818CF8"/><stop offset=".82" stop-color="#F59E0B"/><stop offset="1" stop-color="#EF4444" stop-opacity="0"/></linearGradient>\n  <radialGradient id="ionGlow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#38BDF8" stop-opacity=".9"/><stop offset="1" stop-color="#38BDF8" stop-opacity="0"/></radialGradient>\n</defs>`);
  }
}

const { shield, combo } = parseTelemetry();
const tiles = parseActiveTiles();
const targets = pickTargets(tiles, combo);
const shieldColor = shield >= 65 ? "#22D3EE" : shield >= 30 ? "#FACC15" : "#FB7185";
ensureDefs();

const start = svg.indexOf('  <g id="jet"');
const endMarker = '\n\n  <text x="24" y="340"';
const end = svg.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("Could not locate stateful jet block");

// Remove any previously inserted combat layer before regenerating it.
const combatStart = svg.indexOf('  <g id="combat-layer">');
if (combatStart >= 0 && combatStart < start) {
  const combatEnd = svg.indexOf('\n  <g id="jet"', combatStart);
  if (combatEnd > combatStart) {
    svg = svg.slice(0, combatStart) + svg.slice(combatEnd);
  }
}

const refreshedStart = svg.indexOf('  <g id="jet"');
const refreshedEnd = svg.indexOf(endMarker, refreshedStart);
const combat = buildCombatLayer(targets, shield, combo);
const ship = `  <g id="jet" transform="translate(${JET_START_X} ${JET_Y})">
    <animateTransform attributeName="transform" type="translate" values="${JET_START_X} ${JET_Y};${JET_END_X} ${JET_Y};${JET_START_X} ${JET_Y}" keyTimes="0;.5;1" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>

    ${buildShield(shield, shieldColor)}

    <!-- Forward targeting system -->
    <line x1="0" y1="-20" x2="0" y2="-105" stroke="#22D3EE" stroke-width="1" stroke-dasharray="4 3" opacity=".5"/>
    <circle cx="0" cy="-68" r="16" fill="none" stroke="#22D3EE" stroke-width="1.2" opacity=".7"/>
    <circle cx="0" cy="-68" r="24" fill="none" stroke="#38BDF8" stroke-width=".9" stroke-dasharray="6 3" opacity=".42"/>
    <line x1="0" y1="-82" x2="0" y2="-74" stroke="#22D3EE" stroke-width="1.4"/><line x1="0" y1="-62" x2="0" y2="-54" stroke="#22D3EE" stroke-width="1.4"/>
    <line x1="-14" y1="-68" x2="-6" y2="-68" stroke="#22D3EE" stroke-width="1.4"/><line x1="6" y1="-68" x2="14" y2="-68" stroke="#22D3EE" stroke-width="1.4"/>
    <circle cx="0" cy="-68" r="2" fill="#FACC15"><animate attributeName="opacity" values="1;.25;1" dur=".65s" repeatCount="indefinite"/></circle>

    <!-- Ion wake -->
    <ellipse cx="0" cy="20" rx="15" ry="3" fill="url(#ionGlow)" opacity=".38"><animate attributeName="rx" values="12;19;14;18" dur=".22s" repeatCount="indefinite"/><animate attributeName="opacity" values=".25;.7;.2;.6" dur=".22s" repeatCount="indefinite"/></ellipse>

    <!-- Twin wingtip railguns -->
    <rect x="-22" y="-9" width="3" height="20" rx="1" fill="#7DD3FC" stroke="#0284C7" stroke-width=".7"/>
    <rect x="19" y="-9" width="3" height="20" rx="1" fill="#7DD3FC" stroke="#0284C7" stroke-width=".7"/>
    <circle cx="${LEFT_GUN_X}" cy="${GUN_Y}" r="2" fill="#22D3EE" filter="url(#glow)"><animate attributeName="opacity" values=".5;1;.5" dur=".55s" repeatCount="indefinite"/></circle>
    <circle cx="${RIGHT_GUN_X}" cy="${GUN_Y}" r="2" fill="#22D3EE" filter="url(#glow)"><animate attributeName="opacity" values=".5;1;.5" dur=".55s" repeatCount="indefinite"/></circle>

    <!-- Dual-hull interceptor -->
    <polygon points="-15,-17 -7,-17 -5,10 -17,10" fill="#38BDF8" stroke="#E0F2FE" stroke-width="1.1"/>
    <polygon points="7,-17 15,-17 17,10 5,10" fill="#38BDF8" stroke="#E0F2FE" stroke-width="1.1"/>
    <polygon points="-8,-8 8,-8 19,10 6,7 -6,7 -19,10" fill="#0284C7" stroke="#38BDF8" stroke-width=".7"/>
    <polygon points="0,-14 7,5 0,2 -7,5" fill="#0F172A" stroke="#38BDF8" stroke-width=".7"/>
    <ellipse cx="0" cy="-4" rx="3.5" ry="6.2" fill="#E0F2FE" opacity=".96" filter="url(#glow)"/><ellipse cx="0" cy="-5.5" rx="1.5" ry="2.7" fill="#FFFFFF"/>

    <!-- Twin plasma thrusters -->
    <polygon points="-14,10 -8,10 -11,31" fill="url(#plasmaFlame)" opacity=".85"><animate attributeName="points" values="-14,10 -8,10 -11,26;-14,10 -8,10 -11,35;-14,10 -8,10 -11,26" dur=".18s" repeatCount="indefinite"/><animate attributeName="opacity" values=".65;1;.65" dur=".18s" repeatCount="indefinite"/></polygon>
    <polygon points="8,10 14,10 11,31" fill="url(#plasmaFlame)" opacity=".85"><animate attributeName="points" values="8,10 14,10 11,26;8,10 14,10 11,35;8,10 14,10 11,26" dur=".18s" repeatCount="indefinite"/><animate attributeName="opacity" values=".65;1;.65" dur=".18s" repeatCount="indefinite"/></polygon>
    <polygon points="-13,10 -9,10 -11,18" fill="#FFFFFF"><animate attributeName="opacity" values=".7;1;.7" dur=".18s" repeatCount="indefinite"/></polygon>
    <polygon points="9,10 13,10 11,18" fill="#FFFFFF"><animate attributeName="opacity" values=".7;1;.7" dur=".18s" repeatCount="indefinite"/></polygon>
  </g>`;

svg = svg.slice(0, refreshedStart) + combat + "\n" + ship + svg.slice(refreshedEnd);
svg = svg.replace(/STATEFUL PROFILE ENGINE v\d+(?: · COMBAT ONLINE)?/g, "STATEFUL PROFILE ENGINE v4 · MUZZLE LOCKED");
fs.writeFileSync(file, svg, "utf8");
console.log(`Combat regenerated with ${targets.length} primary targets; beams track moving railgun muzzles exactly.`);

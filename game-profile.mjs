#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const USERNAME = process.env.GH_USERNAME || "kab102395";
export const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
export const OUTPUT = process.env.OUTPUT_PATH || "github-jet.svg";
export const STATE_PATH = process.env.STATE_PATH || "game-state.json";

export const MAX_SHIELD = 100;
export const XP_PER_CONTRIBUTION = 1000;
export const ACTIVE_DAY_BONUS = 500;
export const WEEK_STREAK_BONUS = 2500;
export const COLS = 52;
export const ROWS = 7;
export const CELL = 13;
export const GAP = 4;
export const STEP = CELL + GAP;
export const WIDTH = 1180;
export const HEIGHT = 360;
export const GRID_X = 145;
export const GRID_Y = 112;

const PALETTE = ["#0B1220", "#064E3B", "#047857", "#10B981", "#6EE7B7"];
const RANKS = [
  [1, "INITIATE"],
  [5, "BUILDER"],
  [10, "ENGINEER"],
  [15, "SYSTEMS ENGINEER"],
  [20, "ARCHITECT"],
  [30, "PRINCIPAL"],
  [40, "FORGE MASTER"],
  [55, "LEGEND"],
];

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, amount) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return isoDate(d);
}

export function yesterdayUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDate(d);
}

export function xpRequiredForTransition(level) {
  return 75000 + Math.max(0, level - 1) * 15000;
}

export function levelFromXp(xp) {
  let level = 1;
  let spent = 0;
  while (level < 99) {
    const need = xpRequiredForTransition(level);
    if (xp < spent + need) break;
    spent += need;
    level += 1;
  }
  return {
    level,
    rank: rankForLevel(level),
    currentLevelXp: xp - spent,
    nextLevelXp: xpRequiredForTransition(level),
    xpToNext: Math.max(0, xpRequiredForTransition(level) - (xp - spent)),
  };
}

export function rankForLevel(level) {
  let rank = RANKS[0][1];
  for (const [min, name] of RANKS) {
    if (level >= min) rank = name;
  }
  return rank;
}

export function shieldRegen(contributions) {
  return Math.min(24, 12 + Math.min(12, Math.max(0, contributions) * 2));
}

export function shieldDamage(combo) {
  return Math.min(40, 22 + Math.floor(Math.max(0, combo) / 7) * 3);
}

export function emptyState() {
  return {
    version: 2,
    xp: 0,
    combo: 0,
    shield: MAX_SHIELD,
    maxCombo: 0,
    activeDays: 0,
    protectedMisses: 0,
    comboBreaks: 0,
    processedThrough: null,
    dailyCounts: {},
    lastEvent: "INITIALIZING",
    lastEventDate: null,
    lastLevel: 1,
  };
}

export function settleCompletedDay(state, date, contributions) {
  const count = Math.max(0, Number(contributions) || 0);
  if (count > 0) {
    state.combo += 1;
    state.activeDays += 1;
    state.shield = Math.min(MAX_SHIELD, state.shield + shieldRegen(count));
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.lastEvent = `ACTIVE +${shieldRegen(count)} SHIELD`;
    if (state.combo > 0 && state.combo % 7 === 0) {
      state.xp += WEEK_STREAK_BONUS;
      state.lastEvent = `7-DAY MILESTONE +${WEEK_STREAK_BONUS.toLocaleString("en-US")} XP`;
    }
  } else {
    const damage = shieldDamage(state.combo);
    if (state.combo > 0 && state.shield >= damage) {
      state.shield -= damage;
      state.protectedMisses += 1;
      state.lastEvent = `MISS ABSORBED -${damage} SHIELD`;
    } else if (state.combo > 0) {
      state.shield = 0;
      state.combo = 0;
      state.comboBreaks += 1;
      state.lastEvent = "COMBO BROKEN";
    } else {
      state.shield = Math.max(0, state.shield - Math.ceil(damage / 2));
      state.lastEvent = "STANDBY DRAIN";
    }
  }
  state.processedThrough = date;
  state.lastEventDate = date;
}

export function awardContributionDeltas(state, days) {
  for (const day of days) {
    const prior = Math.max(0, Number(state.dailyCounts[day.date]) || 0);
    const current = Math.max(0, Number(day.contributionCount) || 0);
    if (current > prior) state.xp += (current - prior) * XP_PER_CONTRIBUTION;
    if (prior === 0 && current > 0) state.xp += ACTIVE_DAY_BONUS;
    state.dailyCounts[day.date] = current;
  }
}

export function processState(previousState, days, now = new Date()) {
  const state = previousState ? structuredClone(previousState) : emptyState();
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, Math.max(0, Number(d.contributionCount) || 0)]));
  const cutoff = yesterdayUtc(now);

  awardContributionDeltas(state, sorted);

  if (!state.processedThrough && sorted.length) {
    let cursor = sorted[0].date;
    while (cursor <= cutoff) {
      settleCompletedDay(state, cursor, byDate.get(cursor) || 0);
      cursor = addDays(cursor, 1);
    }
  } else if (state.processedThrough) {
    let cursor = addDays(state.processedThrough, 1);
    while (cursor <= cutoff) {
      settleCompletedDay(state, cursor, byDate.get(cursor) || 0);
      cursor = addDays(cursor, 1);
    }
  }

  const keepAfter = addDays(isoDate(now), -400);
  state.dailyCounts = Object.fromEntries(Object.entries(state.dailyCounts).filter(([date]) => date >= keepAfter));

  const levelInfo = levelFromXp(state.xp);
  if (levelInfo.level > (state.lastLevel || 1)) state.lastEvent = `LEVEL UP → ${levelInfo.level}`;
  state.lastLevel = levelInfo.level;
  state.version = 2;
  return state;
}

export function previewState(state, days, now = new Date()) {
  const today = isoDate(now);
  const count = Math.max(0, Number(days.find((d) => d.date === today)?.contributionCount) || 0);
  const activeToday = count > 0 && state.processedThrough !== today;
  return {
    combo: state.combo + (activeToday ? 1 : 0),
    shield: activeToday ? Math.min(MAX_SHIELD, state.shield + shieldRegen(count)) : state.shield,
    status: activeToday ? `ACTIVE TODAY · ${count} CONTRIBUTION${count === 1 ? "" : "S"}` : state.lastEvent,
    todayCount: count,
  };
}

export function loadState(filePath = STATE_PATH) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function saveState(state, filePath = STATE_PATH) {
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(n) {
  return Math.max(0, Math.floor(n)).toLocaleString("en-US");
}

function intensity(count, maxCount) {
  if (!count) return 0;
  if (maxCount <= 1) return 4;
  const ratio = count / maxCount;
  if (ratio > 0.72) return 4;
  if (ratio > 0.4) return 3;
  if (ratio > 0.18) return 2;
  return 1;
}

function flattenWeeks(weeks) {
  const days = [];
  for (const week of weeks || []) {
    for (const day of week.contributionDays || []) days.push(day);
  }
  return days.sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeWeeks(days) {
  const last = days.at(-1)?.date || isoDate();
  const first = addDays(last, -(COLS * ROWS - 1));
  const map = new Map(days.map((d) => [d.date, d]));
  const cells = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    const date = addDays(first, i);
    const d = map.get(date) || { date, contributionCount: 0 };
    const col = Math.floor(i / ROWS);
    const row = i % ROWS;
    cells.push({ ...d, col, row });
  }
  return cells;
}

function buildShieldSegments(shield) {
  const active = Math.round(Math.max(0, Math.min(100, shield)) / 10);
  return Array.from({ length: 10 }, (_, i) => {
    const fill = i < active ? "#22D3EE" : "#101827";
    const opacity = i < active ? 0.95 : 0.4;
    return `<rect x="${i * 11}" y="0" width="8" height="12" rx="2" fill="${fill}" opacity="${opacity}" stroke="#0891B2" stroke-width="0.6"/>`;
  }).join("");
}

function buildMonthLabels(cells) {
  const labels = [];
  let lastMonth = null;
  let lastCol = -4;
  for (const cell of cells) {
    if (cell.row !== 0) continue;
    const month = new Date(`${cell.date}T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    if (month !== lastMonth && cell.col - lastCol >= 3) {
      labels.push(`<text x="${GRID_X + cell.col * STEP}" y="99" class="axis">${month}</text>`);
      lastMonth = month;
      lastCol = cell.col;
    }
  }
  return labels.join("\n");
}

export function buildSvg(days, state, now = new Date()) {
  const cells = normalizeWeeks(days);
  const maxCount = Math.max(1, ...cells.map((c) => Number(c.contributionCount) || 0));
  const preview = previewState(state, days, now);
  const level = levelFromXp(state.xp);
  const shield = Math.max(0, Math.min(100, preview.shield));
  const shieldDash = (2 * Math.PI * 27 * shield / 100).toFixed(1);
  const cellsSvg = cells.map((c) => {
    const x = GRID_X + c.col * STEP;
    const y = GRID_Y + c.row * STEP;
    const count = Number(c.contributionCount) || 0;
    const color = PALETTE[intensity(count, maxCount)];
    return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${color}" stroke="${count ? "#34D399" : "#1E293B"}" stroke-width="0.7"><title>${count} contributions on ${c.date}</title></rect>`;
  }).join("\n");

  const rank = escapeXml(level.rank);
  const status = escapeXml(preview.status);
  const comboLabel = preview.combo > 0 ? `x${preview.combo} FLOW` : "x0 COLD";
  const shieldColor = shield >= 65 ? "#22D3EE" : shield >= 30 ? "#FACC15" : "#FB7185";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs>
  <radialGradient id="bg" cx="35%" cy="20%" r="90%"><stop offset="0" stop-color="#0B1424"/><stop offset="1" stop-color="#03060D"/></radialGradient>
  <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22C55E"/><stop offset="0.5" stop-color="#22D3EE"/><stop offset="1" stop-color="#60A5FA"/></linearGradient>
  <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#7DD3FC" opacity="0.035"/></pattern>
  <style>
    .mono{font-family:'Courier New',Consolas,monospace}.gold{fill:#FACC15}.cyan{fill:#38BDF8}.rose{fill:#FB7185}.green{fill:#4ADE80}.white{fill:#E2E8F0}.muted{fill:#64748B}.hud{font-size:12px;font-weight:bold}.tiny{font-size:9px;font-weight:bold;letter-spacing:.7px}.axis{font-family:'Courier New',Consolas,monospace;font-size:9px;font-weight:bold;fill:#64748B}
  </style>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" rx="16" fill="url(#bg)"/><rect width="${WIDTH}" height="${HEIGHT}" rx="16" fill="url(#scan)"/><rect x="2" y="2" width="${WIDTH - 4}" height="${HEIGHT - 4}" rx="15" fill="none" stroke="url(#edge)" stroke-width="1.5"/>

<g class="mono">
  <text x="24" y="29" class="hud"><tspan class="gold">SCORE </tspan><tspan class="white">${formatNumber(state.xp)} XP</tspan></text>
  <text x="276" y="29" class="hud"><tspan class="cyan">LEVEL </tspan><tspan class="white">${level.level} · ${rank}</tspan></text>
  <text x="650" y="29" class="hud"><tspan class="rose">COMBO </tspan><tspan class="white">${comboLabel}</tspan></text>
  <text x="914" y="29" class="hud"><tspan class="cyan">SHIELD </tspan><tspan class="white">${Math.round(shield)}%</tspan></text>
  <g transform="translate(1048 18)">${buildShieldSegments(shield)}</g>
  <line x1="20" y1="44" x2="1160" y2="44" stroke="#1E293B"/><line x1="20" y1="44" x2="180" y2="44" stroke="#FACC15" opacity=".8"/><line x1="1000" y1="44" x2="1160" y2="44" stroke="#22D3EE" opacity=".8"/>

  <text x="24" y="66" class="tiny green">STATUS</text><text x="80" y="66" class="tiny white">${status}</text>
  <text x="420" y="66" class="tiny cyan">NEXT LEVEL</text><text x="500" y="66" class="tiny white">${formatNumber(level.xpToNext)} XP</text>
  <text x="684" y="66" class="tiny rose">MAX COMBO</text><text x="760" y="66" class="tiny white">x${state.maxCombo}</text>
  <text x="870" y="66" class="tiny cyan">SAVES</text><text x="918" y="66" class="tiny white">${state.protectedMisses}</text>
  <text x="1000" y="66" class="tiny muted">BREAKS ${state.comboBreaks}</text>

  ${buildMonthLabels(cells)}
  <text x="132" y="139" class="axis" text-anchor="end">MON</text><text x="132" y="173" class="axis" text-anchor="end">WED</text><text x="132" y="207" class="axis" text-anchor="end">FRI</text>
  <g>${cellsSvg}</g>

  <g opacity=".35"><circle cx="28" cy="114" r="1" fill="#7DD3FC"><animate attributeName="opacity" values=".15;1;.15" dur="2.4s" repeatCount="indefinite"/></circle><circle cx="1128" cy="188" r="1" fill="#7DD3FC"><animate attributeName="opacity" values=".15;1;.15" dur="1.8s" repeatCount="indefinite"/></circle><circle cx="78" cy="286" r="1" fill="#7DD3FC"><animate attributeName="opacity" values=".15;1;.15" dur="3.1s" repeatCount="indefinite"/></circle></g>

  <g id="jet" transform="translate(${GRID_X + 5} 294)">
    <animateTransform attributeName="transform" type="translate" values="${GRID_X + 5} 294;${GRID_X + 51 * STEP + 5} 294;${GRID_X + 5} 294" keyTimes="0;.5;1" dur="20s" repeatCount="indefinite"/>
    <circle cx="0" cy="0" r="27" fill="none" stroke="#162033" stroke-width="3"/>
    <circle cx="0" cy="0" r="27" fill="none" stroke="${shieldColor}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${shieldDash} 170" transform="rotate(-90)" filter="url(#glow)" opacity=".85"><animate attributeName="opacity" values=".45;1;.45" dur="2s" repeatCount="indefinite"/></circle>
    <circle cx="0" cy="-43" r="12" fill="none" stroke="#22D3EE" stroke-width="1.2" opacity=".65"/><line x1="0" y1="-30" x2="0" y2="-95" stroke="#22D3EE" stroke-width="1" stroke-dasharray="4 4" opacity=".5"/>
    <path d="M0 -13 L10 4 L5 4 L3 15 L0 11 L-3 15 L-5 4 L-10 4 Z" fill="#38BDF8" stroke="#E0F2FE" stroke-width="1.1" filter="url(#glow)"/>
    <path d="M-3 14 L0 30 L3 14 Z" fill="#F59E0B" opacity=".8"><animate attributeName="d" values="M-3 14 L0 25 L3 14 Z;M-4 14 L0 34 L4 14 Z;M-3 14 L0 25 L3 14 Z" dur=".35s" repeatCount="indefinite"/></path>
  </g>

  <text x="24" y="340" class="tiny muted">POWER MODE: ${shield >= 65 ? "FORTIFIED" : shield >= 30 ? "CAUTION" : "CRITICAL"}</text>
  <text x="470" y="340" class="tiny muted">ACTIVE DAYS ${state.activeDays} · PROTECTED MISSES ${state.protectedMisses}</text>
  <text x="1150" y="340" text-anchor="end" class="tiny muted">[SECTOR: ${escapeXml(USERNAME.toUpperCase())} // STATEFUL PROFILE ENGINE v2]</text>
</g>
</svg>`;
}

const QUERY = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;

export async function fetchWeeks(username = USERNAME, token = TOKEN) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) throw new Error("Invalid GitHub username");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "stateful-github-profile" },
    body: JSON.stringify({ query: QUERY, variables: { login: username } }),
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data.user.contributionsCollection.contributionCalendar.weeks;
}

export async function main() {
  if (!TOKEN) throw new Error("GH_TOKEN/GITHUB_TOKEN is required for the live profile engine");
  const weeks = await fetchWeeks();
  const days = flattenWeeks(weeks);
  const previous = loadState();
  const state = processState(previous, days);
  saveState(state);
  const svg = buildSvg(days, state);
  fs.writeFileSync(path.resolve(OUTPUT), svg, "utf8");
  console.log(`Stateful profile generated for @${USERNAME}: level ${levelFromXp(state.xp).level}, combo ${state.combo}, shield ${state.shield}%, XP ${state.xp}`);
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) main().catch((err) => { console.error(`FATAL: ${err.message}`); process.exit(1); });

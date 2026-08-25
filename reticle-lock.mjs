#!/usr/bin/env node
import fs from "node:fs";

const file = process.env.OUTPUT_PATH || "github-jet.svg";
const username = process.env.GH_USERNAME || "kab102395";
const LOOP_SECONDS = 20;
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

const dateSeed = new Date().toISOString().slice(0, 10);
let lockIndex = 0;

// Match each primary combat reticle and capture its existing fire timeline.
const shotRe = /(<g class="combat-shot(?!-secondary)"[^>]*data-target-date="([^"]+)"[^>]*>[\s\S]*?<g class="target-lock" opacity="0">)([\s\S]*?)(<animate attributeName="opacity" values="0;0;\.35;\.95;0;0;0" keyTimes="([^"]+)" dur="20s" repeatCount="indefinite"\/>)([\s\S]*?<\/g>)/g;

svg = svg.replace(shotRe, (whole, opening, targetDate, body, oldOpacity, oldKeyTimes, tail) => {
  const fireTimes = oldKeyTimes.split(";").map(Number);
  const hit = Number.isFinite(fireTimes[3]) ? fireTimes[3] : 0.5;
  const oldEnd = Number.isFinite(fireTimes[5]) ? fireTimes[5] : clamp(hit + 0.009, 0, 0.999);

  const rng = makeRng(`${username}:${dateSeed}:${targetDate}:${lockIndex++}`);

  // Visible acquisition starts ~1.1 seconds before impact in a 20-second loop.
  const acquire = clamp(hit - 0.055, 0.001, hit - 0.020);
  const sweep1 = clamp(hit - 0.040, acquire + 0.003, hit - 0.014);
  const sweep2 = clamp(hit - 0.025, sweep1 + 0.003, hit - 0.009);
  const tighten = clamp(hit - 0.010, sweep2 + 0.002, hit - 0.003);
  const settle = clamp(hit - 0.003, tighten + 0.001, hit - 0.0005);
  const disappear = clamp(Math.max(oldEnd, hit + 0.008), hit + 0.002, 0.999);

  const trackingTimes = [0, acquire, sweep1, sweep2, tighten, settle, hit, disappear, 1]
    .map((n) => n.toFixed(4))
    .join(";");

  const radius = 15 + rng() * 12;
  const angle1 = rng() * Math.PI * 2;
  const angle2 = angle1 + 1.0 + rng() * 1.4;
  const angle3 = angle2 + 0.7 + rng() * 1.1;

  const p1 = [Math.cos(angle1) * radius, Math.sin(angle1) * radius];
  const p2 = [Math.cos(angle2) * radius * 0.72, Math.sin(angle2) * radius * 0.72];
  const p3 = [Math.cos(angle3) * radius * 0.42, Math.sin(angle3) * radius * 0.42];
  const p4 = [p3[0] * 0.30, p3[1] * 0.30];

  const fmt = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  const translateValues = [
    "0 0",
    fmt(p1),
    fmt(p2),
    fmt(p3),
    fmt(p4),
    "0 0",
    "0 0",
    "0 0",
    "0 0",
  ].join(";");

  const rotation = (10 + rng() * 16).toFixed(1);
  const sweep = `\n      <animateTransform attributeName="transform" type="translate" values="${translateValues}" keyTimes="${trackingTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>`;
  const spin = `\n      <animateTransform attributeName="transform" additive="sum" type="rotate" values="0;${rotation};-${rotation};${(Number(rotation) * 0.45).toFixed(1)};0;0;0;0;0" keyTimes="${trackingTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite" calcMode="linear"/>`;
  const opacity = `\n      <animate attributeName="opacity" values="0;0;.32;.58;.82;1;1;0;0" keyTimes="${trackingTimes}" dur="${LOOP_SECONDS}s" repeatCount="indefinite"/>`;

  // Body already contains the reticle circle/corners. Replace the old short-lived
  // opacity animation with a longer acquisition/tracking sequence.
  return `${opening}${sweep}${spin}${body}${opacity}${tail}`;
});

if (lockIndex === 0) {
  throw new Error("No primary target-lock groups found to animate");
}

svg = svg.replace(/STATEFUL PROFILE ENGINE v\d+ · [^<]+/, "STATEFUL PROFILE ENGINE v5 · TRACKING FIRE CONTROL");
fs.writeFileSync(file, svg, "utf8");
console.log(`Animated ${lockIndex} reticles with visible acquisition → sweep → tighten → lock → fire.`);

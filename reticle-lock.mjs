#!/usr/bin/env node
import fs from "node:fs";

const file = process.env.OUTPUT_PATH || "github-jet.svg";
const username = process.env.GH_USERNAME || "kab102395";
let svg = fs.readFileSync(file, "utf8");

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

const shotRe = /(<g class="combat-shot(?!-secondary)"[^>]*data-target-date="([^"]+)"[^>]*>[\s\S]*?<g class="target-lock" opacity="0">)([\s\S]*?)(<animate attributeName="opacity" values="0;0;\.35;\.95;0;0;0" keyTimes="([^"]+)" dur="20s" repeatCount="indefinite"\/>[\s\S]*?<\/g>)/g;

svg = svg.replace(shotRe, (whole, opening, targetDate, body, closing, keyTimes) => {
  const rng = makeRng(`${username}:${dateSeed}:${targetDate}:${lockIndex++}`);
  const radius = 9 + rng() * 9;
  const a1 = rng() * Math.PI * 2;
  const a2 = a1 + 0.9 + rng() * 1.7;
  const dx1 = (Math.cos(a1) * radius).toFixed(1);
  const dy1 = (Math.sin(a1) * radius).toFixed(1);
  const dx2 = (Math.cos(a2) * radius * 0.5).toFixed(1);
  const dy2 = (Math.sin(a2) * radius * 0.5).toFixed(1);

  const sweep = `\n      <animateTransform attributeName="transform" type="translate" values="0 0;${dx1} ${dy1};${dx2} ${dy2};0 0;0 0;0 0;0 0" keyTimes="${keyTimes}" dur="20s" repeatCount="indefinite" calcMode="linear"/>`;
  const spin = `\n      <animateTransform attributeName="transform" additive="sum" type="rotate" values="0;18;-10;0;0;0;0" keyTimes="${keyTimes}" dur="20s" repeatCount="indefinite" calcMode="linear"/>`;

  let enhancedBody = body;
  enhancedBody = enhancedBody.replace(/(<circle[^>]*class="reticle-ring"[^>]*>)/, `$1`);
  enhancedBody = enhancedBody.replace(/(<circle cx="[^"]+" cy="[^"]+" r="12"[^>]*>)/, `$1`);

  return `${opening}${sweep}${spin}${enhancedBody}${closing}`;
});

if (lockIndex === 0) {
  throw new Error("No primary target-lock groups found to animate");
}

svg = svg.replace("STATEFUL PROFILE ENGINE v3 · COMBAT ONLINE", "STATEFUL PROFILE ENGINE v4 · FIRE CONTROL ONLINE");
fs.writeFileSync(file, svg, "utf8");
console.log(`Animated ${lockIndex} fire-control reticles: sweep → settle → fire.`);

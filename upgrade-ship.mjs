#!/usr/bin/env node
import fs from "node:fs";

const file = process.env.OUTPUT_PATH || "github-jet.svg";
let svg = fs.readFileSync(file, "utf8");

const shieldMatch = svg.match(/<circle cx="0" cy="0" r="27" fill="none" stroke="([^"]+)" stroke-width="3" stroke-linecap="round" stroke-dasharray="([^"]+)"/);
const shieldColor = shieldMatch?.[1] || "#22D3EE";
const shieldDash = shieldMatch?.[2] || "170 170";

const start = svg.indexOf('  <g id="jet"');
const endMarker = '\n\n  <text x="24" y="340"';
const end = svg.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error("Could not locate stateful jet block");

const replacement = `  <g id="jet" transform="translate(150 294)">
    <animateTransform attributeName="transform" type="translate" values="150 294;1017 294;150 294" keyTimes="0;.5;1" dur="20s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>

    <!-- Stateful shield envelope -->
    <circle cx="0" cy="0" r="31" fill="none" stroke="#162033" stroke-width="2.5" opacity=".75"/>
    <circle cx="0" cy="0" r="31" fill="none" stroke="${shieldColor}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${shieldDash}" transform="rotate(-90)" filter="url(#glow)" opacity=".9">
      <animate attributeName="opacity" values=".5;1;.5" dur="2s" repeatCount="indefinite"/>
    </circle>

    <!-- Forward targeting system -->
    <line x1="0" y1="-18" x2="0" y2="-103" stroke="#22D3EE" stroke-width="1.1" stroke-dasharray="4 3" opacity=".55"/>
    <circle cx="0" cy="-66" r="16" fill="none" stroke="#22D3EE" stroke-width="1.3" opacity=".75"/>
    <circle cx="0" cy="-66" r="24" fill="none" stroke="#38BDF8" stroke-width=".9" stroke-dasharray="6 3" opacity=".45"/>
    <line x1="0" y1="-80" x2="0" y2="-72" stroke="#22D3EE" stroke-width="1.5"/>
    <line x1="0" y1="-60" x2="0" y2="-52" stroke="#22D3EE" stroke-width="1.5"/>
    <line x1="-14" y1="-66" x2="-6" y2="-66" stroke="#22D3EE" stroke-width="1.5"/>
    <line x1="6" y1="-66" x2="14" y2="-66" stroke="#22D3EE" stroke-width="1.5"/>
    <circle cx="0" cy="-66" r="2" fill="#FACC15"><animate attributeName="opacity" values="1;.25;1" dur=".65s" repeatCount="indefinite"/></circle>

    <!-- Ion wake -->
    <ellipse cx="0" cy="20" rx="15" ry="3" fill="#38BDF8" opacity=".18" filter="url(#glow)">
      <animate attributeName="rx" values="12;19;14;18" dur=".22s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".15;.45;.12;.4" dur=".22s" repeatCount="indefinite"/>
    </ellipse>

    <!-- Twin wingtip railguns -->
    <rect x="-22" y="-9" width="3" height="20" rx="1" fill="#7DD3FC" stroke="#0284C7" stroke-width=".7"/>
    <rect x="19" y="-9" width="3" height="20" rx="1" fill="#7DD3FC" stroke="#0284C7" stroke-width=".7"/>
    <circle cx="-20.5" cy="-9" r="2" fill="#22D3EE" filter="url(#glow)"><animate attributeName="opacity" values=".55;1;.55" dur=".55s" repeatCount="indefinite"/></circle>
    <circle cx="20.5" cy="-9" r="2" fill="#22D3EE" filter="url(#glow)"><animate attributeName="opacity" values=".55;1;.55" dur=".55s" repeatCount="indefinite"/></circle>

    <!-- Dual-hull interceptor chassis -->
    <polygon points="-15,-17 -7,-17 -5,10 -17,10" fill="#38BDF8" stroke="#E0F2FE" stroke-width="1.1"/>
    <polygon points="7,-17 15,-17 17,10 5,10" fill="#38BDF8" stroke="#E0F2FE" stroke-width="1.1"/>
    <polygon points="-8,-8 8,-8 19,10 6,7 -6,7 -19,10" fill="#0284C7" stroke="#38BDF8" stroke-width=".7"/>
    <polygon points="0,-14 7,5 0,2 -7,5" fill="#0F172A" stroke="#38BDF8" stroke-width=".7"/>

    <!-- Canopy -->
    <ellipse cx="0" cy="-4" rx="3.5" ry="6.2" fill="#E0F2FE" opacity=".96" filter="url(#glow)"/>
    <ellipse cx="0" cy="-5.5" rx="1.5" ry="2.7" fill="#FFFFFF"/>

    <!-- Twin plasma thrusters -->
    <polygon points="-14,10 -8,10 -11,31" fill="#38BDF8" opacity=".8">
      <animate attributeName="points" values="-14,10 -8,10 -11,26;-14,10 -8,10 -11,34;-14,10 -8,10 -11,26" dur=".18s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".65;1;.65" dur=".18s" repeatCount="indefinite"/>
    </polygon>
    <polygon points="8,10 14,10 11,31" fill="#38BDF8" opacity=".8">
      <animate attributeName="points" values="8,10 14,10 11,26;8,10 14,10 11,34;8,10 14,10 11,26" dur=".18s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".65;1;.65" dur=".18s" repeatCount="indefinite"/>
    </polygon>
    <polygon points="-13,10 -9,10 -11,18" fill="#FFFFFF"><animate attributeName="opacity" values=".7;1;.7" dur=".18s" repeatCount="indefinite"/></polygon>
    <polygon points="9,10 13,10 11,18" fill="#FFFFFF"><animate attributeName="opacity" values=".7;1;.7" dur=".18s" repeatCount="indefinite"/></polygon>
  </g>`;

svg = svg.slice(0, start) + replacement + svg.slice(end);
fs.writeFileSync(file, svg, "utf8");
console.log("Restored dual-hull interceptor while preserving stateful shield telemetry.");

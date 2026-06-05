// Bakes the isometric factory sprites to assets/factory/ as transparent PNGs:
// six player-tinted bases (factory-base-<color>.png) + one colony dome
// (colony-dome.png), rendered at a SHARED canvas + origin so the renderer can
// composite them by drawing both at the same destination rect (base first,
// dome on top when a colony exists). The label ({size}{spectral} | {outpost})
// is NOT baked - it is dynamic and drawn on the canvas at runtime.
//
// Run:  npm i @resvg/resvg-js   (build-time only; not a runtime dep)
//       node scripts/gen-factory-sprites.mjs
// Mirrors the gen-support-icons.mjs pattern: the PNGs are committed; resvg is
// only needed to regenerate them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'factory');
mkdirSync(OUT, { recursive: true });

// ---- colour helpers ----
const hx = (c) => { c = c.replace('#',''); return [parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)]; };
const rh = (a) => '#' + a.map(n => Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0')).join('');
const blend = (a,b,t) => { const A=hx(a),B=hx(b); return rh([A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t,A[2]+(B[2]-A[2])*t]); };
const shade = (c,f) => { const [r,g,b]=hx(c); return rh([r*f,g*f,b*f]); };
const lighten = (c,t) => blend(c,'#ffffff',t);

// ---- isometric projection ----
const C = Math.cos(Math.PI/6), S = Math.sin(Math.PI/6);
const iso = (x,y,z) => [ (x-y)*C, (x+y)*S - z ];
const E = { rx: 1.2247449, ry: 0.7071068 };
function poly(pts3, ox, oy, attrs) {
  const d = pts3.map((p,i) => { const [sx,sy]=iso(...p); return (i?'L':'M')+(ox+sx).toFixed(2)+' '+(oy+sy).toFixed(2); }).join(' ')+' Z';
  return `<path d="${d}" ${attrs}/>`;
}
const wallY = (x0,x1,z0,z1,wy) => [[x0,wy,z0],[x1,wy,z0],[x1,wy,z1],[x0,wy,z1]];
const wallX = (y0,y1,z0,z1,wx) => [[wx,y0,z0],[wx,y1,z0],[wx,y1,z1],[wx,y0,z1]];

const wx = 84, wy = 52, hz = 16, Rpad = 16;
const PAD_CX = wx*0.5, PAD_CY = wy*0.55;   // dome pad: centred, in front of the stacks

function factoryBase(pcol, ox, oy) {
  const steel = '#646b76';
  const body  = blend(steel, pcol, 0.5);
  const top   = lighten(body, 0.16);
  const left  = shade(body, 0.84);
  const right = shade(body, 0.6);
  const k     = '#0b0a14';
  const band  = pcol;
  const glow  = lighten(pcol, 0.5);
  const st = (f, w=1.1) => `fill="${f}" stroke="${k}" stroke-width="${w}" stroke-linejoin="round"`;
  let s = '';
  const [bx,by] = iso(wx*0.5, wy*0.5, 0);
  s += `<ellipse cx="${(ox+bx).toFixed(1)}" cy="${(oy+by+5).toFixed(1)}" rx="74" ry="24" fill="#000" opacity="0.18"/>`;
  s += `<ellipse cx="${(ox+bx).toFixed(1)}" cy="${(oy+by+5).toFixed(1)}" rx="54" ry="16" fill="#000" opacity="0.22"/>`;
  s += poly(wallY(0,wx,0,hz,wy), ox,oy, st(left));
  s += poly(wallX(0,wy,0,hz,wx), ox,oy, st(right));
  s += poly(wallY(0,wx,0,3,wy), ox,oy, `fill="${band}" opacity="0.92"`);
  s += poly(wallX(0,wy,0,3,wx), ox,oy, `fill="${shade(band,0.7)}" opacity="0.92"`);
  s += poly(wallY(wx*0.6,wx*0.84, 3, hz*0.82, wy), ox,oy, st(shade(body,0.5)));
  for (let i=1;i<4;i++){ const z=3+(hz*0.82-3)*i/4; const a=iso(wx*0.6,wy,z),b=iso(wx*0.84,wy,z);
    s += `<line x1="${(ox+a[0]).toFixed(1)}" y1="${(oy+a[1]).toFixed(1)}" x2="${(ox+b[0]).toFixed(1)}" y2="${(oy+b[1]).toFixed(1)}" stroke="${shade(body,0.34)}" stroke-width="1"/>`; }
  for (const yy of [wy*0.16, wy*0.44]) s += poly(wallX(yy,yy+wy*0.16, hz*0.34,hz*0.74, wx), ox,oy, `fill="${glow}" stroke="${k}" stroke-width="0.8" opacity="0.95"`);
  s += poly([[0,0,hz],[wx,0,hz],[wx,wy,hz],[0,wy,hz]], ox,oy, st(top));
  const [pcx,pcy] = iso(PAD_CX, PAD_CY, hz); const px=ox+pcx, py=oy+pcy;
  s += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(Rpad*E.rx).toFixed(1)}" ry="${(Rpad*E.ry).toFixed(1)}" fill="${shade(top,0.74)}" stroke="${band}" stroke-width="2"/>`;
  s += `<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${(Rpad*0.74*E.rx).toFixed(1)}" ry="${(Rpad*0.74*E.ry).toFixed(1)}" fill="${shade(top,0.88)}" stroke="${shade(band,0.8)}" stroke-width="1"/>`;
  for (const a of [0,90,180,270]){ const rad=a*Math.PI/180; const q=iso(PAD_CX+Math.cos(rad)*Rpad*0.86, PAD_CY+Math.sin(rad)*Rpad*0.86, hz);
    s += `<circle cx="${(ox+q[0]).toFixed(1)}" cy="${(oy+q[1]).toFixed(1)}" r="1.6" fill="${shade(band,0.6)}"/>`; }
  const sBody='#5b626e';
  const stacks=[ {x0:15,x1:21,y0:5,y1:11,H:30}, {x0:39,x1:45,y0:4,y1:10,H:38}, {x0:63,x1:69,y0:5,y1:11,H:28} ];
  for (const c of stacks) {
    const sl=shade(sBody,0.84), sr=shade(sBody,0.58), stp=lighten(sBody,0.16);
    s += poly(wallY(c.x0,c.x1, hz, hz+c.H, c.y1), ox,oy, st(sl,0.8));
    s += poly(wallX(c.y0,c.y1, hz, hz+c.H, c.x1), ox,oy, st(sr,0.8));
    s += poly([[c.x0,c.y0,hz+c.H],[c.x1,c.y0,hz+c.H],[c.x1,c.y1,hz+c.H],[c.x0,c.y1,hz+c.H]], ox,oy, st(stp,0.8));
    s += poly(wallY(c.x0,c.x1, hz+c.H-6, hz+c.H-2, c.y1), ox,oy, `fill="${band}"`);
    s += poly(wallX(c.y0,c.y1, hz+c.H-6, hz+c.H-2, c.x1), ox,oy, `fill="${shade(band,0.7)}"`);
    const [mx,my]=iso((c.x0+c.x1)/2,(c.y0+c.y1)/2, hz+c.H);
    for (const [dx,dy,r,o] of [[-3,-8,6,0.13],[-7,-17,9,0.10],[-11,-27,12,0.07]]) s += `<circle cx="${(ox+mx+dx).toFixed(1)}" cy="${(oy+my+dy).toFixed(1)}" r="${r}" fill="#cbd5e1" opacity="${o}"/>`;
  }
  return { svg: s, padX: px, padY: py };
}

function domeOnPad(px, py) {
  const glass='#0e7490', rim='#155e75';
  const baseR = Rpad*0.94;
  const rx=baseR*E.rx, ry=baseR*E.ry, domeH=baseR*1.12;
  const cy = py + 1.5;
  let s='';
  s += `<ellipse cx="${px.toFixed(1)}" cy="${(cy+1).toFixed(1)}" rx="${(rx*1.06).toFixed(1)}" ry="${(ry*1.06).toFixed(1)}" fill="#05151b" opacity="0.5"/>`;
  s += `<defs><radialGradient id="dg" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stop-color="${lighten(glass,0.6)}"/><stop offset="0.5" stop-color="${glass}"/><stop offset="1" stop-color="${rim}"/></radialGradient></defs>`;
  s += `<path d="M ${(px-rx).toFixed(1)} ${cy.toFixed(1)} C ${(px-rx).toFixed(1)} ${(cy-domeH*0.9).toFixed(1)} ${(px-rx*0.34).toFixed(1)} ${(cy-domeH).toFixed(1)} ${px.toFixed(1)} ${(cy-domeH).toFixed(1)} C ${(px+rx*0.34).toFixed(1)} ${(cy-domeH).toFixed(1)} ${(px+rx).toFixed(1)} ${(cy-domeH*0.9).toFixed(1)} ${(px+rx).toFixed(1)} ${cy.toFixed(1)} A ${rx.toFixed(1)} ${ry.toFixed(1)} 0 0 1 ${(px-rx).toFixed(1)} ${cy.toFixed(1)} Z" fill="url(#dg)" stroke="#06222b" stroke-width="1.2"/>`;
  s += `<ellipse cx="${(px-rx*0.3).toFixed(1)}" cy="${(cy-domeH*0.58).toFixed(1)}" rx="3.8" ry="6.5" fill="#ffffff" opacity="0.22"/>`;
  return s;
}

// ---- bake ----
const W = 184, H = 214, OX = 92, OY = 120, SCALE = 2;
const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
const png = (inner) => new Resvg(wrap(inner), { fitTo: { mode: 'width', value: W * SCALE } }).render().asPng();

const COLORS = { gold:'#fccc00', mauve:'#c09cc0', bone:'#e3e0d4', mint:'#a8d8c0', magenta:'#b40054', gray:'#9c9c9c' };
let padX, padY;
for (const [name, pc] of Object.entries(COLORS)) {
  const b = factoryBase(pc, OX, OY);
  padX = b.padX; padY = b.padY;
  writeFileSync(join(OUT, `factory-base-${name}.png`), png(b.svg));
}
writeFileSync(join(OUT, 'colony-dome.png'), png(domeOnPad(padX, padY)));

// review preview: base-only + base+dome (bone), at the bake canvas size
const pv = factoryBase('#e3e0d4', OX, OY);
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="${W*2}" height="${H}" viewBox="0 0 ${W*2} ${H}"><rect width="${W*2}" height="${H}" fill="#0c0a16"/>`
  + `<g>${pv.svg}</g><g transform="translate(${W},0)">${factoryBase('#e3e0d4',OX,OY).svg}${domeOnPad(pv.padX,pv.padY)}</g></svg>`;
writeFileSync(join(OUT, '_preview.png'), new Resvg(preview, { fitTo: { mode: 'width', value: W*2*2 } }).render().asPng());

// anchor fractions for the renderer (where the factory ground-centre sits)
const gc = iso(wx/2, wy/2, 0);
console.log(`baked ${Object.keys(COLORS).length} bases + dome to assets/factory/`);
console.log('renderer constants:');
console.log(`  W=${W} H=${H}`);
console.log(`  ANCHOR_FX=${((OX+gc[0])/W).toFixed(4)} ANCHOR_FY=${((OY+gc[1])/H).toFixed(4)}`);
console.log(`  LABEL_FY=${((OY+gc[1]+10)/H).toFixed(4)}`);

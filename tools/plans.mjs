#!/usr/bin/env node
/**
 * Gera as plantas em SVG e a lista de cômodos, e injeta as duas em index.html.
 *
 *   node tools/plans.mjs
 *
 * Por que um gerador e não SVG escrito à mão: as áreas dos cômodos saem da
 * própria geometria (largura x altura de cada retângulo), então o número que
 * aparece na tela nunca diverge do desenho. O script também confere se a soma
 * dos cômodos bate com a área anunciada e falha se não bater.
 *
 * Unidade dos dados: metros. Origem no canto superior esquerdo, y para baixo.
 * O HTML final é estático: este script só reescreve o que está entre os
 * marcadores <!--plan:ID--> ... <!--/plan:ID--> e <!--rooms:ID--> ... <!--/rooms:ID-->.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plans, fmtArea } from "../data/plans.js";

// Os dados moram em data/plans.js (ESM puro, também lido pelo tour 3D no
// navegador). Reexportados aqui para quem já importava deste arquivo.
export { plans, fmtArea };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(HERE, "..", "index.html");

// Todas as plantas usam o mesmo viewBox, para que espessura de traço e tamanho
// de texto fiquem iguais na tela de uma planta para a outra.
const VB = { w: 1000, h: 640 };
const BOX = { w: 860, h: 500 };

// texto dos dados vira HTML: & e < não podem entrar crus
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtLen = (m) => m.toFixed(2).replace(".", ",") + " m";


/* ---------------------------------------------------------------- desenho -- */
export function build(p) {
  const s = Math.min(BOX.w / p.w, BOX.h / p.h);
  const ox = (VB.w - p.w * s) / 2;
  const oy = (VB.h - p.h * s) / 2 + 16;           // sobra em cima para a cota
  const n = (v) => +v.toFixed(1);
  const X = (x) => n(ox + x * s), Y = (y) => n(oy + y * s);
  const pt = ([x, y]) => `${X(x)} ${Y(y)}`;
  const poly = (pts) => "M" + pts.map(pt).join(" L");
  const draw = (g, cls, d) => `      <path class="draw ${cls}" data-g="${g}" pathLength="1" d="${d}"/>`;

  // áreas saem da geometria
  const rooms = p.rooms.map((r) => ({ ...r, area: r.r.reduce((a, [, , w, h]) => a + w * h, 0) }));
  const total = rooms.reduce((a, r) => a + r.area, 0);
  if (Math.abs(total - p.area) > 0.05) {
    throw new Error(`${p.id}: os cômodos somam ${total.toFixed(2)} m², a planta anuncia ${p.area} m²`);
  }

  const out = [];
  out.push(`    <svg class="plan" viewBox="0 0 ${VB.w} ${VB.h}" role="img" aria-labelledby="plan-${p.id}-t plan-${p.id}-d">`);
  out.push(`      <title id="plan-${p.id}-t">Planta do apartamento ${esc(p.title)}, ${fmtArea(p.area)}</title>`);
  out.push(`      <desc id="plan-${p.id}-d">${esc(p.desc)}</desc>`);

  rooms.forEach((r, i) => r.r.forEach(([x, y, w, h]) =>
    out.push(`      <rect class="room" data-room="${i}" x="${X(x)}" y="${Y(y)}" width="${n(w * s)}" height="${n(h * s)}"/>`)));

  p.fits.forEach(([x, y, w, h]) =>
    out.push(draw("fit", "fit", poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]))));

  p.outer.forEach((pts) => out.push(draw("outer", "wall wall--outer", poly(pts))));
  p.inner.forEach(([a, b, c, d]) => out.push(draw("inner", "wall", poly([[a, b], [c, d]]))));
  p.rail.forEach((pts) => out.push(draw("open", "rail", poly(pts))));
  p.glass.forEach(([a, b, c, d]) => out.push(draw("open", "glass", poly([[a, b], [c, d]]))));

  p.doors.forEach((dr) => {
    const [gx, gy] = dr.at;
    const along = dr.wall === "h" ? [1, 0] : [0, 1];
    const norm = dr.wall === "h" ? [0, dr.side] : [dr.side, 0];
    const H = dr.hinge ? [gx + along[0] * dr.w, gy + along[1] * dr.w] : [gx, gy];
    const dir = dr.hinge ? [-along[0], -along[1]] : along;      // da dobradiça para o outro batente
    const L = [H[0] + norm[0] * dr.w, H[1] + norm[1] * dr.w];   // ponta da folha aberta
    const O = [H[0] + dir[0] * dr.w, H[1] + dir[1] * dr.w];
    // produto vetorial em coordenadas de tela (y para baixo): > 0 é horário
    const cross = norm[0] * dir[1] - norm[1] * dir[0];
    const r = n(dr.w * s);
    out.push(draw("open", "door", `M${pt(H)} L${pt(L)} A${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${pt(O)}`));
  });

  // cotas gerais
  const yd = n(oy - 28), xd = n(ox - 28);
  out.push(draw("dim", "dim", `M${X(0)} ${yd - 6} V${yd + 6} M${X(0)} ${yd} H${X(p.w)} M${X(p.w)} ${yd - 6} V${yd + 6}`));
  out.push(draw("dim", "dim", `M${xd - 6} ${Y(0)} H${xd + 6} M${xd} ${Y(0)} V${Y(p.h)} M${xd - 6} ${Y(p.h)} H${xd + 6}`));
  out.push(`      <text class="dimtext" x="${X(p.w / 2)}" y="${yd - 10}" text-anchor="middle">${fmtLen(p.w)}</text>`);
  const ym = Y(p.h / 2);
  out.push(`      <text class="dimtext" x="${xd - 10}" y="${ym}" text-anchor="middle" transform="rotate(-90 ${xd - 10} ${ym})">${fmtLen(p.h)}</text>`);

  // rótulos dentro da planta (decorativos: a lista em HTML é a versão acessível)
  out.push(`      <g aria-hidden="true">`);
  rooms.forEach((r, i) => {
    const [x, y, w, h] = r.r[0];
    const [cx, cy] = r.at || [x + w / 2, y + h / 2];
    out.push(`        <text class="lbl" data-room="${i}" text-anchor="middle"><tspan class="lbl__n" x="${X(cx)}" y="${n(Y(cy) - 3)}">${esc(r.name)}</tspan><tspan class="lbl__a" x="${X(cx)}" dy="18">${fmtArea(r.area)}</tspan></text>`);
  });
  out.push(`      </g>`);
  out.push(`    </svg>`);

  const list = rooms.map((r, i) =>
    `      <li data-room="${i}"><span>${esc(r.full)}</span> <span class="unit__m2">${fmtArea(r.area)}</span></li>`);

  return { svg: out.join("\n"), list: list.join("\n"), total };
}

/* --------------------------------------------------------------- injeção -- */
// Pura: recebe o HTML, devolve o HTML com plantas e listas regeneradas.
export function inject(html, tag, id, body) {
  const re = new RegExp(`(<!--${tag}:${id}-->)[\\s\\S]*?(<!--/${tag}:${id}-->)`);
  if (!re.test(html)) throw new Error(`marcador <!--${tag}:${id}--> não encontrado em index.html`);
  return html.replace(re, (_, a, b) => `${a}\n${body}\n    ${b}`);
}

export function render(html, list = plans) {
  const lines = [];
  for (const p of list) {
    const { svg, list: items, total } = build(p);
    html = inject(html, "plan", p.id, svg);
    html = inject(html, "rooms", p.id, items);
    lines.push(`${p.id.padEnd(14)} ${p.rooms.length} cômodos  soma ${total.toFixed(2)} m²  anunciado ${p.area} m²`);
  }
  return { html, lines };
}

// Só escreve em index.html quando o arquivo é executado diretamente.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { html, lines } = render(fs.readFileSync(INDEX, "utf8"));
  lines.forEach((l) => console.log(l));
  fs.writeFileSync(INDEX, html);
  console.log("index.html atualizado");
}

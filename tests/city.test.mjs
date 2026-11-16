// A cidade fictícia da vista da varanda (tour/city.js). Módulo puro: roda no Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tower } from "../data/tower.js";
import { buildCity, checkCity, hillHeight, terrainHeight, prng, CITY } from "../tour/city.js";
import { buildSite } from "../tour/tower.js";

const clone = (x) => structuredClone(x);
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); }); return Object.freeze(o); };
const SEEDS = [undefined, 1, 7, 12345, 20260428];
const cities = new Map();
const cityOf = (seed) => {
  if (!cities.has(seed)) cities.set(seed, buildCity(tower, seed === undefined ? {} : { seed }));
  return cities.get(seed);
};
const city = cityOf(undefined);
const [CX, CY] = [tower.slab.w / 2, tower.slab.d / 2];
const dist = (x, y) => Math.hypot(x - CX, y - CY);
const rectDist = (r) => Math.hypot(Math.max(r.x0 - CX, 0, CX - r.x1), Math.max(r.y0 - CY, 0, CY - r.y1));
const cruza = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const finitos = (o, keys) => keys.every((k) => Number.isFinite(o[k]));

/* ---------------------------------------------------------------- sorteio -- */

test("prng: mesma semente, mesma sequência; sempre em [0, 1); sementes diferentes divergem", () => {
  const a = prng(42), b = prng(42), c = prng(43);
  const sa = Array.from({ length: 200 }, a), sb = Array.from({ length: 200 }, b), sc = Array.from({ length: 200 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1, `fora de [0,1): ${v}`);
  assert.ok(new Set(sa).size > 190, "sequência com repetição demais");
  const media = sa.reduce((s, v) => s + v, 0) / sa.length;
  assert.ok(media > 0.4 && media < 0.6, `média ${media}: sorteio enviesado`);
});

/* ----------------------------------------------------------- determinismo -- */

test("buildCity: duas chamadas com a mesma entrada dão exatamente a mesma cidade", () => {
  const a = buildCity(tower), b = buildCity(tower);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(buildCity(tower, { seed: 99 }), buildCity(tower, { seed: 99 }));
});

test("buildCity: sem semente vale CITY.seed; não depende de Math.random", () => {
  assert.equal(city.seed, CITY.seed);
  assert.deepEqual(buildCity(tower, { seed: CITY.seed }), city);
  const real = Math.random;
  Math.random = () => { throw new Error("Math.random não pode ser usado na cidade"); };
  try { assert.deepEqual(buildCity(tower), city); } finally { Math.random = real; }
});

test("buildCity: sementes diferentes dão cidades diferentes (e a semente fica registrada)", () => {
  const a = cityOf(1), b = cityOf(7), c = cityOf(undefined);
  assert.equal(a.seed, 1);
  assert.equal(b.seed, 7);
  for (const [x, y] of [[a, b], [a, c], [b, c]]) {
    assert.notEqual(JSON.stringify(x.boxes), JSON.stringify(y.boxes), "caixas iguais para sementes diferentes");
    assert.notEqual(JSON.stringify(x.lights), JSON.stringify(y.lights), "luzes iguais para sementes diferentes");
  }
  // pelo menos metade das caixas é diferente: não é só uma permutação ou um deslocamento mínimo
  const chave = (bx) => `${bx.x0.toFixed(2)},${bx.y0.toFixed(2)},${bx.z1.toFixed(2)}`;
  const sa = new Set(a.boxes.map(chave));
  const iguais = b.boxes.filter((bx) => sa.has(chave(bx))).length;
  assert.ok(iguais < b.boxes.length / 2, `${iguais} de ${b.boxes.length} caixas iguais entre as sementes 1 e 7`);
});

test("buildCity: não altera a torre recebida e funciona com ela congelada", () => {
  const t = deepFreeze(clone(tower));
  const c = buildCity(t);
  assert.deepEqual(c, city);
});

/* ------------------------------------------------------------- checkCity -- */

test("checkCity: a cidade de verdade volta lista vazia, em várias sementes", () => {
  for (const seed of SEEDS) assert.deepEqual(checkCity(cityOf(seed), tower), [], `semente ${seed}`);
});

test("checkCity: acusa caixa na zona livre, caixa invertida, caixa sobre o entorno e luz inválida", () => {
  const ruim = (mexe) => { const c = clone(city); mexe(c); return checkCity(c, tower); };
  assert.ok(ruim((c) => c.boxes.push({ x0: CX + 20, y0: CY + 20, x1: CX + 40, y1: CY + 40, z0: 0, z1: 10, kind: "casa", tone: 0.5 })).some((m) => /zona livre/.test(m)), "caixa na zona livre");
  assert.ok(ruim((c) => c.boxes.push({ x0: CX + 300, y0: CY + 300, x1: CX + 290, y1: CY + 310, z0: 0, z1: 10, kind: "casa", tone: 0.5 })).some((m) => /invertida|vazia/.test(m)), "caixa invertida");
  assert.ok(ruim((c) => c.boxes.push({ x0: CX + 300, y0: CY + 300, x1: CX + 310, y1: CY + 310, z0: 5, z1: 5, kind: "casa", tone: 0.5 })).some((m) => /invertida|vazia/.test(m)), "caixa sem altura");
  assert.ok(ruim((c) => c.lights.push({ x: NaN, y: 400, z: 3, kind: "poste" })).some((m) => /luz inválida/.test(m)), "luz NaN");
  assert.ok(ruim((c) => c.lights.push({ x: Infinity, y: 400, z: 3, kind: "poste" })).some((m) => /luz inválida/.test(m)), "luz infinita");
  assert.ok(ruim((c) => c.lights.push({ x: CX + 10, y: CY, z: 3, kind: "poste" })).some((m) => /zona livre/.test(m)), "luz na zona livre");
  assert.ok(ruim((c) => c.trees.push({ x: CX + 5, y: CY + 5, h: 8, r: 3 })).some((m) => /zona livre/.test(m)), "árvore na zona livre");
  const pad = buildSite(tower).neighbors[0];
  assert.ok(ruim((c) => c.boxes.push({ ...pad, kind: "casa", tone: 0.5 })).length > 0, "caixa em cima de um vizinho");
});

test("checkCity: acusa estouro do orçamento de caixas e de luzes", () => {
  const c = clone(city);
  const molde = c.boxes[0];
  while (c.boxes.length <= CITY.maxBoxes) c.boxes.push({ ...molde });
  assert.ok(checkCity(c, tower).some((m) => /caixas demais/.test(m)));
  const d = clone(city);
  while (d.lights.length <= CITY.maxLights) d.lights.push({ ...d.lights[0] });
  assert.ok(checkCity(d, tower).some((m) => /luzes demais/.test(m)));
});

/* ------------------------------------------------------------ zona livre -- */

test("zona livre: 150 m em volta da torre, sem caixa, luz, árvore ou rua dentro dela", () => {
  assert.equal(CITY.free, 150);
  assert.equal(city.free, 150);
  assert.deepEqual(city.center, { x: CX, y: CY });
  for (const seed of SEEDS) {
    const c = cityOf(seed);
    for (const b of c.boxes) assert.ok(rectDist(b) >= 150 - 1e-6, `semente ${seed}: caixa a ${rectDist(b).toFixed(1)} m: ${JSON.stringify(b)}`);
    for (const l of c.lights) assert.ok(dist(l.x, l.y) >= 150 - 1e-6, `semente ${seed}: luz ${l.kind} a ${dist(l.x, l.y).toFixed(1)} m`);
    for (const t of c.trees) assert.ok(dist(t.x, t.y) >= 150, `semente ${seed}: árvore a ${dist(t.x, t.y).toFixed(1)} m`);
    for (const s of c.streets) for (let k = 0; k <= 20; k++) {
      const x = s.x0 + ((s.x1 - s.x0) * k) / 20, y = s.y0 + ((s.y1 - s.y0) * k) / 20;
      assert.ok(dist(x, y) >= 150, `semente ${seed}: rua ${s.kind} passa a ${dist(x, y).toFixed(1)} m da torre`);
    }
  }
});

test("zona livre: a cidade existe logo depois dela (não ficou um vazio maior que o combinado)", () => {
  const perto = city.boxes.filter((b) => rectDist(b) < 330);
  assert.ok(perto.length > 100, `só ${perto.length} caixas entre 150 e 330 m`);
  const noMeio = city.boxes.filter((b) => rectDist(b) >= 330 && rectDist(b) < 1200);
  assert.ok(noMeio.length > 1000, `só ${noMeio.length} caixas entre 330 m e 1,2 km`);
  const lado = (f) => city.boxes.some((b) => f(b) && rectDist(b) < 330);
  assert.ok(lado((b) => b.x1 < CX) && lado((b) => b.x0 > CX) && lado((b) => b.y1 < CY) && lado((b) => b.y0 > CY), "falta cidade em algum lado da torre");
});

/* ---------------------------------------------------------------- valores -- */

test("nada NaN nem infinito em nenhuma lista da cidade", () => {
  for (const seed of SEEDS) {
    const c = cityOf(seed);
    c.boxes.forEach((b, i) => assert.ok(finitos(b, ["x0", "x1", "y0", "y1", "z0", "z1", "tone"]), `semente ${seed}: caixa ${i}: ${JSON.stringify(b)}`));
    [...c.lights, ...c.siteLights].forEach((l, i) => assert.ok(finitos(l, ["x", "y", "z"]), `semente ${seed}: luz ${i}: ${JSON.stringify(l)}`));
    c.hills.forEach((h, i) => assert.ok(finitos(h, ["x", "y", "rx", "ry", "h"]), `semente ${seed}: morro ${i}`));
    c.trees.forEach((t, i) => assert.ok(finitos(t, ["x", "y", "h", "r"]), `semente ${seed}: árvore ${i}`));
    c.streets.forEach((s, i) => assert.ok(finitos(s, ["x0", "y0", "x1", "y1", "w"]), `semente ${seed}: rua ${i}`));
    for (const e of [...c.parks, ...c.water]) assert.ok(finitos(e, ["x", "y", "rx", "ry"]));
    for (const e of c.cores) assert.ok(finitos(e, ["x", "y", "r", "h"]));
    assert.ok(Number.isFinite(c.radius) && c.radius > 0);
  }
});

test("caixas bem formadas: x0<x1, y0<y1, z0>=0, z0<z1, tipo conhecido, tom em [0, 1]", () => {
  const tipos = new Set(["casa", "predio", "torre", "bloco"]);
  for (const seed of SEEDS) for (const b of cityOf(seed).boxes) {
    assert.ok(b.x0 < b.x1 && b.y0 < b.y1, `semente ${seed}: base vazia ou invertida ${JSON.stringify(b)}`);
    assert.ok(b.z0 >= 0, `semente ${seed}: caixa abaixo do chão ${JSON.stringify(b)}`);
    assert.ok(b.z0 < b.z1, `semente ${seed}: altura nula ou negativa ${JSON.stringify(b)}`);
    assert.ok(tipos.has(b.kind), `tipo ${b.kind}`);
    assert.ok(b.tone >= 0 && b.tone <= 1, `tom ${b.tone}`);
    assert.equal("zone" in b, false, "campo interno 'zone' vazou para a cidade");
  }
});

test("caixas: alturas plausíveis por tipo (casa baixa, torre alta) e coroamentos apoiados em outra caixa", () => {
  const base = city.boxes.filter((b) => !b.crown);
  for (const b of base) {
    if (b.kind === "casa") assert.ok(b.z1 < 9.6, `casa de ${b.z1.toFixed(1)} m`);
    if (b.kind === "torre") assert.ok(b.z1 >= 44.9, `torre de ${b.z1.toFixed(1)} m`);
    assert.ok(b.z1 < 260, `caixa de ${b.z1.toFixed(0)} m de altura`);
  }
  const kinds = new Set(base.map((b) => b.kind));
  assert.deepEqual([...kinds].sort(), ["bloco", "casa", "predio", "torre"]);
  const coroas = city.boxes.filter((b) => b.crown);
  assert.ok(coroas.length > 0, "nenhum coroamento: o skyline ficou só de caixas retas");
  for (const k of coroas) {
    assert.ok(k.z0 > 0);
    const sob = base.find((b) => Math.abs(b.z1 - k.z0) < 1e-9 && k.x0 >= b.x0 && k.x1 <= b.x1 && k.y0 >= b.y0 && k.y1 <= b.y1);
    assert.ok(sob, `coroamento flutuando: ${JSON.stringify(k)}`);
  }
});

test("caixas da malha (até 1,2 km) não se sobrepõem entre si", () => {
  for (const seed of SEEDS) {
    const l = cityOf(seed).boxes.filter((b) => !b.crown && rectDist(b) < CITY.mid).sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length && l[j].x0 < l[i].x1; j++) {
      assert.ok(!cruza(l[i], l[j]), `semente ${seed}: ${JSON.stringify(l[i])} e ${JSON.stringify(l[j])} se sobrepõem`);
    }
  }
});

test("luzes: acima do terreno (nenhuma enterrada num morro)", () => {
  for (const seed of SEEDS) for (const l of cityOf(seed).lights) {
    const g = terrainHeight(cityOf(seed), l.x, l.y);
    assert.ok(l.z >= g - 1e-9, `semente ${seed}: luz ${l.kind} enterrada: z ${l.z.toFixed(1)}, terreno ${g.toFixed(1)} em (${l.x.toFixed(0)}, ${l.y.toFixed(0)})`);
  }
});

test("luzes: tipos conhecidos, altura plausível e as três famílias presentes", () => {
  const tipos = new Set(["janela", "poste", "longe"]);
  for (const seed of SEEDS) for (const l of cityOf(seed).lights) {
    assert.ok(tipos.has(l.kind), `tipo ${l.kind}`);
    assert.ok(l.z >= 0);
    // poste e luz de longe ficam a poucos metros do chão; janela, no máximo no alto da torre mais alta
    if (l.kind === "janela") assert.ok(l.z < 200, `janela a ${l.z} m de altura`);
    else assert.ok(l.z <= terrainHeight(cityOf(seed), l.x, l.y) + 10, `${l.kind} a ${l.z} m, longe demais do chão`);
  }
  const por = (k) => city.lights.filter((l) => l.kind === k).length;
  assert.ok(por("janela") > 1000 && por("poste") > 500 && por("longe") > 500, `janela ${por("janela")}, poste ${por("poste")}, longe ${por("longe")}`);
});

test("luzes da malha (até 1,2 km) não ficam dentro de caixa alguma", () => {
  const caixas = city.boxes.filter((b) => !b.crown);
  const dentro = (l) => caixas.some((b) => l.x > b.x0 && l.x < b.x1 && l.y > b.y0 && l.y < b.y1 && l.z > b.z0 && l.z < b.z1);
  const perto = city.lights.filter((l) => dist(l.x, l.y) < CITY.mid);
  assert.ok(perto.length > 1000);
  for (const l of perto) assert.ok(!dentro(l), `luz ${l.kind} dentro de um prédio: ${JSON.stringify(l)}`);
});

test("luzes de janela de longe não ficam dentro de outra caixa", () => {
  const caixas = city.boxes.filter((b) => !b.crown);
  const dentro = (l) => caixas.some((b) => l.x > b.x0 && l.x < b.x1 && l.y > b.y0 && l.y < b.y1 && l.z > b.z0 && l.z < b.z1);
  const presas = city.lights.filter((l) => l.kind === "janela" && dentro(l));
  assert.equal(presas.length, 0, `${presas.length} janelas dentro de prédios; primeira: ${JSON.stringify(presas[0])}`);
});

test("siteLights: janelas acesas nos vizinhos da torre, perto da parede de cada um", () => {
  const vizinhos = buildSite(tower).neighbors;
  assert.ok(city.siteLights.length > 0, "nenhuma janela acesa nos vizinhos");
  for (const l of city.siteLights) {
    assert.equal(l.kind, "janela");
    const colado = vizinhos.some((b) => {
      const dx = Math.max(b.x0 - l.x, 0, l.x - b.x1), dy = Math.max(b.y0 - l.y, 0, l.y - b.y1);
      return Math.hypot(dx, dy) <= 1 && l.z > b.z0 && l.z < b.z1;
    });
    assert.ok(colado, `janela solta no ar: ${JSON.stringify(l)}`);
  }
});

/* -------------------------------------------------------------- orçamento -- */

test("orçamento: até 5.000 caixas e 20.000 luzes, em várias sementes, sem esvaziar a cidade", () => {
  assert.equal(CITY.maxBoxes, 5000);
  assert.equal(CITY.maxLights, 20000);
  for (const seed of SEEDS) {
    const c = cityOf(seed);
    assert.ok(c.boxes.length <= 5000, `semente ${seed}: ${c.boxes.length} caixas`);
    assert.ok(c.lights.length <= 20000, `semente ${seed}: ${c.lights.length} luzes`);
    assert.ok(c.boxes.length > 3000, `semente ${seed}: só ${c.boxes.length} caixas`);
    assert.ok(c.lights.length > 10000, `semente ${seed}: só ${c.lights.length} luzes`);
  }
});

test("orçamento: quando as luzes passam do limite, o corte tira janelas e preserva postes e luzes de longe", () => {
  // a semente 1 estoura o limite antes do corte: cai exatamente em 20.000
  const c = cityOf(1);
  assert.equal(c.lights.length, 20000);
  const m = cityOf(undefined);
  const postes = (x) => x.lights.filter((l) => l.kind === "poste").length;
  assert.ok(postes(c) > 500 && postes(m) > 500);
});

test("buildCity roda em tempo razoável (a página monta a cidade na primeira vista)", () => {
  const t0 = performance.now();
  buildCity(tower, { seed: 3 });
  assert.ok(performance.now() - t0 < 500, `${(performance.now() - t0).toFixed(0)} ms para montar a cidade (o limite é 500 ms)`);
});

test("pureza: tour/city.js e tour/tower.js não importam three.js nem nada de node:", async () => {
  const fs = await import("node:fs");
  for (const f of ["city.js", "tower.js"]) {
    const src = fs.readFileSync(new URL(`../tour/${f}`, import.meta.url), "utf8");
    const specs = [...src.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const s of specs) {
      assert.ok(!/^three(\/|$)/.test(s), `tour/${f} importa "${s}"`);
      assert.ok(!s.startsWith("node:"), `tour/${f} importa "${s}"`);
      assert.match(s, /^\.\/(tower|sun)\.js$/, `tour/${f}: import inesperado "${s}" (só módulos puros vizinhos)`);
    }
    assert.doesNotMatch(src, /\brequire\s*\(/, `tour/${f} usa require`);
  }
});

/* ------------------------------------------------------ nada sobre a torre -- */

test("nenhuma caixa sobre a torre, a praça, a rua, as calçadas ou os vizinhos de buildSite", () => {
  const site = buildSite(tower);
  const torre = { x0: 0, y0: 0, x1: tower.slab.w, y1: tower.slab.d };
  const ocupado = [torre, ...site.pads, ...site.neighbors];
  for (const seed of SEEDS) for (const b of cityOf(seed).boxes) {
    for (const o of ocupado) assert.ok(!cruza(b, o), `semente ${seed}: ${JSON.stringify(b)} pisa em ${JSON.stringify(o)}`);
  }
  for (const t of city.trees) for (const o of [torre, ...site.neighbors]) {
    assert.ok(!(t.x > o.x0 && t.x < o.x1 && t.y > o.y0 && t.y < o.y1), `árvore ${JSON.stringify(t)} dentro de ${JSON.stringify(o)}`);
  }
});

test("as árvores da cidade não nascem dentro de caixas nem no lago", () => {
  const l = city.water[0];
  for (const t of city.trees) {
    assert.ok(!city.boxes.some((b) => t.x > b.x0 && t.x < b.x1 && t.y > b.y0 && t.y < b.y1), `árvore dentro de prédio: ${JSON.stringify(t)}`);
    assert.ok(((t.x - l.x) / l.rx) ** 2 + ((t.y - l.y) / l.ry) ** 2 >= 1, `árvore dentro do lago: ${JSON.stringify(t)}`);
  }
});

/* ------------------------------------------------------- terreno e morros -- */

test("hillHeight: topo = h no centro, 0 na borda e fora, sem subir ao se afastar, nunca negativa", () => {
  const h = { x: 100, y: -50, rx: 400, ry: 200, h: 300 };
  assert.equal(hillHeight(h, 100, -50), 300);
  assert.equal(hillHeight(h, 500, -50), 0, "na borda do eixo x");
  assert.equal(hillHeight(h, 100, 150), 0, "na borda do eixo y");
  assert.equal(hillHeight(h, 9999, 9999), 0);
  assert.equal(hillHeight(h, -9999, -9999), 0);
  let ant = Infinity;
  for (let r = 0; r <= 450; r += 10) {
    const z = hillHeight(h, 100 + r, -50);
    assert.ok(z >= 0 && z <= 300 + 1e-9, `z ${z} a ${r} m`);
    assert.ok(z <= ant + 1e-9, `subiu ao se afastar: ${z} depois de ${ant}`);
    ant = z;
  }
  // a elipse é mais estreita em y: na mesma distância o morro cai mais rápido
  assert.ok(hillHeight(h, 100, -50 + 100) < hillHeight(h, 100 + 100, -50));
  // e é simétrica
  assert.ok(Math.abs(hillHeight(h, 100 + 123, -50) - hillHeight(h, 100 - 123, -50)) < 1e-9);
});

test("terrainHeight: o morro mais alto que passa no ponto; planície vale 0; sem morros vale 0", () => {
  const a = { x: 0, y: 0, rx: 100, ry: 100, h: 50 }, b = { x: 20, y: 0, rx: 100, ry: 100, h: 80 };
  const t = { hills: [a, b] };
  assert.equal(terrainHeight({ hills: [] }, 5, 5), 0);
  assert.equal(terrainHeight(t, 20, 0), Math.max(hillHeight(a, 20, 0), 80));
  assert.equal(terrainHeight(t, 20, 0), 80);
  for (const [x, y] of [[0, 0], [10, 10], [-60, 20], [60, 5]]) assert.equal(terrainHeight(t, x, y), Math.max(hillHeight(a, x, y), hillHeight(b, x, y)));
  assert.equal(terrainHeight(t, 1000, 1000), 0);
});

test("terreno da cidade: plano em volta da torre, com a serra à frente e morros que chegam a centenas de metros", () => {
  for (let r = 0; r <= 1300; r += 50) for (let a = 0; a < 360; a += 30) {
    const x = CX + r * Math.cos((a * Math.PI) / 180), y = CY + r * Math.sin((a * Math.PI) / 180);
    assert.equal(terrainHeight(city, x, y), 0, `terreno não plano a ${r} m (${a}°)`);
  }
  const serra = city.hills.filter((h) => h.range === "serra");
  assert.ok(serra.length >= 15);
  assert.ok(serra.every((h) => h.y < CY - 500 && dist(h.x, h.y) > 3000), "a serra devia ficar na frente (y < 0) e longe");
  assert.ok(Math.max(...serra.map((h) => h.h)) > 400, "serra baixa demais para ser horizonte");
  for (const h of city.hills) {
    assert.ok(h.h > 0 && h.rx > 0 && h.ry > 0);
    assert.ok(["serra", "morro"].includes(h.range));
    assert.ok(Math.hypot(h.x - CX, h.y - CY) - Math.max(h.rx, h.ry) > CITY.free, "morro invade a zona livre");
  }
});

test("nenhuma caixa se sobrepõe a outra, blocos de longe incluídos", () => {
  const l = city.boxes.filter((b) => !b.crown).sort((a, b) => a.x0 - b.x0);
  const pares = [];
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length && l[j].x0 < l[i].x1; j++) if (cruza(l[i], l[j])) pares.push([l[i], l[j]]);
  assert.equal(pares.length, 0, `${pares.length} pares de caixas se sobrepõem; primeiro: ${JSON.stringify(pares[0])}`);
});

test("caixas ficam na planície ou em morro baixo, nunca enterradas numa serra", () => {
  for (const b of city.boxes) {
    const z = terrainHeight(city, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    assert.ok(z <= 3 + 1e-9, `caixa sobre terreno de ${z.toFixed(1)} m: ${JSON.stringify(b)}`);
  }
});

/* ------------------------------------------------------- forma da cidade -- */

test("ruas: tipos conhecidos, largura positiva, existe avenida e estrada", () => {
  const tipos = new Set(city.streets.map((s) => s.kind));
  assert.deepEqual([...tipos].sort(), ["avenida", "estrada", "rua"]);
  for (const s of city.streets) {
    assert.ok(s.w > 0, `rua sem largura ${JSON.stringify(s)}`);
    assert.ok(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 0, `rua de comprimento zero ${JSON.stringify(s)}`);
  }
});

test("caráter: parque e lago na frente; o centro com as torres mais altas nos fundos", () => {
  assert.ok(city.parks.length >= 1 && city.water.length >= 1);
  for (const p of [...city.parks, ...city.water]) assert.ok(p.y < CY, "parque e lago ficam à frente da torre");
  const altas = city.boxes.filter((b) => !b.crown && b.z1 >= 60);
  assert.ok(altas.length > 20, `só ${altas.length} torres de 60 m ou mais`);
  const atras = altas.filter((b) => (b.y0 + b.y1) / 2 > CY).length;
  assert.ok(atras > altas.length * 0.8, `${atras} de ${altas.length} torres altas nos fundos`);
  const maisAlta = city.boxes.reduce((m, b) => (b.z1 > m.z1 ? b : m));
  assert.ok((maisAlta.y0 + maisAlta.y1) / 2 > CY, "a caixa mais alta devia estar nos fundos");
  for (const c of city.cores) assert.ok(c.y > CY, "aglomerado de torres na frente");
});

/* ------------------------------------------------- entradas incomuns -- */

test("buildCity: sementes extremas (0, negativa, enorme, fracionária) dão cidade válida e repetível", () => {
  for (const seed of [0, -5, 2 ** 32 + 3, 1.5]) {
    const a = buildCity(tower, { seed });
    assert.deepEqual(checkCity(a, tower), [], `semente ${seed}`);
    assert.deepEqual(buildCity(tower, { seed }), a, `semente ${seed} não repete`);
    assert.ok(a.boxes.length > 3000, `semente ${seed}: ${a.boxes.length} caixas`);
    assert.ok(a.boxes.every((b) => finitos(b, ["x0", "x1", "y0", "y1", "z0", "z1"])), `semente ${seed}: caixa com NaN`);
  }
});

test("buildCity: sem a torre falha com erro, não devolve cidade vazia calada", () => {
  assert.throws(() => buildCity(undefined));
  assert.throws(() => buildCity({}));
});

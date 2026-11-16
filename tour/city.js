/**
 * A cidade em volta da torre, para a "vista da varanda" do espelho de vendas.
 *
 * CIDADE FICTÍCIA. Nada aqui representa um lugar real: é um cenário sorteado
 * por um gerador com semente fixa, sempre igual a cada carga (nada de
 * Math.random). Serve para dar altura e horizonte à vista de cada andar.
 *
 * Módulo puro, como tour/tower.js: não importa three.js nem nada de "node:".
 * Quem desenha é tour/vista.js.
 *
 * Sistema de coordenadas: o da laje (ver tour/tower.js). x para a direita, y
 * para baixo, z = altura; a frente da torre é o lado de y = 0. Toda caixa é
 * { x0, y0, x1, y1, z0, z1 }.
 *
 * O desenho da cidade, em anéis em volta do centro da laje:
 *   zona livre  até 150 m: nada daqui. Ali vale o entorno de buildSite (praça,
 *               rua, vizinhos, árvores), que a cidade também não pisa.
 *   perto       até 300 m: casas e prédios baixos. Os andares baixos da torre
 *               enxergam vizinhos; os altos olham por cima.
 *   meio        até 1,2 km, numa malha de ruas até 1,3 km: densidade mista.
 *   longe       até 4 km: blocos simplificados, um por conjunto de quadras.
 *   horizonte   morros de 2 a 7 km.
 * A frente e os fundos têm caráter diferente:
 *   frente (y < 0)  um parque com lago, bairro de casas e a serra ao fundo;
 *   fundos (y > 0)  o centro: dois aglomerados de torres que fazem o skyline.
 */
import { buildSite } from "./tower.js";

export const CITY = Object.freeze({
  seed: 20260427,
  free: 150,          // raio da zona livre em volta do centro da torre
  near: 300,          // fim do anel de perto
  mid: 1200,          // fim do anel do meio
  grid: 1300,         // meia largura da malha de ruas
  far: 4000,          // fim dos blocos de longe
  floor: 3.1,         // passo das fiadas de janelas (o desenho usa o mesmo)
  bay: 2.6,           // passo das janelas ao longo da fachada
  maxBoxes: 5000,
  maxLights: 20000,
});

/* Lugares fixos, em metros a partir do centro da laje (dx para a direita, dy para os fundos). */
const PARK = { x: -60, y: -560, rx: 330, ry: 230 };
const LAKE = { x: 30, y: -600, rx: 120, ry: 62 };
const CORES = [
  { x: 280, y: 760, r: 300, h: 150 },      // o centro, a sul-sudeste
  { x: -540, y: 930, r: 210, h: 105 },     // um segundo aglomerado, a sudoeste
];
const SUBCENTER = { x: 1700, y: 2300, r: 430 };
const AVENUE_X = 2;                          // índice da avenida norte-sul entre as ruas a leste da torre

/* ------------------------------------------------------------- sorteio -- */

/** Gerador determinístico (mulberry32): mesma semente, mesma cidade. */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Ruído de valor, suave, de 0 a 1. */
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash2(ix, iy, seed), hash2(ix + 1, iy, seed), sx),
    lerp(hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed), sx), sy);
}

/* ------------------------------------------------------------ geometria -- */

const inEllipse = (e, x, y, grow = 0) => ((x - e.x) / (e.rx + grow)) ** 2 + ((y - e.y) / (e.ry + grow)) ** 2 < 1;
/** Distância de um ponto a um retângulo (0 se estiver dentro). */
const rectDist = (px, py, r) => Math.hypot(Math.max(r.x0 - px, 0, px - r.x1), Math.max(r.y0 - py, 0, py - r.y1));
const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

/**
 * Índice espacial de caixas, numa grade: responde "alguma caixa cruza esta?"
 * e "este ponto está dentro de alguma caixa?" sem comparar todas com todas.
 * Caixas com número inválido ficam de fora (checkCity as acusa por outro lado).
 */
function boxIndex(cell = 128) {
  const map = new Map();
  const valid = (b) => [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite);
  const each = (x0, y0, x1, y1, fn) => {
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
      const hit = fn(i * 100003 + j);
      if (hit) return hit;
    }
    return null;
  };
  return {
    add(b) {
      if (!valid(b)) return;
      each(b.x0, b.y0, b.x1, b.y1, (k) => { const l = map.get(k); if (l) l.push(b); else map.set(k, [b]); });
    },
    /** A primeira caixa do índice que cruza b (com folga pad), ou null. */
    hits(b, pad = 0) {
      if (!valid(b)) return null;
      return each(b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad, (k) => (map.get(k) || []).find((o) => o !== b && overlaps(b, o, pad)) || null);
    },
    /** A caixa que contém o ponto (estritamente dentro), ou null. */
    at(x, y, z) {
      const l = map.get(Math.floor(x / cell) * 100003 + Math.floor(y / cell));
      return (l && l.find((b) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1 && z > b.z0 && z < b.z1)) || null;
    },
  };
}

/** O terreno mais alto sob uma caixa: no centro e nos quatro cantos. */
function terrainUnder(city, b) {
  let z = terrainHeight(city, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) z = Math.max(z, terrainHeight(city, x, y));
  return z;
}

/** Até quanto de terreno uma caixa aceita por baixo: acima disso ela ficaria enterrada na encosta. */
const MAX_SLOPE = 3;

/**
 * Altura de um morro num ponto. O morro é uma calota suave sobre uma elipse:
 * h · (1 - u)², com u = (dx/rx)² + (dy/ry)². tour/vista.js desenha a mesma
 * conta, então as luzes postas na encosta ficam em cima do morro.
 */
export function hillHeight(hill, x, y) {
  const u = ((x - hill.x) / hill.rx) ** 2 + ((y - hill.y) / hill.ry) ** 2;
  return u >= 1 ? 0 : hill.h * (1 - u) ** 2;
}

/** Altura do terreno num ponto: o morro mais alto que passa ali (0 na planície). */
export function terrainHeight(city, x, y) {
  let z = 0;
  for (const h of city.hills) z = Math.max(z, hillHeight(h, x, y));
  return z;
}

/* --------------------------------------------------------------- cidade -- */

/**
 * @param {object} tower  data/tower.js
 * @param {{ seed?: number }} [opts]
 * @returns {{
 *   seed: number, center: { x, y }, free: number, radius: number,
 *   boxes:   { x0, y0, x1, y1, z0, z1, kind, tone }[]   kind: "casa" | "predio" | "torre" | "bloco"; tone de 0 a 1
 *   lights:  { x, y, z, kind }[]                        kind: "janela" | "poste" | "longe"
 *   siteLights: { x, y, z, kind }[]                     janelas acesas nos vizinhos de buildSite (ver abaixo)
 *   hills:   { x, y, rx, ry, h, range }[]               range: "serra" | "morro"
 *   trees:   { x, y, h, r }[]
 *   streets: { x0, y0, x1, y1, w, kind }[]              eixo da via; kind: "rua" | "avenida" | "estrada"
 *   parks:   { x, y, rx, ry }[],  water: { x, y, rx, ry }[]
 *   cores:   { x, y, r, h }[]                           os aglomerados de torres
 * }}
 */
export function buildCity(tower, opts = {}) {
  const seed = opts.seed ?? CITY.seed;
  const rng = prng(seed);
  const between = (a, b) => a + (b - a) * rng();
  const cx = tower.slab.w / 2, cy = tower.slab.d / 2;
  const abs = (e) => ({ ...e, x: e.x + cx, y: e.y + cy });
  const park = abs(PARK), lake = abs(LAKE), cores = CORES.map(abs), sub = abs(SUBCENTER);

  // o que buildSite já pôs em volta da torre: a cidade não pisa em nada disso
  const site = buildSite(tower);
  const taken = [...site.pads, ...site.neighbors, ...site.trees.map((t) => ({ x0: t.x - t.r, y0: t.y - t.r, x1: t.x + t.r, y1: t.y + t.r }))];
  const street = site.pads.find((p) => p.part === "rua");
  const walks = site.pads.filter((p) => p.part === "calcada");
  // a rua da frente da torre vira a avenida leste-oeste da cidade
  const aveY = { c: (street.y0 + street.y1) / 2, w: street.y1 - street.y0, y0: Math.min(...walks.map((p) => p.y0)), y1: Math.max(...walks.map((p) => p.y1)) };
  const siteX0 = Math.min(...site.pads.map((p) => p.x0)), siteX1 = Math.max(...site.pads.map((p) => p.x1));

  const freeOf = (r) => rectDist(cx, cy, r) >= CITY.free && !taken.some((t) => overlaps(r, t, 1));
  const freePoint = (x, y, pad = 0) => Math.hypot(x - cx, y - cy) >= CITY.free + pad && !taken.some((t) => x > t.x0 - 2 && x < t.x1 + 2 && y > t.y0 - 2 && y < t.y1 + 2);

  /* ----------------------------------------------------------- morros -- */
  const hills = [];
  const polar = (az, dist) => [cx + Math.sin(az) * dist, cy - Math.cos(az) * dist];   // az = 0 é a frente
  const RAD = Math.PI / 180;
  // a serra, na frente: um arco de morros altos e sobrepostos
  for (let i = 0; i < 15; i++) {
    const [x, y] = polar((lerp(-82, 82, i / 14) + between(-4, 4)) * RAD, between(5300, 6500));
    hills.push({ x, y, rx: between(1200, 2100), ry: between(900, 1500), h: between(420, 760), range: "serra" });
  }
  // contrafortes da serra, mais baixos e mais perto
  for (let i = 0; i < 9; i++) {
    const [x, y] = polar((lerp(-70, 70, i / 8) + between(-6, 6)) * RAD, between(4100, 4700));
    hills.push({ x, y, rx: between(650, 1050), ry: between(520, 800), h: between(150, 290), range: "serra" });
  }
  // morros baixos fechando o vale nos fundos e nos lados
  for (let i = 0; i < 12; i++) {
    const [x, y] = polar((lerp(98, 262, i / 11) + between(-5, 5)) * RAD, between(5200, 7000));
    hills.push({ x, y, rx: between(1000, 1800), ry: between(800, 1300), h: between(130, 300), range: "morro" });
  }
  // morros soltos dentro da cidade, com casas subindo a encosta
  for (const [dx, dy, rx, ry, h] of [[2500, -1000, 640, 520, 150], [-2750, 420, 720, 560, 175], [-1900, -2300, 600, 520, 140], [3100, 1500, 700, 600, 160], [-2300, 2800, 780, 620, 150]]) {
    hills.push({ x: cx + dx, y: cy + dy, rx, ry, h, range: "morro" });
  }
  const ground = (x, y) => terrainHeight({ hills }, x, y);

  /* ------------------------------------------------------ malha de ruas -- */
  // Linhas de rua nos dois sentidos, com passo irregular. As primeiras passam
  // logo fora da zona livre e do trecho de rua que buildSite já desenha.
  const G = CITY.grid;
  function gridLines(inner, lo, hi) {
    const out = inner.map((c) => ({ c, w: 10 }));
    for (let c = inner[inner.length - 1]; ;) { c += between(74, 118); if (c > hi) break; out.push({ c, w: 10 }); }
    for (let c = inner[0]; ;) { c -= between(74, 118); if (c < lo) break; out.unshift({ c, w: 10 }); }
    return out;
  }
  const edge = CITY.free + 6;
  const xs = gridLines([Math.min(cx - edge, siteX0 - 6), Math.max(cx + edge, siteX1 + 6)], cx - G, cx + G);
  const ys = gridLines([cy - edge, cy + edge], cy - G, cy + G);
  // a avenida da frente entra na malha no lugar certo
  ys.push({ c: aveY.c, w: aveY.y1 - aveY.y0, avenue: true });
  ys.sort((a, b) => a.c - b.c);
  // a avenida norte-sul, que desce para o centro
  const east = xs.findIndex((l) => l.c > cx);
  const aveX = xs[Math.min(xs.length - 1, east + AVENUE_X)];
  aveX.w = 16; aveX.avenue = true;

  const streets = [];
  const blockedStreet = (x0, y0, x1, y1) => {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    for (const [x, y] of [[x0, y0], [mx, my], [x1, y1]]) {
      if (Math.hypot(x - cx, y - cy) < CITY.free + 5) return true;
      if (inEllipse(park, x, y, -8)) return true;
    }
    return taken.some((t) => overlaps({ x0: Math.min(x0, x1) - 5, y0: Math.min(y0, y1) - 5, x1: Math.max(x0, x1) + 5, y1: Math.max(y0, y1) + 5 }, t));
  };
  const addStreet = (x0, y0, x1, y1, w, kind) => { if (!blockedStreet(x0, y0, x1, y1)) streets.push({ x0, y0, x1, y1, w, kind }); };
  for (const lx of xs) for (let j = 0; j + 1 < ys.length; j++) addStreet(lx.c, ys[j].c, lx.c, ys[j + 1].c, lx.w, lx.avenue ? "avenida" : "rua");
  for (const ly of ys) for (let i = 0; i + 1 < xs.length; i++) addStreet(xs[i].c, ly.c, xs[i + 1].c, ly.c, ly.avenue ? street.y1 - street.y0 : ly.w, ly.avenue ? "avenida" : "rua");
  // fora da malha, as duas avenidas seguem como estradas até o pé dos morros
  const x0g = xs[0].c, x1g = xs[xs.length - 1].c, y0g = ys[0].c, y1g = ys[ys.length - 1].c;
  const roads = [];                              // para os blocos de longe desviarem
  for (const [ax, ay, dx, dy] of [[x0g, aveY.c, -1, 0], [x1g, aveY.c, 1, 0], [aveX.c, y0g, 0, -1], [aveX.c, y1g, 0, 1]]) {
    const len = CITY.far + 600 - G, step = 220;
    for (let s = 0; s < len; s += step) {
      const e = Math.min(len, s + step);
      streets.push({ x0: ax + dx * s, y0: ay + dy * s, x1: ax + dx * e, y1: ay + dy * e, w: 14, kind: "estrada" });
    }
    roads.push({ x0: Math.min(ax, ax + dx * len) - 16, y0: Math.min(ay, ay + dy * len) - 16, x1: Math.max(ax, ax + dx * len) + 16, y1: Math.max(ay, ay + dy * len) + 16 });
  }

  /* ---------------------------------------------------------- quadras -- */
  const boxes = [], trees = [], lights = [];
  const coreAt = (x, y) => {
    let best = null, t = 0;
    for (const c of cores) { const k = 1 - Math.hypot(x - c.x, y - c.y) / c.r; if (k > t) { t = k; best = c; } }
    return { core: best, t };
  };
  // corta um retângulo em lotes de no máximo maxA x maxB
  function lots(r, maxA, maxB, out) {
    const w = r.x1 - r.x0, d = r.y1 - r.y0;
    if (w > maxA && (w / maxA >= d / maxB)) {
      const m = r.x0 + w * between(0.42, 0.58);
      lots({ ...r, x1: m }, maxA, maxB, out); lots({ ...r, x0: m }, maxA, maxB, out);
    } else if (d > maxB) {
      const m = r.y0 + d * between(0.42, 0.58);
      lots({ ...r, y1: m }, maxA, maxB, out); lots({ ...r, y0: m }, maxA, maxB, out);
    } else out.push(r);
    return out;
  }
  const kindOf = (h) => (h < 9.5 ? "casa" : h < 45 ? "predio" : "torre");
  const index = boxIndex();                      // as caixas já postas (sem os coroamentos, que ficam em cima da própria torre)
  function addBox(b, zone) {
    if (boxes.length >= CITY.maxBoxes) return false;
    if (b.x1 - b.x0 < 6 || b.y1 - b.y0 < 6) return false;
    if (!freeOf(b) || inEllipse(park, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 24)) return false;
    // nenhuma caixa cruza outra (com meio metro de folga) nem fica enterrada numa encosta
    if (index.hits(b, 0.5) || terrainUnder({ hills }, b) > MAX_SLOPE) return false;
    const box = { ...b, z0: 0, kind: b.kind || kindOf(b.z1), tone: rng(), zone };
    boxes.push(box);
    index.add(box);
    return true;
  }

  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
    const cell = {
      x0: xs[i].c + xs[i].w / 2 + 2.5, x1: xs[i + 1].c - xs[i + 1].w / 2 - 2.5,
      y0: ys[j].c + ys[j].w / 2 + 2.5, y1: ys[j + 1].c - ys[j + 1].w / 2 - 2.5,
    };
    if (cell.x1 - cell.x0 < 12 || cell.y1 - cell.y0 < 12) continue;
    const mx = (cell.x0 + cell.x1) / 2, my = (cell.y0 + cell.y1) / 2;
    const dist = Math.hypot(mx - cx, my - cy);
    if (inEllipse(park, mx, my, 10)) continue;                       // o parque não tem quadra
    const { core, t } = coreAt(mx, my);
    const south = smooth(-260, 260, my - cy + (noise(mx / 380, my / 380, seed) - 0.5) * 420);
    const zone = dist < CITY.near ? "perto" : t > 0 ? "centro" : rng() < south ? "misto" : "residencial";

    // uma quadra em cada vinte e poucas é praça: só árvores
    if (zone !== "perto" && zone !== "centro" && rng() < 0.045) {
      for (let k = 0; k < 7; k++) {
        const x = between(cell.x0 + 6, cell.x1 - 6), y = between(cell.y0 + 6, cell.y1 - 6);
        if (freePoint(x, y, 6)) trees.push({ x, y, h: between(7, 11), r: between(3, 4.6) });
      }
      continue;
    }
    const tight = dist < 620;                    // perto da torre os lotes são menores
    const flip = rng() < 0.5;
    let maxA = 46, maxB = 46;
    if (zone === "perto") [maxA, maxB] = [30, 19];
    else if (zone === "centro") [maxA, maxB] = [48, 48];
    else if (tight) [maxA, maxB] = [40, 21];
    if (flip) [maxA, maxB] = [maxB, maxA];

    for (const lot of lots(cell, maxA, maxB, [])) {
      const fill = zone === "perto" ? 0.9 : zone === "centro" ? 0.92 : zone === "misto" ? 0.86 : 0.8;
      if (rng() > fill) continue;
      let h;
      const roll = rng();
      if (zone === "perto") h = roll < 0.64 ? between(3.6, 8.2) : between(9.5, 21);
      else if (zone === "residencial") h = roll < 0.86 ? between(3.8, 9) : between(10, 19);
      else if (zone === "misto") h = roll < 0.42 ? between(4.5, 9.4) : roll < 0.8 ? between(11, 25) : roll < 0.97 ? between(26, 50) : between(52, 74);
      else h = lerp(26, core.h, Math.pow(t, 0.75)) * between(0.5, 1.12);
      const tall = h >= 45;
      const w = lot.x1 - lot.x0, d = lot.y1 - lot.y0;
      // torres são esbeltas: ocupam o miolo do lote
      const ix = tall ? Math.max(2.5, (w - between(19, 30)) / 2) : between(1.4, 3.6);
      const iy = tall ? Math.max(2.5, (d - between(19, 30)) / 2) : between(1.4, 3.6);
      const b = { x0: lot.x0 + ix, x1: lot.x1 - ix, y0: lot.y0 + iy, y1: lot.y1 - iy, z1: h };
      if (!addBox(b, zone)) continue;
      // as mais altas ganham um coroamento recuado, para o skyline não ser só caixas retas
      if (h > 78 && rng() < 0.7 && boxes.length < CITY.maxBoxes) {
        const s = between(2.5, 5);
        boxes.push({ x0: b.x0 + s, x1: b.x1 - s, y0: b.y0 + s, y1: b.y1 - s, z0: h, z1: h + between(6, 16), kind: "torre", tone: rng(), zone, crown: true });
      }
    }
  }

  /* ----------------------------------------------------- blocos de longe -- */
  // Fora da malha cada caixa vale por um conjunto de quadras. Mais cheio nos
  // fundos (a cidade segue), mais ralo na frente (o bairro some na serra).
  const STEP = 215;
  const n = Math.ceil(CITY.far / STEP);
  for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
    const ox = cx + i * STEP, oy = cy + j * STEP;
    const mx = ox + STEP / 2, my = oy + STEP / 2;
    const dist = Math.hypot(mx - cx, my - cy);
    if (dist > CITY.far || (ox + STEP > x0g - 8 && ox < x1g + 8 && oy + STEP > y0g - 8 && oy < y1g + 8)) { rng(); continue; }
    const south = smooth(-900, 900, my - cy);
    const subT = clamp(1 - Math.hypot(mx - sub.x, my - sub.y) / sub.r, 0, 1);
    const density = lerp(0.42, 0.9, south) * lerp(1, 0.62, smooth(2200, CITY.far, dist)) * (0.55 + 0.9 * noise(mx / 900, my / 900, seed + 7)) + subT;
    const count = (rng() < density ? 1 : 0) + (rng() < density - 0.5 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const w = between(48, 112), d = between(48, 112);
      const x0 = between(ox + 6, ox + STEP - 6 - w), y0 = between(oy + 6, oy + STEP - 6 - d);
      const roll = rng();
      let h = roll < 0.68 ? between(5, 12) : roll < 0.95 ? between(13, 30) : between(32, 52);
      let b = { x0, y0, x1: x0 + w, y1: y0 + d, z1: h, kind: "bloco" };
      if (subT > 0.15 && rng() < subT + 0.2) {
        h = between(34, 96) * (0.5 + subT);
        const s = between(26, 44);
        b = { x0, y0, x1: x0 + s, y1: y0 + s, z1: h, kind: h >= 45 ? "torre" : "predio" };
      }
      // o terreno e a vizinhança são conferidos por caixa, em addBox
      if (roads.some((r) => overlaps(b, r))) continue;
      addBox(b, "longe");
    }
  }

  /* ------------------------------------------------------------ árvores -- */
  // o parque: maciços de árvores em volta do lago
  for (let c = 0; c < 64; c++) {
    const a = between(0, Math.PI * 2), k = Math.sqrt(rng()) * 0.94;
    const x0 = park.x + Math.cos(a) * park.rx * k, y0 = park.y + Math.sin(a) * park.ry * k;
    const many = 3 + Math.floor(rng() * 6);
    for (let t = 0; t < many; t++) {
      const x = x0 + between(-22, 22), y = y0 + between(-22, 22);
      if (!inEllipse(park, x, y, -6) || inEllipse(lake, x, y, 8) || !freePoint(x, y, 6)) continue;
      trees.push({ x, y, h: between(7.5, 14), r: between(3.2, 5.6) });
    }
  }

  /* -------------------------------------------------------------- luzes -- */
  // Janelas acesas só nas faces viradas para a torre (as outras ninguém vê da
  // varanda), alinhadas à mesma grade de janelas que o desenho usa de dia.
  // Nenhuma luz fica dentro de uma caixa nem abaixo do terreno: de longe o
  // ponto se afasta da parede e podia cair no vizinho ou numa encosta.
  const clear = (x, y, z) => !index.at(x, y, z) && z >= ground(x, y);
  const F = CITY.floor, BAY = CITY.bay;
  const faceLights = (b, axis, cap, p, out = lights) => {
    // axis "x": face de x constante, as janelas correm ao longo de y
    const lo = axis === "x" ? b.y0 : b.x0, hi = axis === "x" ? b.y1 : b.x1;
    const k0 = Math.ceil(lo / BAY - 0.18), k1 = Math.floor(hi / BAY - 0.82);
    const m0 = Math.ceil(b.z0 / F - 0.35), m1 = Math.floor(b.z1 / F - 0.8);
    if (k1 < k0 || m1 < m0) return;
    const count = Math.min(cap, Math.max(1, Math.round((k1 - k0 + 1) * (m1 - m0 + 1) * p)));
    const dist = Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy);
    const off = 0.3 + (dist / 1000) ** 2 * 0.4;  // de longe o ponto se afasta da parede, por causa da precisão de profundidade
    for (let i = 0; i < count; i++) {
      const u = (k0 + Math.floor(rng() * (k1 - k0 + 1)) + 0.5) * BAY;
      const z = (m0 + Math.floor(rng() * (m1 - m0 + 1)) + 0.575) * F;
      const x = axis === "x" ? (cx < b.x0 ? b.x0 - off : b.x1 + off) : u;
      const y = axis === "x" ? u : (cy < b.y0 ? b.y0 - off : b.y1 + off);
      if (clear(x, y, z)) out.push({ x, y, z, kind: "janela" });
    }
  };
  const facing = (b, axis) => (axis === "x" ? cx < b.x0 || cx > b.x1 : cy < b.y0 || cy > b.y1);
  for (const b of boxes) {
    const dx = (b.x0 + b.x1) / 2 - cx, dy = (b.y0 + b.y1) / 2 - cy, dist = Math.hypot(dx, dy) || 1;
    const cap = b.zone === "perto" ? 7 : b.kind === "torre" ? 18 : b.zone === "longe" ? 1 : dist < 620 ? 3 : 2;
    const p = b.kind === "torre" ? 0.2 : 0.3;
    const sees = (axis) => (axis === "x" ? (cx < b.x0 || cx > b.x1) && Math.abs(dx) / dist > 0.45 : (cy < b.y0 || cy > b.y1) && Math.abs(dy) / dist > 0.45);
    if (sees("x")) faceLights(b, "x", Math.max(1, Math.round((cap * Math.abs(dx)) / dist)), p);
    if (sees("y")) faceLights(b, "y", Math.max(1, Math.round((cap * Math.abs(dy)) / dist)), p);
  }
  // postes ao longo das ruas; nas estradas eles sobem o morro junto
  for (const s of streets) {
    const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
    const gap = s.kind === "rua" ? 62 : s.kind === "avenida" ? 34 : 44;
    const count = Math.max(1, Math.round(len / gap));
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / count;
      const x = lerp(s.x0, s.x1, k), y = lerp(s.y0, s.y1, k);
      const z = ground(x, y) + (s.kind === "rua" ? 7 : 9);
      if (!freePoint(x, y, 4) || !clear(x, y, z)) continue;
      lights.push({ x, y, z, kind: "poste" });
    }
  }
  // luzes soltas de longe: bairros que não viraram caixa e casas nas encostas
  for (let i = 0; i < 2600; i++) {
    const a = between(0, Math.PI * 2), dist = Math.sqrt(between((G * 1.05) ** 2, 5200 ** 2));
    const x = cx + Math.sin(a) * dist, y = cy - Math.cos(a) * dist;
    const z = ground(x, y);
    const south = smooth(-900, 900, y - cy);
    const keepP = (z > 0 ? (z < 150 ? 0.75 : 0.06) : lerp(0.3, 0.85, south)) * (0.4 + 0.9 * noise(x / 700, y / 700, seed + 13));
    const up = z + between(3, 9);
    if (rng() < keepP && clear(x, y, up)) lights.push({ x, y, z: up, kind: "longe" });
  }
  // algumas luzes nos caminhos do parque
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const x = lake.x + Math.cos(a) * (lake.rx + 14), y = lake.y + Math.sin(a) * (lake.ry + 14);
    if (inEllipse(park, x, y, -4)) lights.push({ x, y, z: 4.5, kind: "poste" });
  }
  // Os vizinhos de buildSite não são desta cidade, mas da varanda são os
  // prédios mais próximos: à noite também têm janelas acesas. Vão numa lista
  // à parte, porque ficam dentro da zona livre, onde a cidade não põe nada.
  const siteLights = [];
  for (const b of site.neighbors) for (const axis of ["x", "y"]) if (facing(b, axis)) faceLights(b, axis, 7, 0.34, siteLights);

  // nunca passa do orçamento: se alguma mudança nos números estourar, saem
  // janelas, de forma regular e sempre igual
  let kept = lights;
  if (lights.length > CITY.maxLights) {
    const windows = lights.filter((l) => l.kind === "janela").length;
    const keepEvery = (windows - (lights.length - CITY.maxLights)) / windows;   // fração das janelas que fica
    let seen = 0, held = 0;
    kept = lights.filter((l) => {
      if (l.kind !== "janela") return true;
      seen++;
      if (held < Math.floor(seen * keepEvery)) { held++; return true; }
      return false;
    });
  }

  for (const b of boxes) delete b.zone;
  return {
    seed, center: { x: cx, y: cy }, free: CITY.free, radius: CITY.far,
    boxes, lights: kept, siteLights, hills, trees, streets,
    parks: [park], water: [lake], cores,
  };
}

/**
 * Confere a cidade: orçamento, zona livre, caixas bem formadas, sem
 * sobreposição e fora das encostas, luzes acima do terreno e fora das caixas.
 * Lista vazia = tudo certo.
 */
export function checkCity(city, tower) {
  const out = [];
  const { x: cx, y: cy } = city.center;
  if (city.boxes.length > CITY.maxBoxes) out.push(`caixas demais: ${city.boxes.length}`);
  if (city.lights.length > CITY.maxLights) out.push(`luzes demais: ${city.lights.length}`);
  const site = buildSite(tower);
  const taken = [...site.pads, ...site.neighbors];
  for (const b of city.boxes) {
    if (!(b.x0 < b.x1 && b.y0 < b.y1 && b.z0 < b.z1)) out.push(`caixa vazia ou invertida: ${JSON.stringify(b)}`);
    if (rectDist(cx, cy, b) < city.free - 1e-6) out.push(`caixa dentro da zona livre: ${JSON.stringify(b)}`);
    if (taken.some((t) => overlaps(b, t))) out.push(`caixa em cima do entorno da torre: ${JSON.stringify(b)}`);
    const under = terrainUnder(city, b);
    if (under > MAX_SLOPE + 1e-9) out.push(`caixa enterrada na encosta (terreno de ${under.toFixed(1)} m): ${JSON.stringify(b)}`);
  }
  // sobreposição entre caixas (o coroamento fica em cima da própria torre e não conta)
  const index = boxIndex();
  for (const b of city.boxes) {
    if (b.crown) continue;
    const other = index.hits(b);
    if (other) out.push(`caixas sobrepostas: ${JSON.stringify(b)} e ${JSON.stringify(other)}`);
    index.add(b);
  }
  for (const l of city.lights) {
    if (![l.x, l.y, l.z].every(Number.isFinite)) { out.push(`luz inválida: ${JSON.stringify(l)}`); continue; }
    if (Math.hypot(l.x - cx, l.y - cy) < city.free - 1e-6) out.push(`luz dentro da zona livre: ${JSON.stringify(l)}`);
    const g = terrainHeight(city, l.x, l.y);
    if (l.z < g - 1e-9) out.push(`luz abaixo do terreno (${g.toFixed(1)} m): ${JSON.stringify(l)}`);
    if (index.at(l.x, l.y, l.z)) out.push(`luz dentro de uma caixa: ${JSON.stringify(l)}`);
  }
  for (const t of city.trees) if (Math.hypot(t.x - cx, t.y - cy) < city.free) out.push(`árvore dentro da zona livre: ${JSON.stringify(t)}`);
  return out;
}

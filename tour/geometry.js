/**
 * Da planta (data/plans.js) para uma descrição neutra da cena 3D.
 *
 * Módulo puro: não importa three.js nem nada de "node:". Roda igual no
 * navegador (tour/tour.js) e no Node (node --test).
 *
 * Sistema de coordenadas deste arquivo: o mesmo da planta, mais a altura.
 *   x, y  metros no plano, origem no canto superior esquerdo, y para baixo
 *   z     altura em metros a partir do piso acabado (z = 0)
 * Toda peça é uma caixa alinhada aos eixos: { x0, y0, x1, y1, z0, z1 }.
 * Quem desenha (tour.js) converte para a cena: X = x, Z = y, Y = z.
 */

export const DIM = Object.freeze({
  ceiling: 2.7,    // pé-direito
  outer: 0.15,     // espessura da parede externa
  inner: 0.10,     // espessura da parede interna
  sill: 0.9,       // peitoril das janelas
  head: 2.1,       // altura de portas e do topo dos vidros
  rail: 1.1,       // guarda-corpo
  leaf: 0.04,      // espessura da folha de porta
  pane: 0.02,      // espessura do vidro
  eye: 1.6,        // altura dos olhos no modo caminhar
  radius: 0.25,    // raio do círculo de colisão da pessoa
  cell: 0.05,      // lado da célula da malha de navegação
});

/** Altura de cada tipo de móvel e se ele bloqueia a passagem. */
export const FURNITURE = Object.freeze({
  cama: { z: 0.55, blocks: true },
  sofa: { z: 0.8, blocks: true },
  poltrona: { z: 0.8, blocks: true },
  mesa: { z: 0.75, blocks: true },
  "mesa-lateral": { z: 0.45, blocks: true },
  cadeira: { z: 0.85, blocks: true },
  bancada: { z: 0.92, blocks: true },
  balcao: { z: 1.05, blocks: true },
  armario: { z: 2.2, blocks: true },
  rack: { z: 0.5, blocks: true },
  tapete: { z: 0.015, blocks: false },
  planta: { z: 1.3, blocks: true },
  geladeira: { z: 1.8, blocks: true },
  maquina: { z: 0.9, blocks: true },
  vaso: { z: 0.78, blocks: true },
  pia: { z: 0.88, blocks: true },
  box: { z: 2.0, blocks: true },
});

const EPS = 1e-6;
const FURNITURE_SLACK = 0.08;
const key = (x, y) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;

/* ------------------------------------------------------------- segmentos -- */

// Segmento alinhado a um eixo -> { axis, c, a, b }: c é a coordenada fixa,
// a < b são os extremos ao longo do eixo. flip diz se a ordem foi invertida.
function run(x1, y1, x2, y2) {
  if (Math.abs(y1 - y2) < EPS) return { axis: "h", c: y1, a: Math.min(x1, x2), b: Math.max(x1, x2), flip: x1 > x2 };
  if (Math.abs(x1 - x2) < EPS) return { axis: "v", c: x1, a: Math.min(y1, y2), b: Math.max(y1, y2), flip: y1 > y2 };
  throw new Error(`segmento inclinado não suportado: ${x1},${y1} -> ${x2},${y2}`);
}

// Trecho [a, b] de um eixo, com espessura t centrada na linha, vira caixa.
function box(axis, c, a, b, t, z0, z1, extra) {
  const h = t / 2;
  return axis === "h"
    ? { x0: a, y0: c - h, x1: b, y1: c + h, z0, z1, ...extra }
    : { x0: c - h, y0: a, x1: c + h, y1: b, z0, z1, ...extra };
}

const pointOn = (axis, c, s) => (axis === "h" ? [s, c] : [c, s]);

/* ------------------------------------------------------------- o modelo -- */

/**
 * @param {object} plan  uma planta de data/plans.js
 * @returns modelo com walls, floors, glass, frames, rails, doors, furniture,
 *          rooms, bounds, colliders e nav (malha de navegação)
 */
export function buildModel(plan) {
  const D = DIM;
  const walls = [], glass = [], frames = [], rails = [], doors = [], colliders = [];

  // pontas de parede que são batente de porta: ali a parede não é estendida,
  // senão o vão ficaria mais estreito do que o desenhado
  const jambs = new Set();
  const terminals = new Set();        // pontas das polilinhas externas
  for (const pts of plan.outer) {
    terminals.add(key(...pts[0]));
    terminals.add(key(...pts[pts.length - 1]));
  }
  const doorRuns = plan.doors.map((d) => {
    const axis = d.wall;
    const a = axis === "h" ? d.at[0] : d.at[1];
    const c = axis === "h" ? d.at[1] : d.at[0];
    const b = a + d.w;
    const pa = pointOn(axis, c, a), pb = pointOn(axis, c, b);
    jambs.add(key(...pa));
    jambs.add(key(...pb));
    return { d, axis, a, b, c, entry: terminals.has(key(...pa)) && terminals.has(key(...pb)) };
  });

  // vidros: os que caem sobre parede externa são janelas, os outros são panos
  const panes = plan.glass.map(([x1, y1, x2, y2]) => ({ ...run(x1, y1, x2, y2), window: false }));

  const solid = (b) => colliders.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, kind: b.kind, tall: b.z1 >= D.eye });
  const wall = (b) => { walls.push(b); if (b.z0 < D.head) solid(b); };

  // Moldura de um vidro: quatro barras em volta do pano.
  const frame = (axis, c, a, b, z0, z1, bar, depth) => {
    frames.push(box(axis, c, a, b, depth, z0, z0 + bar));
    frames.push(box(axis, c, a, b, depth, z1 - bar, z1));
    frames.push(box(axis, c, a, a + bar, depth, z0 + bar, z1 - bar));
    frames.push(box(axis, c, b - bar, b, depth, z0 + bar, z1 - bar));
  };

  /* paredes externas, com as janelas recortadas */
  for (const pts of plan.outer) {
    for (let i = 0; i < pts.length - 1; i++) {
      const r = run(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      // canto interno da polilinha sempre fecha; ponta solta fecha, salvo batente
      let extStart = !(i === 0 && jambs.has(key(...pts[i])));
      let extEnd = !(i === pts.length - 2 && jambs.has(key(...pts[i + 1])));
      if (r.flip) [extStart, extEnd] = [extEnd, extStart];
      const half = D.outer / 2;

      const cuts = panes
        .filter((g) => g.axis === r.axis && Math.abs(g.c - r.c) < EPS && g.a >= r.a - EPS && g.b <= r.b + EPS)
        .sort((p, q) => p.a - q.a);
      let cur = r.a;
      for (const g of cuts) {
        g.window = true;
        if (g.a > cur + EPS) {
          const a = cur - (cur === r.a && extStart ? half : 0);
          wall(box(r.axis, r.c, a, g.a, D.outer, 0, D.ceiling, { kind: "externa" }));
        }
        wall(box(r.axis, r.c, g.a, g.b, D.outer, 0, D.sill, { kind: "peitoril" }));
        wall(box(r.axis, r.c, g.a, g.b, D.outer, D.head, D.ceiling, { kind: "verga" }));
        glass.push(box(r.axis, r.c, g.a, g.b, D.pane, D.sill, D.head, { kind: "janela" }));
        frame(r.axis, r.c, g.a, g.b, D.sill, D.head, 0.05, 0.07);
        if (g.b - g.a > 1.3) {
          const m = (g.a + g.b) / 2;
          frames.push(box(r.axis, r.c, m - 0.02, m + 0.02, 0.07, D.sill + 0.05, D.head - 0.05));
        }
        // o vidro da janela bloqueia entre o peitoril e a verga
        colliders.push({ ...box(r.axis, r.c, g.a, g.b, D.outer, 0, 0), kind: "janela", tall: true });
        cur = g.b;
      }
      if (r.b > cur + EPS) {
        const a = cur - (cur === r.a && extStart ? half : 0);
        wall(box(r.axis, r.c, a, r.b + (extEnd ? half : 0), D.outer, 0, D.ceiling, { kind: "externa" }));
      }
    }
  }

  /* paredes internas */
  for (const [x1, y1, x2, y2] of plan.inner) {
    const r = run(x1, y1, x2, y2);
    const half = D.inner / 2;
    const a = r.a - (jambs.has(key(...pointOn(r.axis, r.c, r.a))) ? 0 : half);
    const b = r.b + (jambs.has(key(...pointOn(r.axis, r.c, r.b))) ? 0 : half);
    wall(box(r.axis, r.c, a, b, D.inner, 0, D.ceiling, { kind: "interna" }));
  }

  /* panos de vidro (porta de correr da varanda): não bloqueiam a passagem */
  for (const g of panes) {
    if (g.window) continue;
    const half = D.outer / 2;
    wall(box(g.axis, g.c, g.a - half, g.b + half, D.outer, D.head, D.ceiling, { kind: "verga" }));
    const n = Math.max(2, Math.round((g.b - g.a) / 1.25));
    const len = (g.b - g.a) / n;
    const open = Math.floor(n / 2);     // esta folha fica corrida sobre a vizinha
    for (let k = 0; k < n; k++) {
      const slid = k === open;
      const a = g.a + (slid ? k - 1 : k) * len;
      const c = g.c + (slid ? 0.06 : 0);
      glass.push(box(g.axis, c, a + 0.04, a + len - 0.04, D.pane, 0.04, D.head - 0.04, { kind: "pano", slid }));
      frame(g.axis, c, a, a + len, 0, D.head, 0.04, 0.05);
    }
  }

  /* portas: verga sobre o vão e a folha */
  for (const { d, axis, a, b, c, entry } of doorRuns) {
    const t = entry ? D.outer : D.inner;
    wall(box(axis, c, a, b, t, D.head, D.ceiling, { kind: "verga" }));
    const far = c + d.side * d.w;
    const swing = axis === "h"
      ? { x0: a, x1: b, y0: Math.min(c, far), y1: Math.max(c, far) }
      : { y0: a, y1: b, x0: Math.min(c, far), x1: Math.max(c, far) };
    const gap = box(axis, c, a, b, t, 0, D.head);
    let leaf;
    if (entry) {
      // porta de entrada: fechada, bloqueia
      leaf = box(axis, c, a, b, D.leaf, 0, D.head);
      solid({ ...leaf, kind: "entrada" });
    } else {
      // porta interna: aberta a 90°, encostada no batente da dobradiça
      const hc = d.hinge ? b - D.leaf / 2 : a + D.leaf / 2;
      leaf = box(axis === "h" ? "v" : "h", hc, Math.min(c, far), Math.max(c, far), D.leaf, 0, D.head);
    }
    doors.push({ ...leaf, entry, open: !entry, wall: axis, hinge: d.hinge, side: d.side, gap, swing });
  }

  /* guarda-corpo: corrimão, vidro e montantes */
  for (const pts of plan.rail) {
    for (let i = 0; i < pts.length - 1; i++) {
      const r = run(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      const a = r.a - 0.03, b = r.b + 0.03;
      rails.push(box(r.axis, r.c, a, b, 0.06, D.rail - 0.05, D.rail, { part: "corrimao" }));
      rails.push(box(r.axis, r.c, r.a, r.b, D.pane, 0.1, D.rail - 0.05, { part: "vidro" }));
      const n = Math.max(1, Math.ceil((r.b - r.a) / 1.5));
      for (let k = 0; k <= n; k++) {
        const s = r.a + ((r.b - r.a) * k) / n;
        rails.push(box(r.axis, r.c, s - 0.025, s + 0.025, 0.05, 0, D.rail - 0.05, { part: "montante" }));
      }
      solid({ ...box(r.axis, r.c, a, b, 0.06, 0, D.rail), kind: "guarda-corpo" });
    }
  }

  /* cômodos e pisos */
  const rooms = plan.rooms.map((room, index) => {
    const rects = room.r.map(([x, y, w, h]) => ({ x0: x, y0: y, x1: x + w, y1: y + h }));
    const [x, y, w, h] = room.r[0];
    return {
      index, name: room.name, full: room.full, floor: room.floor || "madeira",
      area: room.r.reduce((s, [, , rw, rh]) => s + rw * rh, 0),
      rects,
      label: room.at ? [...room.at] : [x + w / 2, y + h / 2],
      bbox: {
        x0: Math.min(...rects.map((q) => q.x0)), y0: Math.min(...rects.map((q) => q.y0)),
        x1: Math.max(...rects.map((q) => q.x1)), y1: Math.max(...rects.map((q) => q.y1)),
      },
      visit: null,
    };
  });
  const floors = rooms.flatMap((room) => room.rects.map((q) => ({ ...q, room: room.index, floor: room.floor })));

  const bounds = { x0: -D.outer / 2, y0: -D.outer / 2, x1: plan.w + D.outer / 2, y1: plan.h + D.outer / 2 };
  const model = {
    id: plan.id, title: plan.title, area: plan.area, w: plan.w, h: plan.h, north: plan.north || 0,
    height: D.ceiling, bounds, rooms, floors, walls, glass, frames, rails, doors,
    furniture: [], colliders, nav: null,
  };

  /* móveis */
  const barriers = colliders.slice();         // paredes, peitoris, guarda-corpos, entrada
  for (const f of plan.furniture || []) {
    const def = FURNITURE[f.type];
    if (!def) throw new Error(`${plan.id}: tipo de móvel desconhecido "${f.type}"`);
    const piece = {
      type: f.type, rot: f.rot || 0,
      x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h, z0: 0, z1: def.z,
      blocks: def.blocks, room: -1, crosses: false,
    };
    trim(piece, barriers);
    piece.room = roomAt(model, (piece.x0 + piece.x1) / 2, (piece.y0 + piece.y1) / 2);
    model.furniture.push(piece);
    // A colisão do móvel é 8 cm menor de cada lado que o desenho: quinas de
    // sofá e de cama não seguram quem passa rente a elas.
    if (piece.blocks) {
      const s = FURNITURE_SLACK;
      colliders.push({ x0: piece.x0 + s, y0: piece.y0 + s, x1: piece.x1 - s, y1: piece.y1 - s, kind: piece.type, tall: piece.z1 >= D.eye });
    }
  }

  model.nav = buildNav(model);
  for (const room of rooms) room.visit = visitPoint(model, room);
  return model;
}

// Um móvel declarado encostado na linha da parede entra meia espessura nela.
// Aqui ele é aparado até a face da parede. Invasão maior que isso não é
// "encostar": fica marcada em crosses para checkModel acusar.
const TRIM_MAX = DIM.outer / 2 + 0.005;
function trim(piece, barriers) {
  for (const w of barriers) {
    const ox = Math.min(piece.x1, w.x1) - Math.max(piece.x0, w.x0);
    const oy = Math.min(piece.y1, w.y1) - Math.max(piece.y0, w.y0);
    if (ox <= EPS || oy <= EPS) continue;
    if (ox <= oy && ox <= TRIM_MAX) {
      if ((w.x0 + w.x1) / 2 < (piece.x0 + piece.x1) / 2) piece.x0 = w.x1; else piece.x1 = w.x0;
    } else if (oy <= TRIM_MAX) {
      if ((w.y0 + w.y1) / 2 < (piece.y0 + piece.y1) / 2) piece.y0 = w.y1; else piece.y1 = w.y0;
    } else {
      piece.crosses = true;
    }
  }
}

/* -------------------------------------------------------------- consultas -- */

/** Índice do cômodo que contém o ponto, ou -1. */
export function roomAt(model, x, y) {
  for (const room of model.rooms) {
    for (const q of room.rects) {
      if (x >= q.x0 - EPS && x <= q.x1 + EPS && y >= q.y0 - EPS && y <= q.y1 + EPS) return room.index;
    }
  }
  return -1;
}

/**
 * Colisão pura: um círculo de raio r em (x, y) encosta em alguma caixa?
 * @param {{x0:number,y0:number,x1:number,y1:number}[]} colliders
 */
export function collides(colliders, x, y, r = DIM.radius) {
  const rr = r * r;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = x < c.x0 ? c.x0 - x : x > c.x1 ? x - c.x1 : 0;
    const dy = y < c.y0 ? c.y0 - y : y > c.y1 ? y - c.y1 : 0;
    const d2 = dx * dx + dy * dy;
    // d2 === 0 é centro dentro da caixa: colide mesmo com raio 0.
    if (d2 < rr || d2 === 0) return true;
  }
  return false;
}

/**
 * Anda de from até to em passos curtos. Onde bate, desliza ao longo do
 * obstáculo (tenta só x, depois só y). Devolve a posição alcançada.
 */
export function slideMove(colliders, from, to, r = DIM.radius) {
  let [x, y] = from;
  const dx = to[0] - x, dy = to[1] - y;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.05));
  const sx = dx / n, sy = dy / n;
  for (let i = 0; i < n; i++) {
    if (!collides(colliders, x + sx, y + sy, r)) { x += sx; y += sy; }
    else if (sx !== 0 && !collides(colliders, x + sx, y, r)) x += sx;
    else if (sy !== 0 && !collides(colliders, x, y + sy, r)) y += sy;
    else break;
  }
  return [x, y];
}

/** O círculo passa livre pelo segmento a-b? (amostrado a cada 5 cm) */
export function segmentFree(colliders, a, b, r = DIM.radius) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (collides(colliders, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, r)) return false;
  }
  return true;
}

/* ------------------------------------------------------ malha e caminhos -- */

function buildNav(model) {
  const { bounds: B, colliders } = model;
  const cell = DIM.cell;
  const cols = Math.ceil((B.x1 - B.x0) / cell), rows = Math.ceil((B.y1 - B.y0) / cell);
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = B.x0 + (i + 0.5) * cell, y = B.y0 + (j + 0.5) * cell;
      if (roomAt(model, x, y) >= 0 && !collides(colliders, x, y)) free[j * cols + i] = 1;
    }
  }
  return { cell, cols, rows, x0: B.x0, y0: B.y0, free };
}

const cellCenter = (nav, k) => [nav.x0 + ((k % nav.cols) + 0.5) * nav.cell, nav.y0 + (Math.floor(k / nav.cols) + 0.5) * nav.cell];

// Célula livre mais próxima do ponto, dentro de um alcance. accept filtra.
function nearestFree(nav, x, y, reach = 2, accept = null) {
  const ci = Math.floor((x - nav.x0) / nav.cell), cj = Math.floor((y - nav.y0) / nav.cell);
  const span = Math.ceil(reach / nav.cell);
  let best = -1, bestD = Infinity;
  for (let j = Math.max(0, cj - span); j <= Math.min(nav.rows - 1, cj + span); j++) {
    for (let i = Math.max(0, ci - span); i <= Math.min(nav.cols - 1, ci + span); i++) {
      const k = j * nav.cols + i;
      if (!nav.free[k]) continue;
      const [px, py] = cellCenter(nav, k);
      if (accept && !accept(px, py)) continue;
      const d = (px - x) ** 2 + (py - y) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
  }
  return best;
}

// Ponto de visita: o rótulo do cômodo, ou o lugar livre mais perto dele.
function visitPoint(model, room) {
  const [x, y] = room.label;
  if (roomAt(model, x, y) === room.index && !collides(model.colliders, x, y)) return [x, y];
  const reach = Math.hypot(model.w, model.h);
  const k = nearestFree(model.nav, x, y, reach, (px, py) => roomAt(model, px, py) === room.index);
  return k >= 0 ? cellCenter(model.nav, k) : [x, y];
}

/**
 * Caminho a pé de from até to, contornando paredes e móveis (A* na malha,
 * depois encurtado em trechos retos). Devolve [[x, y], ...] começando em
 * from, ou null se não houver caminho.
 */
export function findPath(model, from, to) {
  const nav = model.nav, { cols, rows, free } = nav;
  const start = nearestFree(nav, from[0], from[1]);
  const goal = nearestFree(nav, to[0], to[1]);
  if (start < 0 || goal < 0) return null;

  const g = new Float32Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const done = new Uint8Array(cols * rows);
  const gi = goal % cols, gj = Math.floor(goal / cols);
  const heur = (k) => Math.hypot((k % cols) - gi, Math.floor(k / cols) - gj);

  // fila de prioridade (heap binário) de [f, célula]
  const heap = [];
  const push = (f, k) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  g[start] = 0;
  push(heur(start), start);
  let found = false;
  while (heap.length) {
    const [, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) { found = true; break; }
    const i = k % cols, j = Math.floor(k / cols);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (!free[nk] || done[nk]) continue;
        // diagonal só se os dois vizinhos retos estão livres (não corta quina)
        if (di && dj && (!free[j * cols + ni] || !free[nj * cols + i])) continue;
        const cost = g[k] + (di && dj ? Math.SQRT2 : 1);
        if (cost < g[nk]) { g[nk] = cost; prev[nk] = k; push(cost + heur(nk), nk); }
      }
    }
  }
  if (!found) return null;

  const cells = [];
  for (let k = goal; k >= 0; k = prev[k]) cells.push(cellCenter(nav, k));
  cells.reverse();

  const C = model.colliders;
  const pts = cells;
  if (!collides(C, from[0], from[1])) pts.unshift([from[0], from[1]]);
  if (!collides(C, to[0], to[1]) && roomAt(model, to[0], to[1]) >= 0) pts.push([to[0], to[1]]);

  // encurta: de cada ponto, segue reto até o mais distante ainda visível
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j + 1 < pts.length && segmentFree(C, pts[i], pts[j + 1])) j++;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

/**
 * Onde ficam as luzes da casa: um ponto de luz no centro de cada trecho de
 * ambiente, e dois quando o trecho é comprido (sala, varanda), para a luz não
 * ficar forte no meio e fraca nas pontas. Trecho pequeno de um ambiente que
 * já tem luz (o recuo do "L" do studio) não ganha a sua.
 * @returns {{ x: number, y: number, room: number, w: number, h: number }[]}
 *          w e h são o tamanho da parte do trecho que cada ponto ilumina
 */
export function lightSpots(model) {
  const out = [];
  for (const room of model.rooms) {
    const big = room.rects.reduce((m, q) => ((q.x1 - q.x0) * (q.y1 - q.y0) > (m.x1 - m.x0) * (m.y1 - m.y0) ? q : m), room.rects[0]);
    for (const q of room.rects) {
      const w = q.x1 - q.x0, h = q.y1 - q.y0;
      if (q !== big && w * h < 6) continue;
      const along = w >= h ? "x" : "y";
      const n = Math.max(1, Math.round(Math.max(w, h) / 4.5));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        out.push(along === "x"
          ? { x: q.x0 + w * t, y: (q.y0 + q.y1) / 2, room: room.index, w: w / n, h }
          : { x: (q.x0 + q.x1) / 2, y: q.y0 + h * t, room: room.index, w, h: h / n });
      }
    }
  }
  return out;
}

/** Comprimento de um caminho devolvido por findPath. */
export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/* ------------------------------------------------------------- conferência -- */

const overlap = (a, b, pad = 0) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > EPS + pad && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > EPS + pad;

/**
 * Confere a mobília e a navegação de um modelo. Devolve a lista de problemas
 * em texto (vazia quando está tudo certo). Serve para quem edita
 * data/plans.js saber se um móvel ficou atravessando parede ou porta.
 */
export function checkModel(model) {
  const out = [];
  const name = (f, i) => `${f.type} #${i} (${f.x0.toFixed(2)}, ${f.y0.toFixed(2)})`;
  model.furniture.forEach((f, i) => {
    const room = model.rooms[f.room];
    if (!room) { out.push(`${name(f, i)}: fora de qualquer cômodo`); return; }
    const inside = room.rects.reduce((s, q) =>
      s + Math.max(0, Math.min(f.x1, q.x1) - Math.max(f.x0, q.x0)) * Math.max(0, Math.min(f.y1, q.y1) - Math.max(f.y0, q.y0)), 0);
    if (Math.abs(inside - (f.x1 - f.x0) * (f.y1 - f.y0)) > 1e-4) out.push(`${name(f, i)}: não cabe inteiro em "${room.full}"`);
    if (f.crosses) out.push(`${name(f, i)}: atravessa parede ou guarda-corpo`);
    for (const w of model.walls) if (w.z0 < f.z1 && overlap(f, w)) out.push(`${name(f, i)}: sobrepõe parede (${w.kind})`);
    for (const g of model.glass) if (g.kind === "pano" && overlap(f, g)) out.push(`${name(f, i)}: sobrepõe o pano de vidro`);
    if (f.blocks) {
      for (const d of model.doors) {
        if (overlap(f, d.swing)) out.push(`${name(f, i)}: na área de giro de uma porta`);
        // faixa livre de 50 cm de cada lado do vão
        const g = d.gap, pad = 0.5;
        const zone = d.wall === "h" ? { x0: g.x0, x1: g.x1, y0: g.y0 - pad, y1: g.y1 + pad } : { x0: g.x0 - pad, x1: g.x1 + pad, y0: g.y0, y1: g.y1 };
        if (overlap(f, zone)) out.push(`${name(f, i)}: na frente de um vão de porta`);
      }
      model.furniture.forEach((o, k) => {
        if (k > i && o.blocks && overlap(f, o)) out.push(`${name(f, i)}: sobrepõe ${name(o, k)}`);
      });
    }
  });
  for (const room of model.rooms) {
    if (roomAt(model, room.visit[0], room.visit[1]) !== room.index) out.push(`"${room.full}": ponto de visita fora do cômodo`);
    if (collides(model.colliders, room.visit[0], room.visit[1])) out.push(`"${room.full}": ponto de visita dentro de um obstáculo`);
    if (room.index > 0 && !findPath(model, model.rooms[0].visit, room.visit)) out.push(`"${room.full}": sem caminho a pé a partir de "${model.rooms[0].full}"`);
  }
  return out;
}

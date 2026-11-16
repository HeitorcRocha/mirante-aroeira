/**
 * Da torre (data/tower.js) para uma descrição neutra da cena 3D do espelho de
 * vendas, mais as contas de orientação, sol e contagem de unidades.
 *
 * Módulo puro, como tour/geometry.js: não importa three.js nem nada de
 * "node:". Roda igual no navegador (tour/espelho.js) e no Node (node --test).
 *
 * Sistema de coordenadas: o da laje, mais a altura.
 *   x, y  metros no plano da laje, origem no canto superior esquerdo, y para
 *         baixo; o lado de y = 0 é a frente da torre
 *   z     altura em metros a partir do chão (z = 0)
 * Toda peça é uma caixa alinhada aos eixos: { x0, y0, x1, y1, z0, z1 }.
 * Quem desenha (espelho.js) converte para a cena: X = x, Z = y, Y = z, a
 * mesma conversão do tour, então tour/sun.js serve aos dois sem ajuste.
 *
 * Orientação: cada fachada da laje tem um ângulo, medido como o "north" das
 * plantas (sentido horário a partir do "para cima" do plano). O azimute para
 * onde a fachada olha é esse ângulo menos o north da torre.
 */
import { sunPosition, cardinal } from "./sun.js";

export const DIM = Object.freeze({
  ceiling: 2.7,      // pé-direito livre; o resto do piso a piso é laje e forro
  rail: 1.1,         // guarda-corpo
  wing: 0.45,        // recuo do vidro dos quartos, atrás dos brises
  fin: 0.5,          // passo dos brises
  mullion: 1.25,     // passo aproximado dos montantes dos panos de vidro
  screen: 0.45,      // quanto a empena de brises avança além da laje
  parapet: 1.2,      // guarda-corpo da cobertura
  machine: 3.4,      // casa de máquinas acima da cobertura
});

/** Fachadas da laje e o ângulo de cada uma (0 = o lado de y = 0). */
export const FACADES = Object.freeze({ frente: 0, direita: 90, fundos: 180, esquerda: 270 });

export const STATUS_LABEL = Object.freeze({ disponivel: "Disponível", reservada: "Reservada", vendida: "Vendida" });

/** A mesma grade de horas do slider do sol (tour.html e espelho.html). */
export const SUN_GRID = Object.freeze({ min: 5, max: 19, step: 0.5 });

const EPS = 1e-6;
const mod360 = (a) => ((a % 360) + 360) % 360;

/* --------------------------------------------------------------- plantas -- */

export function planOf(unit, plans) {
  return plans.find((p) => p.id === unit.plan) || null;
}

/** Área privativa da unidade, em m²: a da planta em data/plans.js. */
export function unitArea(unit, plans) {
  const plan = planOf(unit, plans);
  return plan ? plan.area : NaN;
}

/**
 * Onde fica a varanda de uma planta: o cômodo de piso "deck" e o lado do
 * retângulo da planta em que ele mais encosta.
 *
 * from/to medem o trecho da varanda ao longo desse lado, no sentido horário
 * visto de cima (no alto, da esquerda para a direita; no lado direito, de
 * cima para baixo; e assim por diante). Girar a planta não muda esse sentido,
 * então o mesmo trecho vale em qualquer fachada da torre.
 *
 * @returns {{ side: string, angle: number, from: number, to: number,
 *             depth: number, frontage: number, unitDepth: number } | null}
 */
export function planBalcony(plan) {
  const room = plan.rooms.find((r) => r.floor === "deck");
  if (!room) return null;
  let best = null;
  for (const [x, y, w, h] of room.r) {
    const sides = [
      { side: "cima", angle: 0, touch: Math.abs(y) < EPS, from: x, to: x + w, depth: h, frontage: plan.w, unitDepth: plan.h },
      { side: "direita", angle: 90, touch: Math.abs(x + w - plan.w) < EPS, from: y, to: y + h, depth: w, frontage: plan.h, unitDepth: plan.w },
      { side: "baixo", angle: 180, touch: Math.abs(y + h - plan.h) < EPS, from: plan.w - (x + w), to: plan.w - x, depth: h, frontage: plan.w, unitDepth: plan.h },
      { side: "esquerda", angle: 270, touch: Math.abs(x) < EPS, from: plan.h - (y + h), to: plan.h - y, depth: w, frontage: plan.h, unitDepth: plan.w },
    ];
    for (const s of sides) {
      if (s.touch && (!best || s.to - s.from > best.to - best.from)) best = s;
    }
  }
  if (!best) return null;
  const { touch, ...out } = best;
  return out;
}

/** Azimute para onde a varanda da planta aponta no tour 3D (pelo "north" dela). */
export function planAzimuth(plan) {
  const b = planBalcony(plan);
  return b ? mod360(b.angle - (plan.north || 0)) : NaN;
}

/* ------------------------------------------------------------ orientação -- */

/** Azimute (0 = norte, horário) para onde olha uma fachada da torre. */
export function facadeAzimuth(tower, facade) {
  if (!Object.hasOwn(FACADES, facade)) throw new Error(`fachada desconhecida: "${facade}"`);
  return mod360(FACADES[facade] - (tower.north || 0));
}

/** Azimute para onde a varanda da unidade aponta. */
export function unitAzimuth(tower, unit) {
  return facadeAzimuth(tower, unit.facade);
}

/** Ponto cardeal ou colateral da varanda: "norte", "sudoeste"... */
export function unitCardinal(tower, unit) {
  return cardinal(unitAzimuth(tower, unit));
}

/** Vetor unitário [x, y] no plano da laje que sai da fachada para fora. */
export function facadeNormal(facade) {
  if (!Object.hasOwn(FACADES, facade)) throw new Error(`fachada desconhecida: "${facade}"`);
  const a = (FACADES[facade] * Math.PI) / 180;
  return [Math.round(Math.sin(a)), -Math.round(Math.cos(a))];
}

/* ------------------------------------------------------------------- sol -- */

/**
 * A fachada que olha para o azimute dado recebe sol direto? Vale quando o sol
 * está acima do horizonte e à frente do plano da fachada. Não considera a
 * sombra de vizinhos nem a da laje de cima sobre a própria varanda.
 * @param {number} azimuth  para onde a fachada olha
 * @param {{ azimuth: number, elevation: number }} sun  de sunPosition()
 */
export function facadeSunlit(azimuth, sun) {
  if (!(sun.elevation > 0)) return false;
  return Math.cos(((sun.azimuth - azimuth) * Math.PI) / 180) > 1e-9;
}

export function unitSunlit(tower, unit, sun) {
  return facadeSunlit(unitAzimuth(tower, unit), sun);
}

/**
 * Horas de sol direto numa fachada ao longo do dia 15 do mês, somadas na
 * grade do slider (de 5h a 19h, de meia em meia hora): cada marca com sol
 * conta como meia hora.
 */
export function facadeSunHours(azimuth, month, latitude) {
  let n = 0;
  const steps = Math.round((SUN_GRID.max - SUN_GRID.min) / SUN_GRID.step);
  for (let i = 0; i <= steps; i++) {
    const hour = SUN_GRID.min + i * SUN_GRID.step;
    const sun = latitude === undefined ? sunPosition({ month, hour }) : sunPosition({ month, hour, latitude });
    if (facadeSunlit(azimuth, sun)) n++;
  }
  return n * SUN_GRID.step;
}

export function unitSunHours(tower, unit, month) {
  return facadeSunHours(unitAzimuth(tower, unit), month);
}

/* -------------------------------------------------------------- contagem -- */

/**
 * Quantas unidades há por status e por tipologia.
 * @param {string} [plan]  se dado, conta só as unidades dessa tipologia
 * @returns {{ total, disponivel, reservada, vendida, byPlan: { [id]: { total, disponivel, reservada, vendida } } }}
 */
export function countUnits(tower, plan) {
  const zero = () => ({ total: 0, disponivel: 0, reservada: 0, vendida: 0 });
  const out = { ...zero(), byPlan: {} };
  for (const band of tower.bands) out.byPlan[band.plan] = zero();
  for (const u of tower.units) {
    const p = out.byPlan[u.plan] || (out.byPlan[u.plan] = zero());
    p.total++;
    p[u.status] = (p[u.status] || 0) + 1;
    if (plan && u.plan !== plan) continue;
    out.total++;
    out[u.status] = (out[u.status] || 0) + 1;
  }
  return out;
}

/** "Apartamento 1302, Três suítes, 124 m², 13º andar, varanda a sul, disponível". */
export function unitLabel(tower, unit, plans, fmtArea = (a) => `${a} m²`) {
  const plan = planOf(unit, plans);
  return [
    `Apartamento ${unit.id}`,
    plan ? plan.title : unit.plan,
    plan ? fmtArea(plan.area) : null,
    `${unit.floor}º andar`,
    `varanda a ${unitCardinal(tower, unit)}`,
    (STATUS_LABEL[unit.status] || unit.status).toLowerCase(),
  ].filter(Boolean).join(", ");
}

/* ---------------------------------------------------------------- alturas -- */

/** Altura do piso acabado de um andar (o térreo é o andar 1, em z = 0). */
export function floorLevel(tower, floor) {
  return floor <= 1 ? 0 : tower.groundHeight + (floor - 2) * tower.floorHeight;
}

/** Altura do piso da cobertura. */
export function roofLevel(tower) {
  return floorLevel(tower, tower.floors + 1);
}

/* ------------------------------------------------------------- validação -- */

/**
 * Confere os dados da torre contra as plantas. Devolve a lista de problemas
 * em texto; lista vazia = tudo certo.
 */
export function checkTower(tower, plans) {
  const out = [];
  const { w: W, d: D } = tower.slab;
  const seen = new Set();
  const bandOf = (floor) => tower.bands.find((b) => floor >= b.from && floor <= b.to);

  const covered = new Set();
  for (const b of tower.bands) {
    if (!plans.some((p) => p.id === b.plan)) out.push(`faixa de andares: planta "${b.plan}" não existe em data/plans.js`);
    if (b.from > b.to) out.push(`faixa de andares de "${b.plan}" invertida (${b.from} a ${b.to})`);
    for (let f = b.from; f <= b.to; f++) {
      if (covered.has(f)) out.push(`andar ${f} aparece em duas faixas de tipologia`);
      covered.add(f);
      if (f < 2 || f > tower.floors) out.push(`andar ${f} fora da torre (apartamentos vão de 2 a ${tower.floors})`);
    }
  }
  for (let f = 2; f <= tower.floors; f++) if (!covered.has(f)) out.push(`andar ${f} sem tipologia`);

  for (const u of tower.units) {
    const name = `unidade ${u.id}`;
    // Campo numérico faltando ou NaN: toda comparação abaixo daria falso e a
    // unidade passaria calada, para depois sumir da cena.
    const bad = ["x", "y", "w", "d", "floor"].filter((k) => !Number.isFinite(u[k]));
    if (bad.length) { out.push(`${name}: campo numérico inválido (${bad.join(", ")})`); continue; }
    if (seen.has(u.id)) out.push(`${name}: id repetido`);
    seen.add(u.id);
    if (!Number.isInteger(u.id) || Math.floor(u.id / 100) !== u.floor) out.push(`${name}: o número não começa pelo andar ${u.floor}`);
    if (!Object.hasOwn(STATUS_LABEL, u.status)) out.push(`${name}: status "${u.status}" desconhecido`);
    // hasOwn, não "in": "toString" e companhia existem em todo objeto
    if (!Object.hasOwn(FACADES, u.facade)) { out.push(`${name}: fachada "${u.facade}" desconhecida`); continue; }

    const band = bandOf(u.floor);
    if (!band) out.push(`${name}: andar ${u.floor} não tem apartamentos`);
    else if (band.plan !== u.plan) out.push(`${name}: planta "${u.plan}" no andar ${u.floor}, que é de "${band.plan}"`);

    if (u.x < -EPS || u.y < -EPS || u.x + u.w > W + EPS || u.y + u.d > D + EPS) out.push(`${name}: sai da laje de ${W} x ${D} m`);

    const plan = planOf(u, plans);
    if (!plan) { out.push(`${name}: planta "${u.plan}" não existe em data/plans.js`); continue; }
    const bal = planBalcony(plan);
    if (!bal) { out.push(`${name}: a planta "${u.plan}" não tem varanda`); continue; }
    const lateral = u.facade === "direita" || u.facade === "esquerda";
    const frontage = lateral ? u.d : u.w, depth = lateral ? u.w : u.d;
    if (Math.abs(frontage - bal.frontage) > 1e-3 || Math.abs(depth - bal.unitDepth) > 1e-3) {
      out.push(`${name}: ocupa ${frontage} x ${depth} m, mas a planta "${u.plan}" tem ${bal.frontage} x ${bal.unitDepth} m`);
    }
    // a varanda precisa estar na borda da laje
    const [nx, ny] = facadeNormal(u.facade);
    const edge = nx > 0 ? Math.abs(u.x + u.w - W) : nx < 0 ? Math.abs(u.x) : ny > 0 ? Math.abs(u.y + u.d - D) : Math.abs(u.y);
    if (edge > 1e-3) out.push(`${name}: a varanda não chega à fachada "${u.facade}"`);

    const c = tower.core;
    if (c && u.x < c.x + c.w - EPS && c.x < u.x + u.w - EPS && u.y < c.y + c.d - EPS && c.y < u.y + u.d - EPS) {
      out.push(`${name}: sobrepõe o núcleo de circulação`);
    }
  }

  const byFloor = new Map();
  for (const u of tower.units) {
    if (!byFloor.has(u.floor)) byFloor.set(u.floor, []);
    byFloor.get(u.floor).push(u);
  }
  for (const [floor, list] of byFloor) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.d - EPS && b.y < a.y + a.d - EPS) {
        out.push(`andar ${floor}: unidades ${a.id} e ${b.id} se sobrepõem`);
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------- o modelo -- */

/**
 * Caixa no referencial da fachada de uma unidade -> caixa na laje.
 *   u  ao longo da fachada, no sentido horário visto de cima, a partir do
 *      canto da unidade (0 a testada); flip inverte o sentido
 *   v  profundidade, da fachada (0) para dentro
 */
function placer(unit, frontage) {
  const X0 = unit.x, Y0 = unit.y, X1 = unit.x + unit.w, Y1 = unit.y + unit.d;
  return (u0, u1, v0, v1) => {
    if (unit.flip) [u0, u1] = [frontage - u1, frontage - u0];
    switch (unit.facade) {
      case "direita": return { x0: X1 - v1, x1: X1 - v0, y0: Y0 + u0, y1: Y0 + u1 };
      case "fundos": return { x0: X1 - u1, x1: X1 - u0, y0: Y1 - v1, y1: Y1 - v0 };
      case "esquerda": return { x0: X0 + v0, x1: X0 + v1, y0: Y1 - u1, y1: Y1 - u0 };
      default: return { x0: X0 + u0, x1: X0 + u1, y0: Y0 + v0, y1: Y0 + v1 };
    }
  };
}

/**
 * @param {object} tower  data/tower.js
 * @param {object[]} plans  data/plans.js
 * @returns descrição da cena em caixas:
 *   slabs     lajes de piso e a da cobertura                 { floor }
 *   units     uma entrada por apartamento: { id, floor, plan, status, facade,
 *             azimuth, bbox, body: [caixas], center: [x, y, z] }
 *             bbox é o volume inteiro (com a varanda); body é o volume fechado
 *   glass     panos de vidro                                  { unit? , part }
 *   frames    montantes dos panos de vidro
 *   rails     guarda-corpos das varandas     part: "vidro" | "corrimao"
 *   fins      brises: nos quartos, entre varandas e nas empenas laterais
 *   columns   pilares do térreo
 *   core      núcleo de elevadores e escada, até a casa de máquinas
 *   ground    térreo                         part: "lobby" | "vidro" | "forro" | "marquise" | "piso" | "portal"
 *   roof      cobertura                      part: "vidro" | "deck" | "borda" | "agua" | "pergolado" | "ripa" | "canteiro" | "verde" | "tampa"
 *   levels    [{ floor, z0, z1 }]            piso e teto de cada andar
 *   bounds    caixa que envolve a torre inteira
 */
export function buildTower(tower, plans) {
  const { w: W, d: D } = tower.slab;
  const slabT = tower.floorHeight - DIM.ceiling;
  const zRoof = roofLevel(tower);
  const z2 = floorLevel(tower, 2);

  const slabs = [], units = [], glass = [], frames = [], rails = [], fins = [];
  const columns = [], core = [], ground = [], roof = [], levels = [];

  /* ------------------------------------------------------------ andares -- */
  levels.push({ floor: 1, z0: 0, z1: z2 - slabT });
  for (let f = 2; f <= tower.floors; f++) {
    const z0 = floorLevel(tower, f);
    levels.push({ floor: f, z0, z1: z0 + DIM.ceiling });
    slabs.push({ x0: 0, y0: 0, x1: W, y1: D, z0: z0 - slabT, z1: z0, floor: f });
  }
  slabs.push({ x0: 0, y0: 0, x1: W, y1: D, z0: zRoof - slabT, z1: zRoof, floor: tower.floors + 1 });

  /* ------------------------------------------------------------ unidades -- */
  const balconies = new Map();
  for (const p of plans) balconies.set(p.id, planBalcony(p));

  for (const u of tower.units) {
    const bal = balconies.get(u.plan);
    if (!bal) throw new Error(`unidade ${u.id}: planta "${u.plan}" sem varanda ou inexistente`);
    const F = bal.frontage, Dp = bal.unitDepth;
    const at = placer(u, F);
    const z0 = floorLevel(tower, u.floor), z1 = z0 + DIM.ceiling;
    const zs = { z0, z1 };
    const tag = { unit: u.id };

    // trechos da testada sem varanda: ali ficam os quartos, com vidro recuado
    // atrás de brises verticais
    const wings = [];
    if (bal.from > EPS) wings.push([0, bal.from]);
    if (bal.to < F - EPS) wings.push([bal.to, F]);

    const body = [{ ...at(0, F, bal.depth, Dp), ...zs }];
    for (const [a, b] of wings) body.push({ ...at(a, b, DIM.wing, bal.depth), ...zs });

    // pano de vidro da sala, no fundo da varanda, do piso ao teto
    glass.push({ ...at(bal.from, bal.to, bal.depth - 0.1, bal.depth - 0.06), ...zs, ...tag, part: "sala" });
    mullions(at, bal.from, bal.to, bal.depth - 0.14, bal.depth - 0.04, zs);
    for (const [a, b] of wings) {
      glass.push({ ...at(a, b, DIM.wing - 0.09, DIM.wing - 0.05), ...zs, ...tag, part: "quarto" });
      for (let s = a + DIM.fin / 2; s < b - 0.05; s += DIM.fin) {
        fins.push({ ...at(s - 0.03, s + 0.03, 0.03, DIM.wing - 0.13), ...zs, part: "brise" });
      }
    }

    // guarda-corpo de vidro com corrimão de bronze
    rails.push({ ...at(bal.from, bal.to, 0.04, 0.06), z0, z1: z0 + DIM.rail - 0.05, ...tag, part: "vidro" });
    rails.push({ ...at(bal.from, bal.to, 0, 0.1), z0: z0 + DIM.rail - 0.05, z1: z0 + DIM.rail, ...tag, part: "corrimao" });

    // divisória nas pontas da varanda que não encostam num quarto
    if (bal.from <= EPS) fins.push({ ...at(0, 0.07, 0, bal.depth), ...zs, part: "divisoria" });
    if (bal.to >= F - EPS) fins.push({ ...at(F - 0.07, F, 0, bal.depth), ...zs, part: "divisoria" });

    const bbox = { x0: u.x, y0: u.y, x1: u.x + u.w, y1: u.y + u.d, z0, z1 };
    units.push({
      id: u.id, floor: u.floor, plan: u.plan, status: u.status, facade: u.facade,
      azimuth: unitAzimuth(tower, u),
      bbox, body,
      center: [(bbox.x0 + bbox.x1) / 2, (bbox.y0 + bbox.y1) / 2, (z0 + z1) / 2],
    });
  }

  function mullions(at, a, b, v0, v1, zs) {
    const n = Math.max(1, Math.round((b - a) / DIM.mullion));
    for (let i = 0; i <= n; i++) {
      const s = a + ((b - a) * i) / n;
      const lo = Math.max(a, s - 0.03), hi = Math.min(b, s + 0.03);
      frames.push({ ...at(lo === a ? a : s - 0.03, hi === b ? b : s + 0.03, v0, v1), ...zs });
    }
  }

  /* ------------------------------------------- empenas laterais de brises -- */
  // As duas laterais da torre são uma cortina de brises do 2º andar à
  // cobertura. Atrás dela ficam as janelas laterais, os terraços técnicos e
  // as pontas do corredor.
  const zScreen0 = z2 - slabT, zScreen1 = zRoof + DIM.parapet;
  for (let y = DIM.fin / 2; y < D; y += DIM.fin) {
    fins.push({ x0: -DIM.screen, x1: -0.12, y0: y - 0.03, y1: y + 0.03, z0: zScreen0, z1: zScreen1, part: "empena" });
    fins.push({ x0: W + 0.12, x1: W + DIM.screen, y0: y - 0.03, y1: y + 0.03, z0: zScreen0, z1: zScreen1, part: "empena" });
  }
  // travessas que prendem os brises na altura de cada laje
  for (const s of slabs) {
    const z = (s.z0 + s.z1) / 2;
    fins.push({ x0: -0.14, x1: 0, y0: 0, y1: D, z0: z - 0.06, z1: z + 0.06, part: "travessa" });
    fins.push({ x0: W, x1: W + 0.14, y0: 0, y1: D, z0: z - 0.06, z1: z + 0.06, part: "travessa" });
  }

  /* -------------------------------------------------- núcleo e corredor -- */
  const c = tower.core;
  const zTop = zRoof + DIM.machine;
  core.push({ x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.d, z0: 0, z1: zTop, part: "nucleo" });
  roof.push({ x0: c.x - 0.25, y0: c.y - 0.25, x1: c.x + c.w + 0.25, y1: c.y + c.d + 0.25, z0: zTop, z1: zTop + 0.15, part: "tampa" });
  for (let f = 2; f <= tower.floors; f++) {
    const z0 = floorLevel(tower, f), z1 = z0 + DIM.ceiling;
    // vidro nas duas pontas do corredor
    glass.push({ x0: 0.1, x1: 0.14, y0: c.y, y1: c.y + c.d, z0, z1, part: "corredor" });
    glass.push({ x0: W - 0.14, x1: W - 0.1, y0: c.y, y1: c.y + c.d, z0, z1, part: "corredor" });
  }

  /* --------------------------------------------------------------- térreo -- */
  const zCeil = z2 - slabT;                        // fundo da laje do 2º andar
  const inset = 2.2;                               // o lobby recua sob a torre
  const L = { x0: inset, y0: inset, x1: W - inset, y1: D - inset };
  ground.push({ x0: -1.5, y0: -1.5, x1: W + 1.5, y1: D + 1.5, z0: 0, z1: 0.18, part: "piso" });
  ground.push({ x0: 0, y0: 0, x1: W, y1: D, z0: zCeil - 0.12, z1: zCeil, part: "forro" });
  ground.push({ x0: L.x0 + 0.3, y0: L.y0 + 0.3, x1: L.x1 - 0.3, y1: L.y1 - 0.3, z0: 0.18, z1: zCeil - 0.12, part: "lobby" });
  const gz = { z0: 0.18, z1: zCeil - 0.12 };
  ground.push({ x0: L.x0, x1: L.x1, y0: L.y0, y1: L.y0 + 0.05, ...gz, part: "vidro" });
  ground.push({ x0: L.x0, x1: L.x1, y0: L.y1 - 0.05, y1: L.y1, ...gz, part: "vidro" });
  ground.push({ x0: L.x0, x1: L.x0 + 0.05, y0: L.y0, y1: L.y1, ...gz, part: "vidro" });
  ground.push({ x0: L.x1 - 0.05, x1: L.x1, y0: L.y0, y1: L.y1, ...gz, part: "vidro" });
  // montantes do vidro do lobby, a cada ~1,7 m, nas quatro faces
  const nx = Math.round((L.x1 - L.x0) / 1.7), ny = Math.round((L.y1 - L.y0) / 1.7);
  for (let i = 0; i <= nx; i++) {
    const x = L.x0 + ((L.x1 - L.x0) * i) / nx;
    frames.push({ x0: x - 0.04, x1: x + 0.04, y0: L.y0 - 0.06, y1: L.y0 + 0.08, ...gz });
    frames.push({ x0: x - 0.04, x1: x + 0.04, y0: L.y1 - 0.08, y1: L.y1 + 0.06, ...gz });
  }
  for (let i = 0; i <= ny; i++) {
    const y = L.y0 + ((L.y1 - L.y0) * i) / ny;
    frames.push({ y0: y - 0.04, y1: y + 0.04, x0: L.x0 - 0.06, x1: L.x0 + 0.08, ...gz });
    frames.push({ y0: y - 0.04, y1: y + 0.04, x0: L.x1 - 0.08, x1: L.x1 + 0.06, ...gz });
  }
  // marquise e portal de entrada, no meio da frente
  const mx = W / 2;
  ground.push({ x0: mx - 3.2, x1: mx + 3.2, y0: -2.6, y1: L.y0 + 0.4, z0: 3.3, z1: 3.5, part: "marquise" });
  ground.push({ x0: mx - 1.6, x1: mx - 1.45, y0: L.y0 - 0.2, y1: L.y0 + 0.1, z0: 0.18, z1: 3.3, part: "portal" });
  ground.push({ x0: mx + 1.45, x1: mx + 1.6, y0: L.y0 - 0.2, y1: L.y0 + 0.1, z0: 0.18, z1: 3.3, part: "portal" });
  // pilares na borda da laje: o térreo é um pilotis de pé-direito duplo
  const px = [0.45, W / 3, (2 * W) / 3, W - 0.45], py = [0.45, D * 0.35, D * 0.65, D - 0.45];
  for (const x of px) for (const y of py) {
    const edge = x === px[0] || x === px[3] || y === py[0] || y === py[3];
    if (!edge) continue;
    columns.push({ x0: x - 0.35, x1: x + 0.35, y0: y - 0.35, y1: y + 0.35, z0: 0.18, z1: zCeil - 0.12 });
  }

  /* ------------------------------------------------------------ cobertura -- */
  const zr = zRoof;
  const pz = { z0: zr, z1: zr + DIM.parapet };
  roof.push({ x0: 0, x1: W, y0: 0.04, y1: 0.08, ...pz, part: "vidro" });
  roof.push({ x0: 0, x1: W, y0: D - 0.08, y1: D - 0.04, ...pz, part: "vidro" });
  roof.push({ x0: 0, x1: W, y0: 0, y1: 0.12, z0: pz.z1, z1: pz.z1 + 0.05, part: "corrimao" });
  roof.push({ x0: 0, x1: W, y0: D - 0.12, y1: D, z0: pz.z1, z1: pz.z1 + 0.05, part: "corrimao" });
  // piscina na frente (a face de sol), com deck de madeira em volta
  roof.push({ x0: 0.8, x1: W - 0.8, y0: 0.8, y1: c.y - 0.6, z0: zr, z1: zr + 0.1, part: "deck" });
  roof.push({ x0: 2.6, x1: W - 2.6, y0: 1.8, y1: 5.8, z0: zr + 0.1, z1: zr + 0.22, part: "borda" });
  roof.push({ x0: 2.9, x1: W - 2.9, y0: 2.1, y1: 5.5, z0: zr + 0.1, z1: zr + 0.26, part: "agua" });
  // lounge sob pergolado, nos fundos
  const P = { x0: 2.2, x1: W - 2.2, y0: c.y + c.d + 1.2, y1: D - 1.6 };
  roof.push({ x0: P.x0 - 0.6, x1: P.x1 + 0.6, y0: P.y0 - 0.6, y1: P.y1 + 0.6, z0: zr, z1: zr + 0.1, part: "deck" });
  for (const x of [P.x0, (P.x0 + P.x1) / 2, P.x1]) for (const y of [P.y0, P.y1]) {
    roof.push({ x0: x - 0.09, x1: x + 0.09, y0: y - 0.09, y1: y + 0.09, z0: zr + 0.1, z1: zr + 2.7, part: "pergolado" });
  }
  for (const y of [P.y0, P.y1]) roof.push({ x0: P.x0 - 0.3, x1: P.x1 + 0.3, y0: y - 0.09, y1: y + 0.09, z0: zr + 2.7, z1: zr + 2.9, part: "pergolado" });
  for (let x = P.x0; x <= P.x1 + EPS; x += 0.45) {
    roof.push({ x0: x - 0.04, x1: x + 0.04, y0: P.y0 - 0.35, y1: P.y1 + 0.35, z0: zr + 2.9, z1: zr + 3.04, part: "ripa" });
  }
  // canteiros ao longo das laterais
  for (const [x0, x1] of [[0.25, 1.15], [W - 1.15, W - 0.25]]) {
    for (const [y0, y1] of [[0.9, c.y - 0.8], [c.y + c.d + 0.8, D - 0.9]]) {
      roof.push({ x0, x1, y0, y1, z0: zr, z1: zr + 0.55, part: "canteiro" });
      roof.push({ x0: x0 + 0.08, x1: x1 - 0.08, y0: y0 + 0.08, y1: y1 - 0.08, z0: zr + 0.55, z1: zr + 1.35, part: "verde" });
    }
  }

  const top = zTop + 0.15;
  return {
    w: W, d: D, north: tower.north || 0, floors: tower.floors,
    roofLevel: zRoof, top,
    slabs, units, glass, frames, rails, fins, columns, core, ground, roof, levels,
    bounds: { x0: -DIM.screen, y0: 0, x1: W + DIM.screen, y1: D, z0: 0, z1: top },
  };
}

/* --------------------------------------------------------------- entorno -- */

/**
 * Entorno discreto, só para dar escala: calçada, rua, vizinhos baixos e
 * árvores. Posições fixas (nada sorteado a cada carga).
 * @returns {{ pads: object[], neighbors: object[], trees: { x, y, h, r }[], radius: number }}
 */
export function buildSite(tower) {
  const { w: W, d: D } = tower.slab;
  const pads = [
    { x0: -9, y0: -13, x1: W + 9, y1: D + 9, z0: 0, z1: 0.06, part: "praca" },
    { x0: -160, y0: -27, x1: W + 160, y1: -16, z0: 0, z1: 0.03, part: "rua" },
    { x0: -160, y0: -16, x1: W + 160, y1: -13, z0: 0, z1: 0.09, part: "calcada" },
    { x0: -160, y0: -30, x1: W + 160, y1: -27, z0: 0, z1: 0.09, part: "calcada" },
  ];
  // vizinhos: casas e predinhos de até cinco andares, sempre bem abaixo da torre
  const N = (x, y, w, d, h) => ({ x0: x, y0: y, x1: x + w, y1: y + d, z0: 0, z1: h });
  const neighbors = [
    N(-52, -8, 24, 15, 9.5), N(-47, 14, 18, 20, 6.5), N(-78, 2, 16, 26, 12.5),
    N(W + 21, -9, 20, 14, 7), N(W + 27, 12, 26, 16, 13), N(W + 60, -6, 18, 30, 9),
    N(-30, D + 28, 20, 16, 8), N(-4, D + 36, 24, 18, 11), N(W + 48, D + 44, 22, 14, 6.5),
    N(-58, D + 44, 30, 16, 10),
    N(-64, -62, 26, 18, 8), N(2, -60, 20, 16, 12), N(30, -66, 30, 20, 6.5), N(68, -60, 22, 18, 10),
    N(-110, -56, 24, 22, 14), N(100, -62, 26, 20, 7.5), N(W + 92, 20, 24, 24, 11), N(-118, 30, 26, 22, 7),
  ];
  const trees = [];
  // fileira na calçada da frente e maciços nos cantos do terreno
  // (menos em frente à entrada, para a árvore não tapar a marquise)
  for (let i = 0; i < 9; i++) {
    const x = -41 + i * 12.5;
    if (Math.abs(x - W / 2) < 7) continue;
    trees.push({ x, y: -14.5, h: 6.2 + (i % 3) * 0.7, r: 2.3 + (i % 2) * 0.35 });
  }
  const clumps = [
    [-6.5, -8, 7.4, 2.8], [-5.5, 3.5, 6.4, 2.4], [W + 6.2, -7.5, 7, 2.7], [W + 5.6, 5, 6.6, 2.5],
    [-6, D + 4.5, 7.8, 3], [3.5, D + 6, 6.2, 2.4], [W + 5.5, D + 5, 7.2, 2.8], [W - 3, D + 6.2, 6, 2.3],
    [-14, 12, 8.2, 3.1], [W + 14, 16, 7.6, 2.9], [-24, D + 14, 7, 2.7], [W + 34, D + 14, 6.8, 2.6],
    [-40, -38, 7.2, 2.8], [44, -38, 6.6, 2.6], [W + 46, D + 16, 7.4, 2.9],
  ];
  for (const [x, y, h, r] of clumps) trees.push({ x, y, h, r });
  return { pads, neighbors, trees, radius: 520 };
}

/* ------------------------------------------------------- vista da varanda -- */

/** Altura dos olhos de quem está em pé na varanda, a partir do piso. */
export const EYE_HEIGHT = 1.6;

/**
 * Onde ficam os olhos de quem está em pé na varanda da unidade: no meio do
 * trecho da varanda (planBalcony from/to, com flip e fachada resolvidos pelo
 * mesmo placer do modelo), recuado do guarda-corpo. As varandas têm de 1,4 a
 * 2,2 m de profundidade: o recuo é metade dela, no máximo 0,8 m, para o
 * corrimão aparecer embaixo sem a pessoa ficar encostada no vidro da sala.
 *
 * @returns {{ x: number, y: number, z: number, azimuth: number,
 *             normal: [number, number], back: number } | null}
 *          x, y, z no sistema da laje; normal aponta para fora da fachada;
 *          back é o recuo em relação à borda da laje. null se a planta não
 *          existe ou não tem varanda, ou se a fachada da unidade é desconhecida.
 */
export function balconyEye(tower, unit, plans) {
  // fachada desconhecida não tem normal nem azimute: sem isso sairia um olho com NaN
  if (!unit || !Object.hasOwn(FACADES, unit.facade)) return null;
  const plan = planOf(unit, plans);
  const bal = plan && planBalcony(plan);
  if (!bal) return null;
  const mid = (bal.from + bal.to) / 2;
  const back = Math.min(0.8, bal.depth / 2);
  const p = placer(unit, bal.frontage)(mid, mid, back, back);
  return {
    x: p.x0, y: p.y0, z: floorLevel(tower, unit.floor) + EYE_HEIGHT,
    azimuth: unitAzimuth(tower, unit),
    normal: facadeNormal(unit.facade),
    back,
  };
}

/**
 * A unidade vizinha na mesma fachada, "step" andares acima (+1) ou abaixo
 * (-1). As tipologias mudam por faixa de andares, então nem sempre há uma
 * unidade exatamente em cima: vale a de centro mais próximo ao longo da
 * fachada (no empate, a de número menor). null no topo, na base e em andar
 * sem apartamento nessa fachada.
 */
export function stackedUnit(tower, unit, step) {
  const floor = unit.floor + step;
  const lateral = unit.facade === "direita" || unit.facade === "esquerda";
  const along = (u) => (lateral ? u.y + u.d / 2 : u.x + u.w / 2);
  const here = along(unit);
  let best = null, bestD = Infinity;
  for (const u of tower.units) {
    if (u.floor !== floor || u.facade !== unit.facade) continue;
    const d = Math.abs(along(u) - here);
    if (d < bestD - EPS || (Math.abs(d - bestD) <= EPS && best && u.id < best.id)) { best = u; bestD = d; }
  }
  return best;
}

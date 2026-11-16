// Dados da vista da varanda: onde ficam os olhos (balconyEye) e qual unidade
// está em cima/embaixo (stackedUnit). Módulos puros: roda no Node, sem navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tower } from "../data/tower.js";
import { plans } from "../data/plans.js";
import { balconyEye, stackedUnit, planBalcony, floorLevel, facadeAzimuth, FACADES, DIM, EYE_HEIGHT } from "../tour/tower.js";

const EPS = 1e-9;
const byId = (id) => tower.units.find((u) => u.id === id);
const planOf = (id) => plans.find((p) => p.id === id);
const clone = (x) => structuredClone(x);
const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); }); return Object.freeze(o); };
const zero = (v) => v + 0;                       // -0 vira 0, para o deepEqual estrito
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} x ${b}`);

// Normal esperada de cada fachada, no sistema da laje (x para a direita, y para baixo, frente em y = 0).
const NORMAL = { frente: [0, -1], direita: [1, 0], fundos: [0, 1], esquerda: [-1, 0] };

// Quanto de planta é varanda, escrito à mão a partir de data/plans.js (meio do trecho e profundidade).
const VARANDA = { "studio": { mid: 2.5, depth: 1.4 }, "dois-quartos": { mid: 2.5, depth: 1.5 }, "tres-suites": { mid: 3.75, depth: 2.2 } };

/** Posição esperada, calculada pelo avesso: do lado da fachada para dentro, sem usar o placer do código. */
function esperado(u) {
  const plan = planOf(u.plan);
  const b = planBalcony(plan);
  const mid = (b.from + b.to) / 2;
  const s = u.flip ? b.frontage - mid : mid;           // distância ao longo da fachada, no sentido horário visto de cima
  const back = Math.min(0.8, b.depth / 2);
  switch (u.facade) {
    case "frente": return { x: u.x + s, y: u.y + back };
    case "direita": return { x: u.x + u.w - back, y: u.y + s };
    case "fundos": return { x: u.x + u.w - s, y: u.y + u.d - back };
    default: return { x: u.x + back, y: u.y + u.d - s };   // esquerda
  }
}

/** Unidade sintética numa fachada lateral (a torre real só tem frente e fundos). */
const lateral = (facade, plan, flip, extra = {}) => {
  const p = planOf(plan);
  const t = plan === "studio" ? { w: 7.6, d: 5 } : { w: 8, d: 9 };    // w = profundidade, d = testada
  assert.ok(Math.abs(t.d - planBalcony(p).frontage) < 1e-9);
  return { id: 399, floor: 3, plan, status: "disponivel", facade, flip, x: facade === "direita" ? 18 - t.w : 0, y: 2, ...t, ...extra };
};

/* ------------------------------------------------------------ balconyEye -- */

test("balconyEye: devolve um olho para TODAS as 62 unidades, sem NaN", () => {
  assert.equal(tower.units.length, 62);
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans);
    assert.ok(e, `unidade ${u.id}: sem olho`);
    for (const k of ["x", "y", "z", "azimuth", "back"]) assert.ok(Number.isFinite(e[k]), `${u.id}: ${k} = ${e[k]}`);
    assert.equal(e.normal.length, 2);
    assert.ok(e.normal.every(Number.isFinite), `${u.id}: normal ${e.normal}`);
  }
});

test("balconyEye: o olho fica dentro do retângulo da unidade, em todas as unidades", () => {
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans);
    assert.ok(e.x > u.x + EPS && e.x < u.x + u.w - EPS, `${u.id}: x ${e.x} fora de ${u.x}..${u.x + u.w}`);
    assert.ok(e.y > u.y + EPS && e.y < u.y + u.d - EPS, `${u.id}: y ${e.y} fora de ${u.y}..${u.y + u.d}`);
  }
});

test("balconyEye: o olho está do lado da fachada, recuado min(0,8, profundidade/2) da borda da laje", () => {
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans);
    const v = VARANDA[u.plan];
    const recuo = Math.min(0.8, v.depth / 2);
    close(e.back, recuo, `${u.id}: back`);
    assert.ok(e.back > 0 && e.back <= 0.8 + EPS && e.back <= v.depth, `${u.id}: recuo ${e.back} fora do intervalo`);
    // distância do olho à borda da fachada
    const [nx, ny] = NORMAL[u.facade];
    const borda = nx > 0 ? u.x + u.w - e.x : nx < 0 ? e.x - u.x : ny > 0 ? u.y + u.d - e.y : e.y - u.y;
    close(borda, recuo, `${u.id} (${u.facade}): distância à fachada`);
    // e fica do mesmo lado da fachada que o centro da unidade não está
    const centro = [u.x + u.w / 2, u.y + u.d / 2];
    assert.ok((e.x - centro[0]) * nx + (e.y - centro[1]) * ny > 0, `${u.id}: olho no lado errado da unidade`);
  }
});

test("balconyEye: posição ao longo da fachada = meio do trecho da varanda, com flip (esperado calculado à parte)", () => {
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans), x = esperado(u);
    close(e.x, x.x, `${u.id} x`);
    close(e.y, x.y, `${u.id} y`);
  }
});

test("balconyEye: casos conhecidos, escritos à mão", () => {
  // 1302: três suítes nos fundos, varanda de 0 a 7,5 numa testada de 15,5, sem flip
  let e = balconyEye(tower, byId(1302), plans);
  close(e.x, 13, "1302 x"); close(e.y, 19.2, "1302 y"); close(e.z, 6.2 + 11 * 3.1 + 1.6, "1302 z"); close(e.back, 0.8, "1302 back");
  // 702: dois-quartos na frente COM flip: o meio (2,5 de 9) vira 6,5 a partir da esquerda da unidade
  e = balconyEye(tower, byId(702), plans);
  close(e.x, 15.5, "702 x"); close(e.y, 0.75, "702 y");
  // 701, o mesmo sem flip
  e = balconyEye(tower, byId(701), plans);
  close(e.x, 2.5, "701 x"); close(e.y, 0.75, "701 y");
  // 203: studio na frente, sempre no centro da testada
  e = balconyEye(tower, byId(203), plans);
  close(e.x, 14, "203 x"); close(e.y, 0.7, "203 y");
  // 704 e 703 (flip) nos fundos: espelhados entre si
  close(balconyEye(tower, byId(704), plans).x, 15.5, "704 x");
  close(balconyEye(tower, byId(703), plans).x, 2.5, "703 x");
  close(balconyEye(tower, byId(703), plans).y, 19.25, "703 y");
});

test("balconyEye: flip espelha a posição ao longo da fachada e mantém a profundidade", () => {
  let moveu = 0;
  for (const u of tower.units) {
    const a = balconyEye(tower, { ...u, flip: false }, plans), b = balconyEye(tower, { ...u, flip: true }, plans);
    const alongX = u.facade === "frente" || u.facade === "fundos";
    const [ua, ub, cu] = alongX ? [a.x, b.x, u.x + u.w / 2] : [a.y, b.y, u.y + u.d / 2];
    close(ua + ub, 2 * cu, `${u.id}: flip não espelha em torno do centro da unidade`);
    const [pa, pb] = alongX ? [a.y, b.y] : [a.x, b.x];
    close(pa, pb, `${u.id}: flip mudou a profundidade`);
    close(a.z, b.z, `${u.id}: flip mudou a altura`);
    if (Math.abs(ua - ub) > 0.5) moveu++;
  }
  assert.ok(moveu > 0, "flip nunca mudou nada: o espelhamento não está sendo aplicado");
  // nos dois-quartos o meio da varanda (2,5 de 9) está longe do centro: o flip tem de mexer mesmo
  const u = byId(701);
  assert.ok(Math.abs(balconyEye(tower, { ...u, flip: true }, plans).x - balconyEye(tower, { ...u, flip: false }, plans).x) > 3);
});

test("balconyEye: altura = piso do andar + 1,6 m e fica dentro do andar", () => {
  assert.equal(EYE_HEIGHT, 1.6);
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans);
    close(e.z, floorLevel(tower, u.floor) + 1.6, `${u.id}: z`);
    assert.ok(e.z > floorLevel(tower, u.floor) && e.z < floorLevel(tower, u.floor) + DIM.ceiling, `${u.id}: z ${e.z} fora do pé-direito`);
    assert.ok(e.z < floorLevel(tower, u.floor + 1), `${u.id}: olho acima do piso de cima`);
  }
  // cada andar sobe um piso a piso
  close(balconyEye(tower, byId(302), plans).z - balconyEye(tower, byId(202), plans).z, 3.1, "piso a piso");
});

test("balconyEye: normal e azimute coerentes com a fachada", () => {
  for (const u of tower.units) {
    const e = balconyEye(tower, u, plans);
    assert.deepEqual(e.normal.map(zero), NORMAL[u.facade], `${u.id}: normal`);
    close(Math.hypot(...e.normal), 1, `${u.id}: normal não é unitária`);
    close(e.azimuth, facadeAzimuth(tower, u.facade), `${u.id}: azimute`);
  }
  // com o norte em 0, a frente olha para 0 e os fundos para 180
  assert.equal(balconyEye(tower, byId(1301), plans).azimuth, 0);
  assert.equal(balconyEye(tower, byId(1302), plans).azimuth, 180);
});

test("balconyEye: o azimute acompanha o 'north' da torre; a normal, não", () => {
  const t = clone(tower);
  t.north = 30;
  const f = balconyEye(t, t.units.find((u) => u.id === 1301), plans), b = balconyEye(t, t.units.find((u) => u.id === 1302), plans);
  close(f.azimuth, 330, "frente com north 30");
  close(b.azimuth, 150, "fundos com north 30");
  assert.deepEqual(f.normal.map(zero), [0, -1]);
  assert.deepEqual(b.normal.map(zero), [0, 1]);
});

test("balconyEye: fachadas laterais (direita e esquerda), com e sem flip", () => {
  const casos = [
    // facade, flip, normal, x esperado, y esperado   (dois-quartos: testada 9 em y, meio 2,5, recuo 0,75)
    ["direita", false, [1, 0], 18 - 0.75, 2 + 2.5],
    ["direita", true, [1, 0], 18 - 0.75, 2 + 6.5],
    ["esquerda", false, [-1, 0], 0.75, 2 + 9 - 2.5],
    ["esquerda", true, [-1, 0], 0.75, 2 + 2.5],
  ];
  for (const [facade, flip, normal, x, y] of casos) {
    const u = lateral(facade, "dois-quartos", flip);
    const t = { ...tower, units: [u] };
    const e = balconyEye(t, u, plans);
    assert.ok(e, `${facade}`);
    close(e.x, x, `${facade} flip=${flip} x`);
    close(e.y, y, `${facade} flip=${flip} y`);
    assert.deepEqual(e.normal.map(zero), normal, `${facade} normal`);
    assert.ok(Math.abs(e.azimuth - FACADES[facade]) < 1e-9, `${facade}: azimute ${e.azimuth}`);
    close(e.z, floorLevel(tower, 3) + 1.6, `${facade} z`);
  }
  // studio: a varanda é o lado direito da planta; numa fachada lateral ela segue a regra geral
  const s = lateral("direita", "studio", false);
  const e = balconyEye(tower, s, plans);
  close(e.x, 18 - 0.7, "studio direita x"); close(e.y, 2 + 2.5, "studio direita y");
});

test("balconyEye: não muda os argumentos e devolve um objeto novo a cada chamada", () => {
  const t = deepFreeze(clone(tower)), p = deepFreeze(clone(plans));
  const u = t.units.find((x) => x.id === 702);
  const a = balconyEye(t, u, p), b = balconyEye(t, u, p);
  assert.deepEqual(a, b, "mesma entrada, resultados diferentes");
  assert.notEqual(a, b);
  a.x = 999; a.normal[0] = 7;
  assert.notEqual(balconyEye(t, u, p).x, 999);
  assert.notEqual(balconyEye(t, u, p).normal[0], 7, "a normal devolvida é compartilhada entre chamadas");
});

test("balconyEye: planta inexistente, lista de plantas vazia ou planta sem varanda devolvem null", () => {
  const u = byId(1302);
  assert.equal(balconyEye(tower, { ...u, plan: "penthouse" }, plans), null);
  assert.equal(balconyEye(tower, u, []), null);
  const semDeck = clone(plans).map((p) => ({ ...p, rooms: p.rooms.map((r) => ({ ...r, floor: r.floor === "deck" ? "madeira" : r.floor })) }));
  assert.equal(balconyEye(tower, u, semDeck), null, "planta sem cômodo deck");
  const semRooms = clone(plans).map((p) => ({ ...p, rooms: [] }));
  assert.equal(balconyEye(tower, u, semRooms), null);
  // as outras unidades continuam funcionando com a planta que existe
  assert.ok(balconyEye(tower, byId(201), plans));
});

test("balconyEye: fachada desconhecida devolve null, inclusive nomes herdados de Object (toString, constructor)", () => {
  for (const facade of ["norte", "", undefined, null, "toString", "constructor", "hasOwnProperty", "__proto__", "Frente"]) {
    assert.equal(balconyEye(tower, { ...byId(1302), facade }, plans), null, `fachada ${JSON.stringify(facade)}`);
  }
});

test("facadeNormal e facadeAzimuth: fachada desconhecida lança erro em vez de devolver NaN; as quatro conhecidas funcionam", async () => {
  const { facadeNormal, facadeAzimuth, checkTower, FACADES } = await import("../tour/tower.js");
  for (const facade of ["norte", "", undefined, null, "toString", "constructor", "__proto__"]) {
    assert.throws(() => facadeNormal(facade), /fachada desconhecida/, `facadeNormal(${JSON.stringify(facade)})`);
    assert.throws(() => facadeAzimuth(tower, facade), /fachada desconhecida/, `facadeAzimuth(${JSON.stringify(facade)})`);
  }
  for (const facade of Object.keys(FACADES)) {
    assert.ok(facadeNormal(facade).every(Number.isFinite));
    assert.ok(Number.isFinite(facadeAzimuth(tower, facade)));
  }
  // checkTower acusa a fachada (e o status) com nome herdado, sem lançar
  const ruim = { ...tower, units: tower.units.map((u, i) => (i === 0 ? { ...u, facade: "toString" } : i === 1 ? { ...u, status: "constructor" } : u)) };
  const problemas = checkTower(ruim, plans);
  assert.ok(problemas.some((m) => /fachada "toString" desconhecida/.test(m)), problemas.join("\n"));
  assert.ok(problemas.some((m) => /status "constructor" desconhecido/.test(m)), problemas.join("\n"));
});

test("balconyEye: unidade ausente (null/undefined) ou lista de plantas ausente não devolve lixo", () => {
  for (const args of [[tower, null, plans], [tower, undefined, plans], [tower, byId(201), undefined], [tower, byId(201), null]]) {
    let r;
    try { r = balconyEye(...args); } catch (e) { assert.ok(e instanceof Error); continue; }
    assert.equal(r, null, `devia ser null ou lançar erro, devolveu ${JSON.stringify(r)}`);
  }
});

/* ----------------------------------------------------------- stackedUnit -- */

const ids = (list) => list.map((u) => u.id);

test("stackedUnit: no topo (andar 16, para cima) e na base (andar 2, para baixo) devolve null", () => {
  for (const u of tower.units.filter((x) => x.floor === 16)) assert.equal(stackedUnit(tower, u, 1), null, `${u.id} para cima`);
  for (const u of tower.units.filter((x) => x.floor === 2)) assert.equal(stackedUnit(tower, u, -1), null, `${u.id} para baixo`);
  // e o contrário funciona
  for (const u of tower.units.filter((x) => x.floor === 16)) assert.ok(stackedUnit(tower, u, -1));
  for (const u of tower.units.filter((x) => x.floor === 2)) assert.ok(stackedUnit(tower, u, 1));
});

test("stackedUnit: sempre no andar vizinho e na MESMA fachada, e é uma unidade da torre", () => {
  for (const u of tower.units) for (const step of [1, -1]) {
    const to = stackedUnit(tower, u, step);
    if (u.floor + step < 2 || u.floor + step > 16) { assert.equal(to, null, `${u.id} step ${step}`); continue; }
    assert.ok(to, `${u.id} step ${step}: sem unidade`);
    assert.equal(to.floor, u.floor + step, `${u.id} step ${step}`);
    assert.equal(to.facade, u.facade, `${u.id} step ${step}: mudou de fachada`);
    assert.ok(tower.units.includes(to));
    assert.notEqual(to.id, u.id);
  }
});

test("stackedUnit: dentro da mesma tipologia o vizinho é o que está exatamente em cima", () => {
  for (const u of tower.units) for (const step of [1, -1]) {
    const to = stackedUnit(tower, u, step);
    if (!to || to.plan !== u.plan) continue;
    close(to.x + to.w / 2, u.x + u.w / 2, `${u.id} -> ${to.id}: centros diferentes no eixo x`);
    assert.equal(to.id % 100, u.id % 100, `${u.id} -> ${to.id}: final diferente`);
  }
  // exemplos conhecidos
  assert.equal(stackedUnit(tower, byId(301), 1).id, 401);
  assert.equal(stackedUnit(tower, byId(302), -1).id, 202);
  assert.equal(stackedUnit(tower, byId(1004), 1).id, 1104);
  assert.equal(stackedUnit(tower, byId(1502), 1).id, 1602);
});

test("stackedUnit: troca de tipologia entre faixas escolhe o centro mais próximo (6 -> 7, 12 -> 13)", () => {
  // studios (centros x 4, 9, 14) para dois-quartos (centros 4,5 e 13,5)
  assert.equal(stackedUnit(tower, byId(601), 1).id, 701, "601: centro 4 -> 4,5");
  assert.equal(stackedUnit(tower, byId(603), 1).id, 702, "603: centro 14 -> 13,5");
  // dois-quartos (4,5 e 13,5) para três suítes (um só, centro 9)
  assert.equal(stackedUnit(tower, byId(1201), 1).id, 1301);
  assert.equal(stackedUnit(tower, byId(1202), 1).id, 1301);
  // nos fundos: dois-quartos 703/704 de baixo, 704 mais perto de 1302? só há um: 1302
  assert.equal(stackedUnit(tower, byId(1203), 1).id, 1302);
  assert.equal(stackedUnit(tower, byId(1204), 1).id, 1302);
  // para baixo
  assert.equal(stackedUnit(tower, byId(701), -1).id, 601);
  assert.equal(stackedUnit(tower, byId(702), -1).id, 603);
  assert.equal(stackedUnit(tower, byId(1301), -1).id, 1201, "1301 (centro 9) está a 4,5 de 1201 e de 1202: empate -> 1201");
  assert.equal(stackedUnit(tower, byId(1302), -1).id, 1203, "mesmo empate nos fundos -> 1203");
  // a tipologia mudou de verdade
  assert.notEqual(stackedUnit(tower, byId(601), 1).plan, byId(601).plan);
});

test("stackedUnit: empate de distância vai para o número menor", () => {
  // 602 (studio, centro x = 9) está a 4,5 de 701 (4,5) e de 702 (13,5): vence o 701
  assert.equal(stackedUnit(tower, byId(602), 1).id, 701);
  assert.equal(stackedUnit(tower, byId(605), 1).id, 703, "o mesmo nos fundos");
  // o resultado não depende da ordem das unidades nos dados
  for (const ordem of [(a, b) => a.id - b.id, (a, b) => b.id - a.id]) {
    const t = { ...tower, units: [...tower.units].sort(ordem) };
    assert.equal(stackedUnit(t, byId(602), 1).id, 701, "ordem dos dados mudou o desempate");
    assert.equal(stackedUnit(t, byId(1301), -1).id, 1201);
  }
});

test("stackedUnit: ida e volta cai na mesma fachada e, dentro da tipologia, na mesma unidade", () => {
  for (const u of tower.units) {
    const up = stackedUnit(tower, u, 1);
    if (!up) continue;
    const down = stackedUnit(tower, up, -1);
    assert.ok(down, `${u.id}: sem volta`);
    assert.equal(down.floor, u.floor);
    assert.equal(down.facade, u.facade);
    if (up.plan === u.plan) assert.equal(down.id, u.id, `${u.id} -> ${up.id} -> ${down.id}`);
  }
  for (const u of tower.units) {
    const dn = stackedUnit(tower, u, -1);
    if (!dn) continue;
    const back = stackedUnit(tower, dn, 1);
    assert.equal(back.floor, u.floor);
    assert.equal(back.facade, u.facade);
    if (dn.plan === u.plan) assert.equal(back.id, u.id);
  }
});

test("stackedUnit: subir do 2º ao 16º andar passa por todos os andares, sem pular nem repetir", () => {
  for (const start of tower.units.filter((u) => u.floor === 2)) {
    const trilha = [start];
    for (let u = stackedUnit(tower, start, 1); u; u = stackedUnit(tower, u, 1)) trilha.push(u);
    assert.deepEqual(trilha.map((u) => u.floor), Array.from({ length: 15 }, (_, i) => i + 2), `partindo de ${start.id}: ${ids(trilha)}`);
    assert.ok(trilha.every((u) => u.facade === start.facade));
  }
});

test("stackedUnit: andar vizinho sem apartamento na fachada devolve null", () => {
  const t = clone(tower);
  t.units = t.units.filter((u) => !(u.floor === 5 && u.facade === "frente"));
  const u = (id) => t.units.find((x) => x.id === id);
  assert.equal(u(503), undefined, "controle: a frente do andar 5 foi mesmo removida");
  assert.equal(stackedUnit(t, u(403), 1), null, "o andar 5 não tem frente");
  assert.equal(stackedUnit(t, u(601), -1), null, "e o 6 não alcança o 5");
  // a outra fachada do mesmo andar continua alcançável
  assert.equal(stackedUnit(t, u(404), 1).id, 504);
  assert.equal(stackedUnit(t, u(604), -1).id, 504);
});

test("stackedUnit: fachadas laterais medem a distância ao longo de y", () => {
  // direita, andar 3: centro y = 2 + 4,5 = 6,5; no andar 4 há duas candidatas, uma em y 0..9 (centro 4,5) e outra em y 9..18 (centro 13,5)
  const mk = (id, floor, y, facade = "direita") => ({ id, floor, plan: "dois-quartos", status: "disponivel", facade, flip: false, x: 10, y, w: 8, d: 9 });
  const base = mk(301, 3, 2);
  const t = { ...tower, units: [base, mk(401, 4, 0), mk(402, 4, 9), mk(403, 4, 0, "esquerda")] };
  assert.equal(stackedUnit(t, base, 1).id, 401, "centro y 4,5 está a 2 de 6,5; 13,5 está a 7");
  const t2 = { ...tower, units: [base, mk(401, 4, 6), mk(402, 4, 0)] };
  assert.equal(stackedUnit(t2, base, 1).id, 402, "centro y 10,5 está a 4 de 6,5; 4,5 está a 2");
});

test("stackedUnit: não muda os argumentos", () => {
  const t = deepFreeze(clone(tower));
  const u = t.units.find((x) => x.id === 602);
  assert.equal(stackedUnit(t, u, 1).id, 701);
  assert.equal(stackedUnit(t, u, -1).id, 502);
});

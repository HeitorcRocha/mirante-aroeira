/* ============================================================================
   Mirante Aroeira: espelho de vendas (espelho.html).

   A torre inteira em 3D, com uma unidade clicável por apartamento, a grade de
   unidades por andar no painel e o mesmo controle de sol do tour.

   Como no tour, este arquivo é a única parte que conhece o three.js. A torre
   vem de data/tower.js, a geometria e as contas de orientação e sol de
   tour/tower.js e tour/sun.js (módulos puros, que rodam no Node).

   Eixos: a laje usa x para a direita e y para baixo, em metros, com a frente
   da torre em y = 0. Na cena, X = x da laje, Z = y da laje e Y = altura, a
   mesma conversão do tour.
   ========================================================================== */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { plans, fmtArea } from "../data/plans.js";
import { tower } from "../data/tower.js";
import {
  buildTower, buildSite, checkTower, countUnits, planOf, planAzimuth, facadeNormal, facadeAzimuth,
  unitCardinal, unitSunlit, unitSunHours, unitLabel, STATUS_LABEL, SUN_GRID,
} from "./tower.js";
import { sunPosition, sunDirection, cardinal, formatHour, MONTHS } from "./sun.js";
import {
  clamp, lerp, ease, cssVar, reduceMotion, coarsePointer,
  skyColor, sunColor, sunStrength, daylight, needleAngle, fillMonths, describeSun,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const ui = {
  scene: $("e-scene"), canvas: $("e-canvas"), status: $("e-status"), fallback: $("e-fallback"),
  hint: $("e-hint"), compass: $("e-compass"), dial: $("e-compass-dial"), views: $("e-views"),
  panel: $("e-panel"), resumo: $("e-resumo"), drawer: $("e-drawer"), body: $("e-drawer-body"),
  ficha: $("e-ficha"), fichaVazia: $("e-ficha-vazia"), fichaCorpo: $("e-ficha-corpo"),
  fNum: $("e-f-num"), fStatus: $("e-f-status"), fTipo: $("e-f-tipo"), fArea: $("e-f-area"),
  fAndar: $("e-f-andar"), fVaranda: $("e-f-varanda"), fSol: $("e-f-sol"), fAgora: $("e-f-agora"),
  fTour: $("e-f-tour"), fVisita: $("e-f-visita"), fNota: $("e-f-nota"),
  avail: $("e-avail"), tipo: $("e-tipo"), legend: $("e-legend"), heads: $("e-heads"), grid: $("e-grid"),
  hour: $("e-hour"), month: $("e-month"), hourOut: $("e-hour-out"), sunOut: $("e-sun-out"),
};

const BRAND = "Mirante Aroeira";
const FOV = 35;
const STATUS_ORDER = ["disponivel", "reservada", "vendida"];
const PLURAL = { disponivel: "disponíveis", reservada: "reservadas", vendida: "vendidas" };
const VIEWS = {
  // theta é medido a partir de quem olha a frente da torre de frente; phi a partir da vertical
  fachada: { facade: "frente", turn: 0.5, phi: 1.43, label: "Vista da fachada da frente" },
  fundos: { facade: "fundos", turn: 0.5, phi: 1.43, label: "Vista da fachada dos fundos" },
  aerea: { facade: "frente", turn: 0.75, phi: 0.74, label: "Vista aérea" },
};

const unitById = new Map(tower.units.map((u) => [u.id, u]));

/* ------------------------------------------------------------- estado -- */
const state = {
  selected: null,           // id da unidade escolhida
  hover: null,              // id sob o mouse
  avail: true,              // coloração por status ligada?
  filter: "",               // id da tipologia em destaque ("" = todas)
  hour: 10, month: 6,
  view: "fachada",          // vista pronta em uso (null depois que o visitante mexe)
  userMoved: false,
};

function fromUrl() {
  const q = new URLSearchParams(location.search);
  const rawId = q.get("unidade") || "";
  const id = /^\d{3,4}$/.test(rawId) ? Number(rawId) : NaN;   // só dígitos: nada de "0x516" ou "1302.0"
  if (unitById.has(id)) state.selected = id;
  const plan = q.get("planta");
  if (tower.bands.some((b) => b.plan === plan)) state.filter = plan;
}

let renderer = null;

/* ----------------------------------------------------- ícones de status -- */
// Um desenho por status (ponto cheio, meio círculo, xis): o status não é
// comunicado só pela cor.
const ICON = {
  disponivel: '<circle cx="6" cy="6" r="4.4" fill="currentColor"/>',
  reservada: '<circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor"/>',
  vendida: '<path d="M2.4 2.4l7.2 7.2M9.6 2.4l-7.2 7.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
};
function icon(status) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("class", "st-ico");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON[status] || "";
  return svg;
}

/* ====================================================================== */
function start() {
  const problems = checkTower(tower, plans);
  if (problems.length) throw new Error("data/tower.js inválido:\n" + problems.join("\n"));

  const ACCENT = new THREE.Color(cssVar("--sc-accent", "#F0B56E"));
  const INK = new THREE.Color(cssVar("--sc-ink", "#F3F0EA"));
  const CANVAS = new THREE.Color(cssVar("--sc-canvas", "#0A0C10"));
  const STATUS_COLOR = {
    disponivel: new THREE.Color(cssVar("--st-disponivel", "#7CC79B")),
    reservada: new THREE.Color(cssVar("--st-reservada", "#8FB0EE")),
    // de propósito mais escuro que o --st-vendida da grade: na torre a unidade
    // vendida deve recuar, não competir com as disponíveis
    vendida: new THREE.Color(0x5d6168),
  };
  const INTERIOR = new THREE.Color(0xcfc4b3), WARM = new THREE.Color(0xffc27a), DIMMED = new THREE.Color(0x2c3036);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;        // só quando o sol muda
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const model = buildTower(tower, plans);
  const site = buildSite(tower);
  const B = model.bounds;
  const center = new THREE.Vector3((B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2, (B.y0 + B.y1) / 2);
  const radius = 0.5 * Math.hypot(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0);

  const scene = new THREE.Scene();
  scene.background = CANVAS.clone();
  scene.fog = new THREE.Fog(CANVAS.clone(), 320, 1500);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 4000);
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = false;               // sem inércia: um quadro por mudança
  controls.screenSpacePanning = true;           // arrastar com 2 dedos sobe e desce pela torre
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI / 2;         // a câmera nunca fica abaixo do ponto que olha
  controls.zoomSpeed = 0.9;
  controls.minDistance = 16;
  controls.cursor.copy(center);                 // o alvo não se afasta da torre
  controls.maxTargetRadius = radius + 2;

  /* luzes */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8a7e, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.08;
  // luz fraca sem sombra, de lado: separa os tons das fachadas que o sol não pega
  const fill = new THREE.DirectionalLight(0xe6eeff, 0.35);
  fill.position.set(-0.5, 0.45, 0.75);
  scene.add(hemi, sun, sun.target, fill);

  /* ------------------------------------------------- quadro sob demanda -- */
  // Como no tour: um quadro só é desenhado quando algo muda, e o laço só se
  // mantém enquanto há voo de câmera. Com a aba oculta nada é agendado.
  let raf = 0;
  const tweens = new Set();
  let flight = null;                              // voo em curso: { t, pos, target }

  function invalidate() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function tween(ms, step, done) {
    if (reduceMotion.matches || ms <= 0) {       // movimento reduzido: corte seco
      step(1);
      if (done) done();
      invalidate();
      return null;
    }
    const t = { t0: performance.now(), ms, step, done };
    tweens.add(t);
    invalidate();
    return t;
  }

  function frame(now) {
    raf = 0;
    let busy = false;
    for (const t of [...tweens]) {
      const k = clamp((now - t.t0) / t.ms, 0, 1);
      t.step(ease(k));
      if (k >= 1) { tweens.delete(t); if (t.done) t.done(); } else busy = true;
    }
    paintCompass();
    paintFrames();
    renderer.render(scene, camera);
    if (busy) invalidate();
  }

  document.addEventListener("visibilitychange", () => { if (!document.hidden) invalidate(); });
  ui.canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    ui.status.textContent = "A placa de vídeo interrompeu o desenho. Recarregue a página para continuar.";
    ui.status.hidden = false;
  });
  ui.canvas.addEventListener("webglcontextrestored", () => {
    ui.status.hidden = true;
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  });

  /* ============================================================ a cena == */
  const trash = [];                               // geometrias e materiais, para o dispose
  const keep = (x) => { trash.push(x); return x; };
  const std = (color, extra) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...extra }));

  const M = {
    concrete: std(0xb4afa6),
    core: std(0x9c978f, { roughness: 0.95 }),
    bronze: std(0x6e5541, { roughness: 0.55, metalness: 0.15 }),
    glass: std(0xa9c3cf, { transparent: true, opacity: 0.3, roughness: 0.08, depthWrite: false }),
    railGlass: std(0xcfe0e6, { transparent: true, opacity: 0.2, roughness: 0.08, depthWrite: false }),
    wood: std(0x94704e, { roughness: 0.75 }),
    slat: std(0x7d5d40, { roughness: 0.75 }),
    stone: std(0xa7a299, { roughness: 0.8 }),
    planter: std(0x8b877f),
    green: std(0x567a4f, { roughness: 1 }),
    water: std(0x4fa6b8, { roughness: 0.12, emissive: 0x2b7f92, emissiveIntensity: 0.15 }),
    lobby: std(0xd8c7aa, { emissive: 0xffc27a, emissiveIntensity: 0.2 }),
    plaza: std(0x8e8a82, { roughness: 0.95 }),
    street: std(0x33363b, { roughness: 0.95 }),
    walk: std(0x77746e, { roughness: 0.95 }),
    land: std(0x49524a, { roughness: 1 }),
    neighbor: std(0x666b72, { roughness: 0.95 }),
    trunk: std(0x5c4838, { roughness: 0.9 }),
    leaf: std(0x4d6e48, { roughness: 1 }),
    leafLight: std(0x5d8054, { roughness: 1 }),
  };
  const GROUND_MAT = { piso: M.stone, forro: M.wood, lobby: M.lobby, vidro: M.glass, marquise: M.bronze, portal: M.bronze };
  const ROOF_MAT = {
    vidro: M.railGlass, corrimao: M.bronze, deck: M.wood, borda: M.stone, agua: M.water, pergolado: M.bronze,
    ripa: M.slat, canteiro: M.planter, verde: M.green, tampa: M.bronze,
  };
  const SITE_MAT = { praca: M.plaza, rua: M.street, calcada: M.walk };

  const group = new THREE.Group();
  scene.add(group);

  /* peças iguais viram instâncias: uma chamada de desenho por material */
  const shapes = {
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    cyl: keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 10)),
    ball: keep(new THREE.IcosahedronGeometry(0.5, 1)),
  };
  const buckets = new Map();
  const put = (shape, material, matrix) => {
    const k = shape + "|" + material.uuid;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = { shape, material, list: [] }));
    b.list.push(matrix);
  };
  const I = new THREE.Quaternion();
  // caixa do modelo (no sistema da laje) -> matriz na cena
  const fromBox = (b) => new THREE.Matrix4().compose(
    new THREE.Vector3((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.y0 + b.y1) / 2), I,
    new THREE.Vector3(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0),
  );
  const boxes = (list, pickMaterial) => { for (const b of list) put("box", pickMaterial(b), fromBox(b)); };

  boxes(model.slabs, () => M.concrete);
  boxes(model.columns, () => M.concrete);
  boxes(model.core, () => M.core);
  boxes(model.glass, () => M.glass);
  boxes(model.frames, () => M.bronze);
  boxes(model.fins, () => M.bronze);
  boxes(model.rails, (r) => (r.part === "vidro" ? M.railGlass : M.bronze));
  boxes(model.ground, (g) => GROUND_MAT[g.part] || M.concrete);
  boxes(model.roof, (r) => ROOF_MAT[r.part] || M.concrete);
  boxes(site.pads, (p) => SITE_MAT[p.part] || M.plaza);
  boxes(site.neighbors, () => M.neighbor);

  for (const [i, t] of site.trees.entries()) {
    const trunkH = t.h * 0.45;
    put("cyl", M.trunk, new THREE.Matrix4().compose(new THREE.Vector3(t.x, trunkH / 2, t.y), I, new THREE.Vector3(0.35, trunkH, 0.35)));
    const leaf = i % 2 ? M.leaf : M.leafLight;
    put("ball", leaf, new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.h - t.r * 0.95, t.y), I, new THREE.Vector3(t.r * 2, t.r * 1.75, t.r * 2)));
    put("ball", leaf, new THREE.Matrix4().compose(new THREE.Vector3(t.x + t.r * 0.45, t.h - t.r * 1.5, t.y - t.r * 0.3), I, new THREE.Vector3(t.r * 1.3, t.r * 1.15, t.r * 1.3)));
  }

  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(shapes[b.shape], b.material, b.list.length);
    b.list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = !b.material.transparent;
    mesh.receiveShadow = true;
    if (b.material.transparent) mesh.renderOrder = 2;
    group.add(mesh);
    trash.push(mesh);                              // InstancedMesh também tem dispose()
  }

  /* chão até o horizonte (some na névoa) */
  const land = new THREE.Mesh(keep(new THREE.CircleGeometry(site.radius * 3, 48)), M.land);
  land.rotation.x = -Math.PI / 2;
  land.position.set(center.x, -0.02, center.z);
  land.receiveShadow = true;
  group.add(land);

  /* céu: um degradê do horizonte ao zênite, nas cores da hora */
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main() { float h = clamp(normalize(vDir).y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.5)), 1.0);\n#include <colorspace_fragment>\n}",
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(1900, 24, 12)), skyMat);
  sky.position.copy(center);
  sky.renderOrder = -1;
  group.add(sky);

  /* unidades: uma malha por apartamento (as caixas do volume fechado, juntas),
     cada uma com o seu material, para colorir por status e destacar */
  function mergedBoxes(list) {
    const pos = [], nor = [];
    for (const b of list) {
      const g = new THREE.BoxGeometry(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0).toNonIndexed();
      g.translate((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.y0 + b.y1) / 2);
      pos.push(...g.attributes.position.array);
      nor.push(...g.attributes.normal.array);
      g.dispose();
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    return geo;
  }
  const box3 = (b, grow = 0) => new THREE.Box3(
    new THREE.Vector3(b.x0 - grow, b.z0 - grow, b.y0 - grow), new THREE.Vector3(b.x1 + grow, b.z1 + grow, b.y1 + grow));

  const units = model.units.map((u) => {
    const material = std(0xffffff, { roughness: 0.92 });
    const mesh = new THREE.Mesh(mergedBoxes(u.body), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const [nx, ny] = facadeNormal(u.facade);
    return {
      ...u, data: unitById.get(u.id), material, box: box3(u.bbox),
      normal: new THREE.Vector3(nx, 0, ny),
      // algumas janelas ficam apagadas à noite, sempre as mesmas
      lit: ((u.id * 2654435761) >>> 0) % 100 < 74,
    };
  });
  const unitOf = new Map(units.map((u) => [u.id, u]));
  // o que tapa as unidades num clique: a cobertura e o térreo
  const blockers = [
    box3({ ...B, z0: model.roofLevel - 0.4, z1: model.top }),
    box3({ ...B, z0: 0, z1: model.levels[0].z1 }),
  ];

  /* moldura de destaque: as 12 arestas do volume da unidade, em barras. A
     espessura acompanha a distância da câmera para a moldura não sumir de longe. */
  function makeFrame(color, opacity, depthTest) {
    const mat = keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest, depthWrite: false, toneMapped: false, fog: false }));
    const mesh = new THREE.InstancedMesh(shapes.box, mat, 12);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = depthTest ? 5 : 6;
    group.add(mesh);
    trash.push(mesh);
    return mesh;
  }
  const selFrame = makeFrame(ACCENT, 1, false);
  const hoverFrame = makeFrame(INK, 0.75, true);
  const fm = new THREE.Matrix4(), fp = new THREE.Vector3(), fs = new THREE.Vector3();
  function layFrame(mesh, box, t) {
    const { min, max } = box;
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    let i = 0;
    for (const a of [0, 1]) for (const b of [0, 1]) {
      const X = a ? max.x : min.x, Y = b ? max.y : min.y, Z = a ? max.z : min.z, Zb = b ? max.z : min.z;
      mesh.setMatrixAt(i++, fm.compose(fp.set(c.x, Y, Z), I, fs.set(s.x + t, t, t)));          // ao longo de X
      mesh.setMatrixAt(i++, fm.compose(fp.set(X, c.y, Zb), I, fs.set(t, s.y + t, t)));         // ao longo de Y
      mesh.setMatrixAt(i++, fm.compose(fp.set(X, Y, c.z), I, fs.set(t, t, s.z + t)));          // ao longo de Z
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  let frameKey = "";
  function paintFrames() {
    const sel = unitOf.get(state.selected), hov = state.hover !== state.selected ? unitOf.get(state.hover) : null;
    selFrame.visible = !!sel;
    hoverFrame.visible = !!hov;
    if (!sel && !hov) { frameKey = ""; return; }
    const ref = (sel || hov).box.getCenter(fp);
    const px = (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * camera.position.distanceTo(ref)) / Math.max(1, ui.canvas.clientHeight);
    const t = clamp(px * 3.2, 0.1, 1.2);            // ~3 px de espessura na tela
    const key = `${state.selected}|${state.hover}|${t.toFixed(2)}`;
    if (key === frameKey) return;
    frameKey = key;
    if (sel) layFrame(selFrame, sel.box.clone().expandByScalar(0.06), t);
    if (hov) layFrame(hoverFrame, hov.box.clone().expandByScalar(0.06), t * 0.6);
  }

  // Cor de cada unidade: status (se a disponibilidade está ligada), filtro de
  // tipologia, janelas acesas à noite, realce do mouse e seleção.
  let day = 1;
  function paintUnits() {
    const night = 1 - day;
    for (const u of units) {
      const m = u.material;
      if (state.avail) {
        m.color.copy(STATUS_COLOR[u.status]);
        m.emissive.copy(STATUS_COLOR[u.status]);
        m.emissiveIntensity = u.status === "vendida" ? 0.1 : lerp(0.42, 0.3, day);
      } else {
        m.color.copy(INTERIOR);
        m.emissive.copy(WARM);
        m.emissiveIntensity = night * (u.lit ? 0.95 : 0.06);
      }
      if (state.filter && u.plan !== state.filter) {
        m.color.lerp(DIMMED, 0.85);
        m.emissiveIntensity *= 0.12;
      }
      if (u.id === state.selected) {
        m.color.copy(ACCENT);
        m.emissive.copy(ACCENT);
        m.emissiveIntensity = 0.6;
      } else if (u.id === state.hover) {
        m.color.lerp(INK, 0.4);
        m.emissive.lerp(INK, 0.5);
        m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.2) + 0.18;
      }
    }
    invalidate();
  }

  function dispose() {
    cancelAnimationFrame(raf);
    controls.dispose();
    scene.remove(group);
    for (const x of trash) x.dispose();
    renderer.dispose();
  }

  /* ------------------------------------------------------------- câmera -- */
  const UP = new THREE.Vector3(0, 1, 0);
  const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  // ângulo (theta do three) de quem olha uma fachada de frente
  const thetaOf = (facade) => { const [nx, ny] = facadeNormal(facade); return Math.atan2(nx, ny); };

  // Pose que enquadra uma caixa inteira vista de (theta, phi), em qualquer
  // proporção de tela: cada canto precisa caber na altura e na largura.
  function fitPose(box, theta, phi, margin) {
    const target = box.getCenter(new THREE.Vector3());
    const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);       // do alvo para a câmera
    const f = dir.clone().negate();
    const r = new THREE.Vector3().crossVectors(f, UP).normalize();
    const u = new THREE.Vector3().crossVectors(r, f);
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV) / 2), tanH = tanV * camera.aspect;
    let dist = 0;
    const c = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      c.set(x, y, z).sub(target);
      dist = Math.max(dist, Math.abs(c.dot(u)) / tanV - c.dot(f), Math.abs(c.dot(r)) / tanH - c.dot(f));
    }
    dist *= margin;
    return { pos: dir.multiplyScalar(dist).add(target), target, dist };
  }

  const towerBox = box3(B);
  function viewPose(name) {
    const v = VIEWS[name] || VIEWS.fachada;
    // em tela estreita os botões de vista e a dica comem as bordas: mais folga
    const margin = camera.aspect < 0.8 ? 1.16 : 1.1;
    return fitPose(towerBox, thetaOf(v.facade) + v.turn, v.phi, margin);
  }

  function setOrbitLimits() {
    controls.maxDistance = Math.max(viewPose("fachada").dist, viewPose("aerea").dist) * 1.7;
  }

  // Encerra o voo em curso. Com snap a câmera vai direto ao destino dele.
  function endFlight(snap) {
    if (!flight) return;
    const { t, pos, target } = flight;
    flight = null;
    tweens.delete(t);
    if (snap) {
      camera.position.copy(pos);
      controls.target.copy(target);
      camera.lookAt(target);
      controls.update();
    }
  }

  // Um só voo por vez. O caminho é feito em coordenadas esféricas em volta do
  // alvo, para a câmera contornar a torre em vez de atravessá-la.
  function fly(pos, target, ms) {
    endFlight(false);
    const t0 = controls.target.clone();
    const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(t0));
    const s1 = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
    const dTheta = angleDelta(s0.theta, s1.theta);
    const s = new THREE.Spherical();
    const t = tween(ms, (k) => {
      controls.target.lerpVectors(t0, target, k);
      s.set(lerp(s0.radius, s1.radius, k), lerp(s0.phi, s1.phi, k), s0.theta + dTheta * k);
      camera.position.setFromSpherical(s).add(controls.target);
      camera.lookAt(controls.target);
    }, () => { flight = null; controls.update(); });
    if (t) flight = { t, pos, target };            // null = corte seco, já terminou
    else controls.update();
  }

  function paintViews() {
    for (const b of ui.views.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
  }

  function setView(name, instant) {
    const { pos, target } = viewPose(name);
    state.view = name;
    state.userMoved = false;
    paintViews();
    fly(pos, target, instant ? 0 : 900);
  }

  // Aproxima a câmera da unidade, de frente para a fachada dela, um pouco de
  // lado e de cima. Mantém o lado em que a câmera já está, se ela já olha
  // para essa fachada.
  function focusPose(u) {
    const base = Math.atan2(u.normal.x, u.normal.z);
    const now = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)).theta;
    const off = angleDelta(base, now);
    const side = Math.abs(off) < Math.PI / 2 && Math.abs(off) > 0.05 ? Math.sign(off) : (u.center[0] < model.w / 2 ? -1 : 1) * (u.facade === "fundos" ? -1 : 1);
    const pose = fitPose(u.box, base + side * 0.42, 1.36, 4.2);
    const dist = clamp(pose.dist, 46, controls.maxDistance);
    pose.pos.sub(pose.target).setLength(dist).add(pose.target);
    return pose;
  }

  function orbitBy(dTheta, dPhi, zoom) {
    endFlight(false);
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    s.theta += dTheta;
    s.phi = clamp(s.phi + dPhi, controls.minPolarAngle, controls.maxPolarAngle);
    s.radius = clamp(s.radius * zoom, controls.minDistance, controls.maxDistance);
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    userMoved();
    invalidate();
  }

  function userMoved() {
    state.userMoved = true;
    if (state.view) { state.view = null; paintViews(); }
  }

  // "start" também dispara num simples clique; só conta como movimento do
  // visitante a mudança que acontece enquanto ele está com o ponteiro na cena.
  let interacting = false;
  controls.addEventListener("start", () => { interacting = true; endFlight(false); });
  controls.addEventListener("end", () => { interacting = false; });
  controls.addEventListener("change", () => { if (interacting) userMoved(); invalidate(); });

  /* ---------------------------------------------------------------- sol -- */
  const HEMI_NIGHT = new THREE.Color(0x8fa0c8), HEMI_DAY = new THREE.Color(0xffffff);
  const skyNow = new THREE.Color();
  let sunNow = sunPosition({ month: state.month, hour: state.hour });

  function updateSun() {
    const pos = sunNow = sunPosition({ month: state.month, hour: state.hour });
    const [dx, dy, dz] = sunDirection(pos, model.north);
    day = daylight(pos.elevation);

    sun.visible = pos.elevation > 0;
    sun.intensity = 3.2 * sunStrength(pos.elevation);
    sunColor(pos.elevation, sun.color);
    sun.target.position.copy(center);
    sun.position.set(dx, Math.max(dy, 0.03), dz).multiplyScalar(radius * 4).add(center);
    const cam = sun.shadow.camera, r = radius * 1.5;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = radius * 8;
    cam.updateProjectionMatrix();

    // a luz difusa nunca deixa a torre preta; à noite ela esfria
    hemi.color.lerpColors(HEMI_NIGHT, HEMI_DAY, day);
    hemi.intensity = lerp(0.8, 1.25, day);
    fill.intensity = lerp(0.12, 0.38, day);
    M.lobby.emissiveIntensity = lerp(1.1, 0.18, day);
    M.water.emissiveIntensity = lerp(0.7, 0.12, day);

    // céu da hora, um pouco puxado para o fundo escuro do site
    skyColor(pos.elevation, skyNow);
    skyMat.uniforms.top.value.copy(skyNow).lerp(CANVAS, lerp(0.35, 0.62, day));
    skyMat.uniforms.horizon.value.copy(skyNow).lerp(CANVAS, lerp(0.1, 0.3, day));
    scene.fog.color.copy(skyMat.uniforms.horizon.value);
    scene.background.copy(scene.fog.color);

    renderer.shadowMap.needsUpdate = true;
    paintUnits();

    const { hora, texto, frase } = describeSun(pos, state.hour, state.month);
    ui.hourOut.textContent = hora;
    ui.sunOut.textContent = frase;
    ui.hour.setAttribute("aria-valuetext", `${hora}. ${texto}`);
    paintFichaSun();
  }

  /* ----------------------------------------------- interface (painel) -- */
  const ordinal = (n) => `${n}º andar`;
  const cells = new Map();                        // id -> botão da grade
  let rows = [];                                  // [[botões do andar mais alto], ...]

  function buildGrid() {
    ui.grid.textContent = "";
    rows = [];
    const floors = [...new Set(tower.units.map((u) => u.floor))].sort((a, b) => b - a);
    ui.grid.setAttribute("aria-rowcount", String(floors.length));
    let lastPlan = null;
    for (const floor of floors) {
      const list = tower.units.filter((u) => u.floor === floor).sort((a, b) => a.id - b.id);
      const plan = planOf(list[0], plans);
      if (plan.id !== lastPlan) {
        lastPlan = plan.id;
        const band = tower.bands.find((b) => b.plan === plan.id);
        const cap = document.createElement("div");
        cap.className = "mirror__band";
        cap.dataset.plan = plan.id;
        cap.setAttribute("aria-hidden", "true");       // cada célula já diz a tipologia
        cap.textContent = `${plan.title} · ${fmtArea(plan.area)} · andares ${band.from} a ${band.to}`;
        ui.grid.append(cap);
      }
      const row = document.createElement("div");
      row.className = "mirror__row";
      row.setAttribute("role", "row");
      row.dataset.plan = plan.id;
      const head = document.createElement("span");
      head.className = "mirror__floor";
      head.setAttribute("role", "rowheader");
      head.setAttribute("aria-label", ordinal(floor));
      head.textContent = String(floor);
      row.append(head);
      const span = Math.max(1, Math.floor(12 / list.length));
      const buttons = [];
      for (const u of list) {
        const cell = document.createElement("span");
        cell.className = "mirror__cell";
        cell.setAttribute("role", "gridcell");
        cell.style.gridColumn = `span ${span}`;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell";
        b.dataset.unit = String(u.id);
        b.dataset.status = u.status;
        b.tabIndex = -1;
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-label", unitLabel(tower, u, plans, fmtArea));
        b.title = `${u.id} · ${STATUS_LABEL[u.status]}`;
        const n = document.createElement("span");
        n.className = "cell__n";
        n.textContent = String(u.id);
        b.append(n, icon(u.status));
        cell.append(b);
        row.append(cell);
        cells.set(u.id, b);
        buttons.push(b);
      }
      ui.grid.append(row);
      rows.push(buttons);
    }
    if (rows.length) rows[0][0].tabIndex = 0;       // um só ponto de parada do Tab; as setas andam na grade

    // cabeçalho: para que lado olham as varandas de cada metade da grade
    ui.heads.textContent = "";
    const top = tower.units.filter((u) => u.floor === floors[0]).sort((a, b) => a.id - b.id);
    const groups = [];
    for (const u of top) {
      const last = groups[groups.length - 1];
      if (last && last.facade === u.facade) last.n++;
      else groups.push({ facade: u.facade, n: 1 });
    }
    ui.heads.style.gridTemplateColumns = "1.9rem " + groups.map((g) => `minmax(0, ${g.n}fr)`).join(" ");
    for (const g of groups) {
      const s = document.createElement("span");
      s.textContent = `Varanda a ${cardinal(facadeAzimuth(tower, g.facade))}`;
      ui.heads.append(s);
    }
  }

  function buildFilter() {
    for (const band of tower.bands) {
      const plan = plans.find((p) => p.id === band.plan);
      const o = document.createElement("option");
      o.value = plan.id;
      o.textContent = `${plan.title}, ${fmtArea(plan.area)}`;
      ui.tipo.append(o);
    }
    ui.tipo.value = state.filter;
  }

  function paintLegend() {
    const n = countUnits(tower, state.filter || undefined);
    ui.legend.textContent = "";
    for (const s of STATUS_ORDER) {
      const li = document.createElement("li");
      li.dataset.status = s;
      const b = document.createElement("b");
      b.textContent = String(n[s]);
      li.append(icon(s), b, document.createTextNode(n[s] === 1 ? STATUS_LABEL[s].toLowerCase() : PLURAL[s]));
      ui.legend.append(li);
    }
  }

  function paintFilter() {
    for (const el of ui.grid.querySelectorAll("[data-plan]")) el.classList.toggle("is-dim", !!state.filter && el.dataset.plan !== state.filter);
    paintLegend();
    paintResumo();
    paintUnits();
  }

  function paintAvail() {
    ui.avail.setAttribute("aria-pressed", String(state.avail));
    ui.panel.classList.toggle("is-avail", state.avail);
    paintUnits();
  }

  function paintResumo() {
    ui.resumo.textContent = "";
    const u = unitById.get(state.selected);
    if (u) {
      const plan = planOf(u, plans);
      const strong = document.createElement("strong");
      strong.textContent = `Apartamento ${u.id}`;
      ui.resumo.append(strong, ` · ${plan.title}, ${fmtArea(plan.area)} · ${ordinal(u.floor)} · ${STATUS_LABEL[u.status]}`);
      return;
    }
    const n = countUnits(tower, state.filter || undefined);
    const plan = plans.find((p) => p.id === state.filter);
    ui.resumo.textContent = plan
      ? `${plan.title}: ${n.total} unidades, ${n.disponivel} ${n.disponivel === 1 ? "disponível" : "disponíveis"}. Disponibilidade ilustrativa.`
      : `${n.total} unidades do 2º ao ${tower.floors}º andar, ${n.disponivel} disponíveis. Disponibilidade ilustrativa.`;
  }

  function paintFichaSun() {
    const u = unitById.get(state.selected);
    if (!u) return;
    const hours = unitSunHours(tower, u, state.month);
    const mes = MONTHS[state.month - 1];
    ui.fSol.textContent = hours > 0 ? `${formatHour(hours)} de sol direto em ${mes}` : `Sem sol direto em ${mes}`;
    const hora = formatHour(state.hour);
    ui.fAgora.textContent = unitSunlit(tower, u, sunNow)
      ? `Sol direto na fachada às ${hora}`
      : sunNow.elevation > 0 ? `Fachada na sombra às ${hora}` : `Sol abaixo do horizonte às ${hora}`;
  }

  function paintFicha() {
    const u = unitById.get(state.selected);
    ui.fichaVazia.hidden = !!u;
    ui.ficha.classList.toggle("has-unit", !!u);
    ui.fichaCorpo.hidden = !u;
    document.title = u ? `Apartamento ${u.id} · Espelho de vendas · ${BRAND}` : `Espelho de vendas · ${BRAND}`;
    if (!u) return;
    const plan = planOf(u, plans);
    const card = unitCardinal(tower, u), noTour = cardinal(planAzimuth(plan));
    ui.fNum.textContent = `Apartamento ${u.id}`;
    ui.fStatus.dataset.status = u.status;
    ui.fStatus.textContent = "";
    ui.fStatus.append(icon(u.status), STATUS_LABEL[u.status]);
    ui.fTipo.textContent = plan.title;
    ui.fArea.textContent = fmtArea(plan.area);
    ui.fAndar.textContent = `${u.floor}º de ${tower.floors}`;
    ui.fVaranda.textContent = `Varanda a ${card}`;
    ui.fTour.href = `tour.html?planta=${encodeURIComponent(plan.id)}`;
    ui.fTour.setAttribute("aria-label", `Entrar no tour 3D: ${plan.title}`);
    const sold = u.status === "vendida";
    ui.fVisita.hidden = sold;                       // unidade vendida não oferece visita
    ui.fVisita.href = `index.html?planta=${encodeURIComponent(plan.id)}#visita`;
    ui.fVisita.setAttribute("aria-label", `Agendar visita: apartamento ${u.id}, ${plan.title}`);
    const notes = [];
    if (sold) notes.push("Unidade vendida: não há visita para ela. O tour mostra a mesma planta.");
    if (card !== noTour) notes.push(`O tour mostra a planta-tipo, com a varanda a ${noTour}; nesta unidade ela fica a ${card}.`);
    notes.push("As horas de sol somam as marcas do controle (5h a 19h) e não contam a sombra de vizinhos.");
    ui.fNota.textContent = notes.join(" ");
    paintFichaSun();
  }

  // A mesma unidade fica marcada no modelo, na grade, na ficha e no endereço.
  function select(id, { fly: go = true } = {}) {
    const next = unitById.has(id) ? id : null;
    const changed = next !== state.selected;
    if (changed) {
      const old = cells.get(state.selected);
      if (old) old.setAttribute("aria-pressed", "false");
      state.selected = next;
    }
    const b = cells.get(next);
    if (b) {
      b.setAttribute("aria-pressed", "true");
      for (const c of cells.values()) c.tabIndex = c === b ? 0 : -1;
    }
    paintFicha();
    paintResumo();
    paintUnits();
    // No celular a ficha mora dentro da gaveta: escolher uma unidade abre a
    // gaveta, senão o toque na torre não mostra a ficha nem os links dela.
    // (Em tela larga a classe não muda nada: o painel está sempre aberto.)
    if (next && changed && !ui.panel.classList.contains("is-open")) {
      ui.panel.classList.add("is-open");
      ui.drawer.setAttribute("aria-expanded", "true");
    }
    const url = new URL(location.href);
    if (next) url.searchParams.set("unidade", String(next)); else url.searchParams.delete("unidade");
    history.replaceState(null, "", url);

    const u = unitOf.get(next);
    if (u && go) {
      const pose = focusPose(u);
      if (state.view) { state.view = null; paintViews(); }
      state.userMoved = false;
      fly(pose.pos, pose.target, 800);
    }
  }

  function setHover(id) {
    if (id === state.hover) return;
    const old = cells.get(state.hover);
    if (old) old.classList.remove("is-hover");
    state.hover = id;
    const b = cells.get(id);
    if (b) b.classList.add("is-hover");
    ui.canvas.classList.toggle("is-over", id != null);
    paintUnits();
  }

  function paintHint() {
    ui.hint.textContent = coarsePointer.matches
      ? "Arraste para girar a torre. Toque numa unidade para ver a ficha."
      : "Arraste para girar a torre. Role para aproximar. Clique numa unidade para ver a ficha.";
  }

  let lastNeedle = 999;
  function paintCompass() {
    const deg = needleAngle(camera, model.north);
    if (Math.abs(deg - lastNeedle) < 0.25) return;
    lastNeedle = deg;
    ui.dial.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  /* grade: clique seleciona (ou solta); setas andam entre as células */
  ui.grid.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-unit]");
    if (!b) return;
    const id = Number(b.dataset.unit);
    select(id === state.selected ? null : id);
  });
  ui.grid.addEventListener("focusin", (ev) => {
    const b = ev.target.closest("button[data-unit]");
    if (b) for (const c of cells.values()) c.tabIndex = c === b ? 0 : -1;
  });
  ui.grid.addEventListener("keydown", (ev) => {
    const b = ev.target.closest("button[data-unit]");
    if (!b || ev.altKey || ev.metaKey) return;
    const r = rows.findIndex((row) => row.includes(b));
    const c = rows[r].indexOf(b);
    let to = null;
    const vertical = (dr) => {
      const row = rows[r + dr];
      if (!row) return null;
      // andares têm números diferentes de unidades: vai para a que está na mesma posição da largura
      return row[clamp(Math.floor(((c + 0.5) / rows[r].length) * row.length), 0, row.length - 1)];
    };
    if (ev.key === "ArrowRight") to = rows[r][c + 1];
    else if (ev.key === "ArrowLeft") to = rows[r][c - 1];
    else if (ev.key === "ArrowUp") to = vertical(-1);
    else if (ev.key === "ArrowDown") to = vertical(1);
    else if (ev.key === "Home") to = ev.ctrlKey ? rows[0][0] : rows[r][0];
    else if (ev.key === "End") to = ev.ctrlKey ? rows[rows.length - 1].at(-1) : rows[r].at(-1);
    else if (ev.key === "PageUp") to = rows[Math.max(0, r - 4)][0];
    else if (ev.key === "PageDown") to = rows[Math.min(rows.length - 1, r + 4)][0];
    else if (ev.key === "Escape" && state.selected != null) { select(null); ev.preventDefault(); return; }
    else return;
    ev.preventDefault();
    if (to) to.focus();
  });
  // realce cruzado: passar o mouse na célula realça a unidade na torre
  ui.grid.addEventListener("pointerover", (ev) => {
    const b = ev.target.closest("button[data-unit]");
    if (ev.pointerType === "mouse") setHover(b ? Number(b.dataset.unit) : null);
  });
  ui.grid.addEventListener("pointerleave", () => setHover(null));

  ui.views.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-view]");
    if (b) setView(b.dataset.view, false);
  });
  ui.avail.addEventListener("click", () => { state.avail = !state.avail; paintAvail(); });
  ui.tipo.addEventListener("change", () => {
    state.filter = ui.tipo.value;
    const url = new URL(location.href);
    if (state.filter) url.searchParams.set("planta", state.filter); else url.searchParams.delete("planta");
    history.replaceState(null, "", url);
    paintFilter();
  });
  ui.hour.addEventListener("input", () => { state.hour = Number(ui.hour.value); updateSun(); });
  ui.month.addEventListener("change", () => { state.month = Number(ui.month.value); updateSun(); });
  ui.drawer.addEventListener("click", () => {
    const open = ui.panel.classList.toggle("is-open");
    ui.drawer.setAttribute("aria-expanded", String(open));
  });
  coarsePointer.addEventListener("change", paintHint);

  /* -------------------------------------------- ponteiro e teclado -- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(), hitPoint = new THREE.Vector3();
  function pick(clientX, clientY) {
    const rect = ui.canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    let best = null, bestD = Infinity;
    for (const u of units) {
      if (!ray.intersectBox(u.box, hitPoint)) continue;
      const d = hitPoint.distanceToSquared(ray.origin);
      if (d < bestD) { bestD = d; best = u; }
    }
    if (!best) return null;
    for (const b of blockers) {
      if (ray.intersectBox(b, hitPoint) && hitPoint.distanceToSquared(ray.origin) < bestD) return null;
    }
    return best.id;
  }

  // Arrastar gira (OrbitControls); tocar sem arrastar seleciona. Vale igual
  // para mouse, caneta e dedo. Com dois dedos na tela nunca é toque.
  const down = new Map();                         // ponteiros na cena
  let tap = null;
  ui.canvas.addEventListener("pointerdown", (ev) => {
    down.set(ev.pointerId, true);
    tap = down.size === 1 && (ev.pointerType !== "mouse" || ev.button === 0)
      ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), slack: ev.pointerType === "mouse" ? 5 : 10 }
      : null;
    if (ev.pointerType !== "mouse") setHover(null);
  });
  ui.canvas.addEventListener("pointermove", (ev) => {
    if (tap && ev.pointerId === tap.id && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) > tap.slack) tap = null;
    if (ev.pointerType === "mouse" && down.size === 0) setHover(pick(ev.clientX, ev.clientY));
  });
  ui.canvas.addEventListener("pointerup", (ev) => {
    down.delete(ev.pointerId);
    const ok = tap && ev.pointerId === tap.id && performance.now() - tap.t < 600;
    tap = null;
    if (!ok) return;
    const id = pick(ev.clientX, ev.clientY);
    if (id === state.selected) return;             // tocar de novo na mesma unidade não faz nada
    select(id);                                   // tocar fora da torre solta a seleção
  });
  ui.canvas.addEventListener("pointercancel", (ev) => { down.delete(ev.pointerId); tap = null; });
  ui.canvas.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse") setHover(null); });
  ui.canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // As teclas só valem com o foco na cena, nos botões de vista ou em lugar
    // nenhum (body). Na grade e no slider do sol as setas são deles.
    const el = ev.target instanceof Element ? ev.target : null;
    if (el && el !== document.body && el !== document.documentElement && !el.closest("#e-canvas, #e-views")) return;
    const step = 0.12;
    if (ev.code === "ArrowLeft") orbitBy(-step, 0, 1);
    else if (ev.code === "ArrowRight") orbitBy(step, 0, 1);
    else if (ev.code === "ArrowUp") orbitBy(0, -step * 0.6, 1);
    else if (ev.code === "ArrowDown") orbitBy(0, step * 0.6, 1);
    else if (ev.key === "+" || ev.key === "=") orbitBy(0, 0, 0.88);
    else if (ev.key === "-") orbitBy(0, 0, 1 / 0.88);
    else if (ev.key === "Escape" && state.selected != null) select(null);
    else return;
    ev.preventDefault();
  });

  /* ------------------------------------------------------------ tamanho -- */
  function resize() {
    const w = Math.max(1, ui.scene.clientWidth), h = Math.max(1, ui.scene.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    setOrbitLimits();
    // enquanto o visitante não mexeu na câmera, a cena se reenquadra sozinha
    if (!state.userMoved) {
      endFlight(false);
      const u = unitOf.get(state.selected);
      const pose = u && !state.view ? focusPose(u) : viewPose(state.view || "fachada");
      fly(pose.pos, pose.target, 0);
    }
    frameKey = "";
    invalidate();
  }
  new ResizeObserver(resize).observe(ui.scene);
  addEventListener("pagehide", (ev) => { if (!ev.persisted) dispose(); });

  /* ---------------------------------------------------------------- início -- */
  ui.hour.min = String(SUN_GRID.min);
  ui.hour.max = String(SUN_GRID.max);
  ui.hour.step = String(SUN_GRID.step);
  ui.hour.value = String(state.hour);
  fillMonths(ui.month, state.month);
  ui.canvas.setAttribute("aria-label",
    `Torre do ${BRAND} em 3D, com ${tower.floors} andares e ${tower.units.length} apartamentos. Arraste ou use as setas para girar, mais e menos para aproximar. As unidades também estão na grade "Unidades por andar".`);

  buildGrid();
  buildFilter();
  paintHint();
  paintViews();
  paintAvail();
  paintFilter();

  // primeira pose sem voo; a unidade do endereço (?unidade=) já entra escolhida
  camera.position.set(center.x, center.y, center.z - 100);
  controls.target.copy(center);
  resize();
  updateSun();
  if (state.selected != null) {
    const id = state.selected;
    state.selected = null;
    select(id);
    endFlight(true);
  } else {
    paintFicha();
  }

  ui.status.hidden = true;
  // Só leitura, para inspeção e testes no navegador (como window.MiranteTour).
  const projected = new THREE.Vector3();
  window.MiranteEspelho = {
    get selected() { return state.selected; },
    get hover() { return state.hover; },
    get availability() { return state.avail; },
    get filter() { return state.filter; },
    get view() { return state.view; },
    get busy() { return tweens.size > 0; },
    get units() { return units.map((u) => u.id); },
    get camera() { return { position: camera.position.toArray(), target: controls.target.toArray() }; },
    // ponto da tela (clientX, clientY) no meio da fachada da unidade, para um teste clicar nela
    screenPoint(id) {
      const u = unitOf.get(id);
      if (!u) return null;
      const half = u.box.getSize(new THREE.Vector3()).multiply(u.normal).length() / 2;
      u.box.getCenter(projected).addScaledVector(u.normal, half - 0.4).project(camera);
      const rect = ui.canvas.getBoundingClientRect();
      return { x: rect.left + ((projected.x + 1) / 2) * rect.width, y: rect.top + ((1 - projected.y) / 2) * rect.height, visible: projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
    },
  };
  document.body.classList.add("is-ready");
}

/* ---------------------------------------------------------------- partida -- */
fromUrl();
try {
  renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: "high-performance" });
} catch (err) {
  renderer = null;
}

let started = false;
if (renderer) {
  // Um erro ao montar a cena (dados da torre inválidos, por exemplo) não pode
  // deixar a página presa em "Carregando": cai na mesma mensagem.
  try {
    start();
    started = true;
  } catch (err) {
    console.error(err);
  }
}
if (!started) {
  // Sem WebGL ou sem cena: mensagem clara e o caminho para as plantas.
  for (const el of [ui.status, ui.canvas, ui.compass, ui.hint, ui.views, ui.panel]) el.hidden = true;
  ui.fallback.hidden = false;
}

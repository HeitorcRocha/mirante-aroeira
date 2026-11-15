/* ============================================================================
   Mirante Aroeira: tour 3D das plantas.

   A cena é montada por código a partir de data/plans.js. Este arquivo é a
   única parte que conhece o three.js; a geometria e o sol são calculados em
   módulos puros (geometry.js e sun.js), que rodam também no Node.

   Eixos: a planta usa x para a direita e y para baixo, em metros. Na cena,
   X = x da planta, Z = y da planta e Y = altura. Vista de cima com o norte
   da tela para -Z, a cena coincide com a planta 2D, sem espelhar.

   three e OrbitControls vêm de vendor/ pelo import map de tour.html.
   ========================================================================== */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { plans, fmtArea } from "../data/plans.js";
import { buildModel, collides, slideMove, findPath, pathLength, roomAt, DIM } from "./geometry.js";
import { sunPosition, sunDirection } from "./sun.js";
// contas e textos que o espelho de vendas (espelho.js) também usa
import {
  clamp, lerp, smooth, ease, cssVar, reduceMotion, coarsePointer,
  skyColor, sunColor, sunStrength, daylight, needleAngle, fillMonths, describeSun,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const ui = {
  scene: $("t-scene"), canvas: $("t-canvas"), status: $("t-status"), fallback: $("t-fallback"),
  hint: $("t-hint"), compass: $("t-compass"), dial: $("t-compass-dial"),
  panel: $("t-panel"), title: $("t-title"), area: $("t-area"), plan: $("t-planta"),
  maquete: $("t-mode-maquete"), caminhar: $("t-mode-caminhar"),
  drawer: $("t-drawer"), rooms: $("t-rooms"),
  hour: $("t-hour"), month: $("t-month"), hourOut: $("t-hour-out"), sunOut: $("t-sun-out"),
  espelho: $("t-espelho"),
};

const BRAND = "Mirante Aroeira";
const MAQUETE = "maquete", CAMINHAR = "caminhar";
const FOV = { [MAQUETE]: 40, [CAMINHAR]: 68 };

/* ------------------------------------------------------------- estado -- */
const state = {
  plan: null, model: null, world: null,
  mode: MAQUETE,
  hour: 10, month: 6,
  focus: -1,              // ambiente escolhido na maquete
  current: -2,            // ambiente destacado na lista (-2 força a 1ª pintura)
  userMoved: false,       // o visitante já mexeu na câmera da maquete?
  orbit: null,            // pose da maquete guardada ao entrar no caminhar
  walk: { x: 0, y: 0, yaw: 0, pitch: 0, path: null },
};

let renderer = null;

function planFromUrl() {
  const id = new URLSearchParams(location.search).get("planta");
  return plans.find((p) => p.id === id) || plans[0];
}

/* ====================================================================== */
function start() {
  const CANVAS_COLOR = new THREE.Color(cssVar("--sc-canvas", "#0A0C10"));
  const ACCENT = new THREE.Color(cssVar("--sc-accent", "#F0B56E"));

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;        // só quando o sol ou a cena mudam
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = CANVAS_COLOR.clone();

  const camera = new THREE.PerspectiveCamera(FOV[MAQUETE], 1, 0.05, 220);
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = false;               // sem inércia: um quadro por mudança
  controls.screenSpacePanning = false;          // arrastar com 2 dedos anda no plano do piso
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI / 2 - 0.1;   // nunca passa por baixo do piso
  controls.zoomSpeed = 0.9;

  /* luzes */
  const hemi = new THREE.HemisphereLight(0xffffff, 0xc9c0b2, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  // Duas luzes fracas, sem sombra, vindas de lados diferentes: dão tons
  // distintos às paredes de cada orientação, para os cantos serem legíveis
  // mesmo onde o sol não chega (com o teto, no modo caminhar).
  const fillA = new THREE.DirectionalLight(0xfff3e2, 0.55);
  fillA.position.set(0.55, 0.6, 0.4);
  const fillB = new THREE.DirectionalLight(0xe6eeff, 0.3);
  fillB.position.set(-0.35, 0.5, -0.7);
  scene.add(hemi, sun, sun.target, fillA, fillB);

  /* marcador do destino no piso (modo caminhar) */
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.13, 0.18, 40),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, depthTest: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 10;
  marker.visible = false;
  scene.add(marker);

  /* ------------------------------------------------- quadro sob demanda -- */
  // Nada de laço contínuo: um quadro só é desenhado quando algo muda, e o
  // laço só se mantém enquanto há transição ou tecla apertada. Com a aba
  // oculta nada é agendado.
  let raf = 0, lastTime = 0, wasBusy = false;
  const tweens = new Set();
  const keys = new Set();
  let orbitFlight = null;                          // voo da maquete em curso: { t, pos, target }

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
    const dt = wasBusy ? Math.min(0.05, (now - lastTime) / 1000) : 1 / 60;
    lastTime = now;
    let busy = false;

    for (const t of [...tweens]) {
      const k = clamp((now - t.t0) / t.ms, 0, 1);
      t.step(ease(k));
      if (k >= 1) { tweens.delete(t); if (t.done) t.done(); } else busy = true;
    }
    if (state.mode === CAMINHAR && !flying) busy = stepWalk(dt) || busy;

    paintCompass();
    paintCurrentRoom();
    renderer.render(scene, camera);

    wasBusy = busy;
    if (busy) invalidate();
  }

  document.addEventListener("visibilitychange", () => {
    keys.clear();
    if (!document.hidden) { wasBusy = false; invalidate(); }
  });
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

  // Gerador determinístico para as texturas: o piso sai igual a cada visita.
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Texturas procedurais desenhadas em canvas (nenhuma imagem é baixada).
  // Devolvem a textura e quantos metros um ladrilho do canvas cobre.
  function floorTexture(kind) {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const rnd = prng(kind.length * 7919 + kind.charCodeAt(0));
    let meters = 1;

    if (kind === "pedra") {
      meters = 1.2;                               // 2 x 2 placas de 60 cm
      g.fillStyle = "#cbc6bd";
      g.fillRect(0, 0, size, size);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const v = Math.round((rnd() - 0.5) * 10);
        g.fillStyle = `rgb(${203 + v}, ${198 + v}, ${189 + v})`;
        g.fillRect(i * 256 + 2, j * 256 + 2, 252, 252);
      }
      for (let k = 0; k < 900; k++) {              // granulado leve
        g.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "70,62,52"}, ${0.03 + rnd() * 0.04})`;
        g.fillRect(rnd() * size, rnd() * size, 2 + rnd() * 5, 1 + rnd() * 2);
      }
      g.strokeStyle = "rgba(92, 86, 78, 0.55)";
      g.lineWidth = 3;
      for (let i = 0; i <= 2; i++) {
        g.beginPath(); g.moveTo(i * 256, 0); g.lineTo(i * 256, size); g.stroke();
        g.beginPath(); g.moveTo(0, i * 256); g.lineTo(size, i * 256); g.stroke();
      }
    } else {
      // tábuas correndo ao longo de x; deck = tábua estreita com fresta escura
      const deck = kind === "deck";
      const rows = 8;
      meters = deck ? 1.12 : 1.44;                 // tábua de 14 cm ou de 18 cm
      const base = deck ? [126, 95, 68] : [176, 138, 100];
      const rowH = size / rows;
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * 220;
        while (x < size) {
          const len = 200 + rnd() * 240;
          const v = (rnd() - 0.5) * 26;
          g.fillStyle = `rgb(${base[0] + v}, ${base[1] + v * 0.85}, ${base[2] + v * 0.7})`;
          g.fillRect(x, r * rowH, len, rowH);
          g.fillStyle = "rgba(40, 26, 14, 0.35)";    // topo da tábua
          g.fillRect(x + len - 1.5, r * rowH, 1.5, rowH);
          x += len;
        }
        for (let k = 0; k < 26; k++) {              // veios
          g.fillStyle = `rgba(60, 38, 20, ${0.03 + rnd() * 0.06})`;
          g.fillRect(rnd() * size, r * rowH + rnd() * rowH, 30 + rnd() * 120, 1);
        }
        g.fillStyle = deck ? "rgba(20, 14, 9, 0.8)" : "rgba(50, 32, 18, 0.4)";
        g.fillRect(0, r * rowH, size, deck ? 4 : 1.5);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return { tex, meters };
  }

  /** Monta o grupo three.js de um modelo. Tudo o que aloca fica em trash. */
  function buildWorld(model) {
    const group = new THREE.Group();
    const trash = [];                              // geometrias, materiais, texturas
    const keep = (x) => { trash.push(x); return x; };

    const std = (color, extra) => keep(new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }));
    const M = {
      wall: std(0xe9e3d8),
      ceiling: std(0xf2efe9),
      slab: std(0x23262c, { roughness: 0.95 }),
      frame: std(0x3a332c, { roughness: 0.5, metalness: 0.25 }),
      glass: std(0xbcd3da, { transparent: true, opacity: 0.2, roughness: 0.08, depthWrite: false }),
      door: std(0xc2a685, { roughness: 0.7 }),
      entry: std(0x5c4433, { roughness: 0.65 }),
      wood: std(0x9b7756, { roughness: 0.7 }),
      woodDark: std(0x5a4231, { roughness: 0.75 }),
      cabinet: std(0x77736c),
      wardrobe: std(0xd9d2c5, { roughness: 0.75 }),
      stone: std(0xdcd8d0, { roughness: 0.45 }),
      steel: std(0xb7babc, { roughness: 0.35, metalness: 0.2 }),
      white: std(0xf3f1ed, { roughness: 0.4 }),
      black: std(0x17181a, { roughness: 0.4 }),
      dark: std(0x2b2a29, { roughness: 0.6 }),
      fabric: std(0x7d8882, { roughness: 1 }),
      fabricLight: std(0x929c96, { roughness: 1 }),
      amber: std(0xb48a5c, { roughness: 1 }),
      amberLight: std(0xc79d6d, { roughness: 1 }),
      linen: std(0xeee8dc, { roughness: 1 }),
      duvet: std(0x8c97a3, { roughness: 1 }),
      rug: std(0xb9ad9a, { roughness: 1 }),
      leaf: std(0x4f6f49, { roughness: 0.9 }),
      pot: std(0xc8b8a2, { roughness: 0.8 }),
      mirror: std(0xd3dde2, { roughness: 0.08, metalness: 0.3 }),
    };

    /* peças iguais viram instâncias: uma chamada de desenho por material */
    const shapes = {
      box: keep(new THREE.BoxGeometry(1, 1, 1)),
      cyl: keep(new THREE.CylinderGeometry(0.5, 0.5, 1, 24)),
      ball: keep(new THREE.SphereGeometry(0.5, 16, 12)),
    };
    const buckets = new Map();
    const put = (shape, material, matrix) => {
      const k = shape + "|" + material.uuid;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { shape, material, list: [] }));
      b.list.push(matrix);
    };
    const I = new THREE.Quaternion();
    // caixa do modelo (x0..z1, no sistema da planta) -> matriz na cena
    const fromBox = (b) => new THREE.Matrix4().compose(
      new THREE.Vector3((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.y0 + b.y1) / 2), I,
      new THREE.Vector3(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0),
    );

    for (const w of model.walls) put("box", M.wall, fromBox(w));
    for (const f of model.frames) put("box", M.frame, fromBox(f));
    for (const g of model.glass) put("box", M.glass, fromBox(g));
    for (const r of model.rails) put("box", r.part === "vidro" ? M.glass : M.frame, fromBox(r));
    for (const d of model.doors) put("box", d.entry ? M.entry : M.door, fromBox(d));

    const B = model.bounds;
    put("box", M.slab, fromBox({ ...B, z0: -0.3, z1: 0 }));

    /* móveis */
    for (const f of model.furniture) {
      const turned = f.rot === 90 || f.rot === 270;
      const W = turned ? f.y1 - f.y0 : f.x1 - f.x0;      // largura no eixo local X
      const D = turned ? f.x1 - f.x0 : f.y1 - f.y0;      // profundidade no eixo local Z
      // costas do móvel em -Z local; rot gira no sentido horário visto de cima
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3((f.x0 + f.x1) / 2, 0, (f.y0 + f.y1) / 2),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(f.rot)),
        new THREE.Vector3(1, 1, 1),
      );
      const part = (shape, material, x, y, z, sx, sy, sz) => {
        const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y + sy / 2, z), I, new THREE.Vector3(sx, sy, sz));
        put(shape, material, base.clone().multiply(local));
      };
      const P = {
        // y é a base da peça; (x, z) o centro
        box: (m, x, y, z, sx, sy, sz) => part("box", m, x, y, z, sx, sy, sz),
        cyl: (m, x, y, z, r, h) => part("cyl", m, x, y, z, r * 2, h, r * 2),
        ball: (m, x, y, z, r) => part("ball", m, x, y - r * 2, z, r * 2, r * 2, r * 2),   // y = topo
      };
      (FURNITURE_DRAW[f.type] || FURNITURE_DRAW.fallback)(P, M, W, D, f);
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
      trash.push(mesh);                            // InstancedMesh também tem dispose()
    }

    /* pisos: uma malha por tipo, com UV em metros para a textura não esticar */
    const byFloor = new Map();
    for (const f of model.floors) {
      if (!byFloor.has(f.floor)) byFloor.set(f.floor, []);
      byFloor.get(f.floor).push(f);
    }
    for (const [kind, rects] of byFloor) {
      const { tex, meters } = floorTexture(kind);
      keep(tex);
      const pos = [], uv = [], nor = [], idx = [];
      rects.forEach((q, i) => {
        const y = 0.002;
        pos.push(q.x0, y, q.y0, q.x1, y, q.y0, q.x1, y, q.y1, q.x0, y, q.y1);
        for (const [x, z] of [[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]]) uv.push(x / meters, z / meters);
        nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
        idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
      });
      const geo = keep(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, std(0xffffff, { map: tex, roughness: kind === "pedra" ? 0.5 : 0.75 }));
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    /* teto: só existe no modo caminhar; faz a luz entrar apenas pelos vidros */
    const ceiling = new THREE.Mesh(shapes.box, M.ceiling);
    ceiling.position.set((B.x0 + B.x1) / 2, model.height + 0.075, (B.y0 + B.y1) / 2);
    ceiling.scale.set(B.x1 - B.x0, 0.15, B.y1 - B.y0);
    ceiling.castShadow = true;
    ceiling.visible = false;
    group.add(ceiling);

    const center = new THREE.Vector3((B.x0 + B.x1) / 2, 0, (B.y0 + B.y1) / 2);
    const radius = 0.5 * Math.hypot(B.x1 - B.x0, B.y1 - B.y0, model.height);
    return {
      group, ceiling, center, radius,
      tall: model.colliders.filter((c) => c.tall),   // o que tapa a visão na altura dos olhos
      dispose() {
        scene.remove(group);
        for (const x of trash) x.dispose();
      },
    };
  }

  /* ====================================================== planta ativa == */

  function loadPlan(plan, { push = false } = {}) {
    tweens.clear();
    orbitFlight = null;
    flying = false;
    if (state.world) state.world.dispose();        // libera geometria, material e textura

    state.plan = plan;
    state.model = buildModel(plan);
    state.world = buildWorld(state.model);
    scene.add(state.world.group);
    state.focus = -1;
    state.current = -2;
    state.userMoved = false;
    state.orbit = null;
    state.walk.path = null;
    marker.visible = false;

    document.title = `Tour 3D · ${plan.title}, ${fmtArea(plan.area)} · ${BRAND}`;
    ui.title.textContent = plan.title;
    ui.area.textContent = fmtArea(plan.area);
    ui.plan.value = plan.id;
    // o espelho de vendas abre já filtrado pela tipologia que está no tour
    ui.espelho.href = "espelho.html?planta=" + encodeURIComponent(plan.id);
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set("planta", plan.id);
      history.replaceState(null, "", url);
    }
    paintRoomList();

    applyMode(MAQUETE);
    resize();
    home(true);
    updateSun();
  }

  /* ------------------------------------------------------------ maquete -- */

  // Pose que enquadra o apartamento inteiro, em qualquer proporção de tela.
  function homePose() {
    const { center, radius } = state.world;
    const vfov = THREE.MathUtils.degToRad(FOV[MAQUETE]) / 2;
    const hfov = Math.atan(Math.tan(vfov) * camera.aspect);
    const dist = (radius / Math.sin(Math.min(vfov, hfov))) * 0.98;
    // tela em pé com planta deitada: gira 90° para o lado maior ficar na vertical
    const portrait = camera.aspect < 1 && state.model.w > state.model.h;
    const theta = portrait ? Math.PI / 2 : -0.28;
    const phi = 0.44;                              // ~25° a partir da vertical
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, phi, theta).add(center);
    return { pos, target: center.clone(), dist };
  }

  function setOrbitLimits() {
    const { dist } = homePose();
    controls.minDistance = 2.5;
    controls.maxDistance = dist * 1.5;
    controls.cursor.copy(state.world.center);      // o alvo não se afasta do apartamento
    controls.maxTargetRadius = state.world.radius;
  }

  // Encerra o voo da maquete em curso. Com snap, a câmera vai direto para o
  // destino dele; sem snap, fica onde está (um novo voo parte daí).
  function endOrbitFlight(snap) {
    if (!orbitFlight) return;
    const { t, pos, target } = orbitFlight;
    orbitFlight = null;
    tweens.delete(t);
    if (snap) {
      camera.position.copy(pos);
      controls.target.copy(target);
      camera.lookAt(target);
      controls.update();
    }
  }

  // Só um voo por vez: sem isso, dois cliques seguidos na lista deixavam dois
  // tweens disputando a câmera, e trocar de modo no meio guardava uma pose
  // intermediária como "posição da maquete".
  function flyOrbit(pos, target, ms) {
    endOrbitFlight(false);
    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const t = tween(ms, (k) => {
      camera.position.lerpVectors(p0, pos, k);
      controls.target.lerpVectors(t0, target, k);
      camera.lookAt(controls.target);
    }, () => { orbitFlight = null; controls.update(); });
    if (t) orbitFlight = { t, pos, target };       // null = corte seco, já terminou
  }

  function home(instant) {
    const { pos, target } = homePose();
    state.focus = -1;
    state.userMoved = false;
    flyOrbit(pos, target, instant ? 0 : 700);
  }

  // Centraliza e aproxima a maquete num ambiente, mantendo o ângulo atual.
  function focusRoom(room) {
    const b = room.bbox;
    const target = new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.y0 + b.y1) / 2);
    const r = 0.5 * Math.hypot(b.x1 - b.x0, b.y1 - b.y0, DIM.ceiling);
    const vfov = THREE.MathUtils.degToRad(FOV[MAQUETE]) / 2;
    const hfov = Math.atan(Math.tan(vfov) * camera.aspect);
    const dist = clamp((r / Math.sin(Math.min(vfov, hfov))) * 1.5, controls.minDistance + 1, controls.maxDistance);
    const dir = camera.position.clone().sub(controls.target);
    const s = new THREE.Spherical().setFromVector3(dir);
    s.phi = clamp(s.phi, 0.35, 0.95);              // nem de topo, nem rasante
    s.radius = dist;
    state.focus = room.index;
    state.userMoved = true;
    flyOrbit(new THREE.Vector3().setFromSpherical(s).add(target), target, 700);
  }

  // Teclado na maquete: setas giram, + e - aproximam.
  function orbitBy(dTheta, dPhi, zoom) {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    s.theta += dTheta;
    s.phi = clamp(s.phi + dPhi, 0.02, controls.maxPolarAngle);
    s.radius = clamp(s.radius * zoom, controls.minDistance, controls.maxDistance);
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    controls.update();
    state.userMoved = true;
    invalidate();
  }

  controls.addEventListener("change", invalidate);
  controls.addEventListener("start", () => { state.userMoved = true; });

  /* ----------------------------------------------------------- caminhar -- */
  let flying = false;                              // em transição entre os modos

  const yawTo = (dx, dy) => Math.atan2(-dx, -dy);  // a câmera olha para -Z com yaw 0
  const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

  function poseWalk() {
    const w = state.walk;
    camera.position.set(w.x, DIM.eye, w.y);
    camera.rotation.set(w.pitch, w.yaw, 0, "YXZ");
  }

  // Para onde olhar ao chegar num ambiente: para o meio dele ou, se já
  // estiver no meio, para o centro do apartamento.
  function yawForRoom(room, x, y) {
    const b = room.bbox;
    let dx = (b.x0 + b.x1) / 2 - x, dy = (b.y0 + b.y1) / 2 - y;
    if (Math.hypot(dx, dy) < 0.6) { dx = state.model.w / 2 - x; dy = state.model.h / 2 - y; }
    if (Math.hypot(dx, dy) < 0.2) return state.walk.yaw;
    return yawTo(dx, dy);
  }

  function followPath(path, face) {
    const len = pathLength(path);
    if (len < 0.05) return;
    const seconds = clamp(len / 3.2, 0.35, 2.4);    // transição curta, mesmo em trajeto longo
    state.walk.path = { pts: path, i: 1, speed: len / seconds, face };
    const end = path[path.length - 1];
    marker.position.set(end[0], 0.02, end[1]);
    marker.visible = true;
    invalidate();
  }

  function stopPath() {
    state.walk.path = null;
    marker.visible = false;
  }

  function teleport(x, y, yaw) {
    stopPath();
    state.walk.x = x; state.walk.y = y;
    if (yaw !== undefined) state.walk.yaw = yaw;
    poseWalk();
    invalidate();
  }

  function walkToRoom(room) {
    const w = state.walk, [x, y] = room.visit;
    const path = reduceMotion.matches ? null : findPath(state.model, [w.x, w.y], [x, y]);
    if (path && path.length > 1) followPath(path, true);
    else teleport(x, y, yawForRoom(room, x, y));    // corte seco
  }

  // Toque ou clique no piso: anda até o ponto, se ele estiver à vista.
  const raycaster = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function walkToScreenPoint(clientX, clientY) {
    const rect = ui.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (!hit) return;                               // apontou para cima do horizonte
    const w = state.walk;
    let tx = hit.x, ty = hit.z;
    const dist = Math.hypot(tx - w.x, ty - w.y);
    if (dist < 0.15 || dist > 30) return;
    // Se há parede ou armário no meio, o clique foi neles, não no piso de
    // trás: para no último ponto visível.
    const tall = state.world.tall;
    const n = Math.ceil(dist / 0.05);
    let seen = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (collides(tall, lerp(w.x, tx, t), lerp(w.y, ty, t), 0.02)) break;
      seen = i;
    }
    if (seen < n) {
      const t = Math.max(0, seen / n - 0.3 / dist);
      tx = lerp(w.x, tx, t); ty = lerp(w.y, ty, t);
    }
    if (roomAt(state.model, tx, ty) < 0) return;
    const path = findPath(state.model, [w.x, w.y], [tx, ty]);
    if (!path || path.length < 2) return;
    if (reduceMotion.matches) { const end = path[path.length - 1]; teleport(end[0], end[1]); }
    else followPath(path, false);
  }

  // Um passo do modo caminhar. Devolve true enquanto houver movimento.
  function stepWalk(dt) {
    const w = state.walk;
    let moving = false;

    const fwd = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
    const side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const turn = (keys.has("ArrowLeft") || keys.has("KeyQ") ? 1 : 0) - (keys.has("ArrowRight") || keys.has("KeyE") ? 1 : 0);

    if (turn) { w.yaw += turn * 1.9 * dt; moving = true; }
    if (fwd || side) {
      stopPath();
      const fx = -Math.sin(w.yaw), fy = -Math.cos(w.yaw);   // frente no plano
      const rx = -fy, ry = fx;                               // direita
      let dx = fx * fwd + rx * side, dy = fy * fwd + ry * side;
      const l = Math.hypot(dx, dy) || 1;
      const step = 2.4 * dt;
      [w.x, w.y] = slideMove(state.model.colliders, [w.x, w.y], [w.x + (dx / l) * step, w.y + (dy / l) * step]);
      moving = true;
    } else if (w.path) {
      const p = w.path;
      let left = p.speed * dt;
      while (left > 0 && p.i < p.pts.length) {
        const [tx, ty] = p.pts[p.i];
        const d = Math.hypot(tx - w.x, ty - w.y);
        if (p.face && d > 0.05) w.yaw += angleDelta(w.yaw, yawTo(tx - w.x, ty - w.y)) * Math.min(1, dt * 7);
        if (d <= left) { w.x = tx; w.y = ty; left -= d; p.i++; }
        else { w.x += ((tx - w.x) / d) * left; w.y += ((ty - w.y) / d) * left; left = 0; }
      }
      if (p.i >= p.pts.length) stopPath();
      moving = true;
    }
    if (moving) poseWalk();
    return moving;
  }

  /* --------------------------------------------------- troca de modo -- */

  function applyMode(mode) {
    state.mode = mode;
    const walking = mode === CAMINHAR;
    ui.maquete.setAttribute("aria-pressed", String(!walking));
    ui.caminhar.setAttribute("aria-pressed", String(walking));
    document.body.dataset.mode = mode;
    controls.enabled = !walking;
    camera.fov = FOV[mode];
    camera.updateProjectionMatrix();
    if (state.world) state.world.ceiling.visible = walking;
    marker.visible = false;
    paintHint();
    ui.canvas.setAttribute("aria-label", walking
      ? `Apartamento ${state.plan.title} em 3D, visto por dentro. Arraste para olhar em volta, use W, A, S, D ou as setas para andar, ou escolha um ambiente na lista.`
      : `Maquete 3D do apartamento ${state.plan.title}, vista de cima e sem teto. Arraste ou use as setas para girar, ou escolha um ambiente na lista.`);
  }

  function setMode(mode) {
    if (mode === state.mode || flying) return;
    endOrbitFlight(true);
    const from = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    const world = state.world;

    if (mode === CAMINHAR) {
      state.orbit = { pos: camera.position.clone(), target: controls.target.clone() };
      const room = state.model.rooms[state.focus >= 0 ? state.focus : 0];
      const w = state.walk;
      [w.x, w.y] = room.visit;
      w.pitch = 0;
      w.yaw = yawForRoom(room, w.x, w.y);
      w.path = null;
      applyMode(CAMINHAR);
      updateSun();                                  // céu e luz do modo já no início do voo
      poseWalk();
      const to = { pos: camera.position.clone(), quat: camera.quaternion.clone() };
      // durante o voo de entrada o teto fica fora, para a câmera não o atravessar
      world.ceiling.visible = false;
      flying = true;
      tween(950, (k) => {
        camera.position.lerpVectors(from.pos, to.pos, k);
        camera.quaternion.slerpQuaternions(from.quat, to.quat, k);
        camera.fov = lerp(from.fov, FOV[CAMINHAR], k);
        camera.updateProjectionMatrix();
      }, () => {
        flying = false;
        world.ceiling.visible = true;
        poseWalk();
        updateSun();
      });
    } else {
      stopPath();
      applyMode(MAQUETE);
      controls.enabled = false;                     // só volta a obedecer ao fim do voo
      const pose = state.orbit || homePose();
      const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(pose.pos, pose.target, camera.up));
      updateSun();
      flying = true;
      tween(950, (k) => {
        camera.position.lerpVectors(from.pos, pose.pos, k);
        camera.quaternion.slerpQuaternions(from.quat, quat, k);
        camera.fov = lerp(from.fov, FOV[MAQUETE], k);
        camera.updateProjectionMatrix();
      }, () => {
        flying = false;
        controls.target.copy(pose.target);
        camera.position.copy(pose.pos);
        camera.lookAt(pose.target);
        controls.enabled = true;
        controls.update();
      });
    }
    invalidate();
  }

  /* ---------------------------------------------------------------- sol -- */
  const HEMI_NIGHT = new THREE.Color(0xb9c4e0), HEMI_DAY = new THREE.Color(0xffffff);

  function updateSun() {
    const { model, world } = state;
    const pos = sunPosition({ month: state.month, hour: state.hour });
    const [dx, dy, dz] = sunDirection(pos, model.north);
    const up = pos.elevation > 0;
    const day = daylight(pos.elevation);            // 0 = noite, 1 = dia claro
    const walking = state.mode === CAMINHAR;

    sun.visible = up;
    sun.intensity = 3.3 * sunStrength(pos.elevation);
    sunColor(pos.elevation, sun.color);
    sun.target.position.copy(world.center);
    sun.position.set(dx, Math.max(dy, 0.02), dz).multiplyScalar(world.radius * 2.5).add(world.center);
    const cam = sun.shadow.camera, r = world.radius * 1.05;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 0.1; cam.far = world.radius * 5;
    cam.updateProjectionMatrix();

    // Luz difusa: nunca deixa a cena preta. À noite ela sobe um pouco e esfria,
    // como se as luzes de dentro estivessem acesas. Com teto (caminhar) o
    // interior depende mais dela, então é mais forte.
    hemi.color.lerpColors(HEMI_NIGHT, HEMI_DAY, day);
    hemi.intensity = lerp(walking ? 1.5 : 1.15, walking ? 2.5 : 1.55, day);
    fillA.intensity = lerp(0.35, 0.6, day);
    fillB.intensity = lerp(0.2, 0.32, day);

    // Céu só no modo caminhar; a maquete fica sobre o fundo escuro do site.
    if (walking) {
      skyColor(pos.elevation, scene.background);
    } else {
      scene.background.copy(CANVAS_COLOR);
    }

    renderer.shadowMap.needsUpdate = true;
    invalidate();

    const { hora, texto, frase } = describeSun(pos, state.hour, state.month);
    ui.hourOut.textContent = hora;
    ui.sunOut.textContent = frase;
    ui.hour.setAttribute("aria-valuetext", `${hora}. ${texto}`);
  }

  /* ----------------------------------------------- interface (painel) -- */

  function paintRoomList() {
    ui.rooms.textContent = "";
    const item = (label, m2, index) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rooms__btn";
      b.dataset.room = String(index);
      const n = document.createElement("span");
      n.className = "rooms__name";
      n.textContent = label;
      const a = document.createElement("span");
      a.className = "rooms__m2";
      a.textContent = m2;
      b.append(n, a);
      li.append(b);
      ui.rooms.append(li);
    };
    item("Apartamento inteiro", fmtArea(state.plan.area), -1);
    // a área de cada ambiente sai da geometria, como na landing
    for (const room of state.model.rooms) item(room.full, fmtArea(room.area), room.index);
  }

  function paintCurrentRoom() {
    let now = -1;                                 // -1 = "Apartamento inteiro"
    if (state.mode === CAMINHAR) {
      now = roomAt(state.model, state.walk.x, state.walk.y);
      if (now < 0) now = -3;                        // entre cômodos: nada destacado
    } else if (state.focus >= 0) {
      // o destaque dura enquanto o alvo da maquete continuar dentro do ambiente
      if (!flying && tweens.size === 0 && roomAt(state.model, controls.target.x, controls.target.z) !== state.focus) state.focus = -1;
      now = state.focus;
    }
    if (now === state.current) return;
    state.current = now;
    for (const b of ui.rooms.querySelectorAll("button")) {
      if (Number(b.dataset.room) === now) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
  }

  function paintHint() {
    const touch = coarsePointer.matches;
    ui.hint.textContent = state.mode === CAMINHAR
      ? (touch ? "Arraste para olhar em volta. Toque no piso para andar até lá."
               : "Arraste para olhar em volta. W, A, S, D ou setas para andar. Clique no piso para ir até lá.")
      : (touch ? "Arraste para girar a maquete. Use dois dedos para aproximar e mover."
               : "Arraste para girar a maquete. Role para aproximar. Botão direito move.");
  }

  // Bússola: a agulha aponta para onde o norte cai na tela.
  let lastNeedle = 999;
  function paintCompass() {
    const deg = needleAngle(camera, state.model.north);
    if (Math.abs(deg - lastNeedle) < 0.25) return;
    lastNeedle = deg;
    ui.dial.style.transform = `rotate(${deg.toFixed(1)}deg)`;
  }

  ui.rooms.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-room]");
    if (!b || flying) return;
    const index = Number(b.dataset.room);
    if (index < 0) {                                // apartamento inteiro
      if (state.mode === CAMINHAR) { state.orbit = null; state.focus = -1; setMode(MAQUETE); }
      else home(false);
      return;
    }
    const room = state.model.rooms[index];
    if (state.mode === CAMINHAR) walkToRoom(room);
    else focusRoom(room);
  });

  ui.maquete.addEventListener("click", () => setMode(MAQUETE));
  ui.caminhar.addEventListener("click", () => setMode(CAMINHAR));

  ui.plan.addEventListener("change", () => {
    const plan = plans.find((p) => p.id === ui.plan.value);
    if (plan && plan !== state.plan) loadPlan(plan, { push: true });
  });

  ui.hour.addEventListener("input", () => { state.hour = Number(ui.hour.value); updateSun(); });
  ui.month.addEventListener("change", () => { state.month = Number(ui.month.value); updateSun(); });

  // gaveta do painel em telas estreitas
  ui.drawer.addEventListener("click", () => {
    const open = ui.panel.classList.toggle("is-open");
    ui.drawer.setAttribute("aria-expanded", String(open));
  });

  coarsePointer.addEventListener("change", paintHint);

  /* -------------------------------------------- ponteiro e teclado -- */
  // Na maquete o OrbitControls cuida do ponteiro. No caminhar ele fica
  // desligado e estes ouvintes fazem o "arrastar para olhar" e o "tocar para
  // andar", iguais para mouse, caneta e dedo (Pointer Events).
  let drag = null;
  ui.canvas.addEventListener("pointerdown", (ev) => {
    if (state.mode !== CAMINHAR || flying || drag || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, x0: ev.clientX, y0: ev.clientY, t: performance.now(), moved: false };
    ui.canvas.setPointerCapture(ev.pointerId);
  });
  ui.canvas.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 7) drag.moved = true;
    if (drag.moved) {
      // "puxa" a cena: arrastar para a direita gira a vista para a esquerda
      const k = THREE.MathUtils.degToRad(camera.fov) / ui.canvas.clientHeight;
      state.walk.yaw += (ev.clientX - drag.x) * k;
      state.walk.pitch = clamp(state.walk.pitch + (ev.clientY - drag.y) * k, -1.25, 1.25);
      poseWalk();
      invalidate();
    }
    drag.x = ev.clientX; drag.y = ev.clientY;
  });
  const endDrag = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const tap = ev.type === "pointerup" && !drag.moved && performance.now() - drag.t < 600;
    drag = null;
    if (tap && state.mode === CAMINHAR) walkToScreenPoint(ev.clientX, ev.clientY);
  };
  ui.canvas.addEventListener("pointerup", endDrag);
  ui.canvas.addEventListener("pointercancel", endDrag);
  ui.canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // As teclas só valem com o foco na cena, nos botões de modo ou em lugar
    // nenhum (body). Com o foco na lista de ambientes ou no slider do sol, as
    // setas são deles: rolar a lista, mexer no slider.
    const el = ev.target instanceof Element ? ev.target : null;
    if (el && el !== document.body && el !== document.documentElement && !el.closest("#t-canvas, .mode")) return;
    if (state.mode === CAMINHAR) {
      if (!MOVE_KEYS.has(ev.code) || flying) return;
      ev.preventDefault();
      keys.add(ev.code);
      invalidate();
    } else if (!flying) {
      const step = 0.12;
      if (ev.code === "ArrowLeft") orbitBy(-step, 0, 1);
      else if (ev.code === "ArrowRight") orbitBy(step, 0, 1);
      else if (ev.code === "ArrowUp") orbitBy(0, -step * 0.6, 1);
      else if (ev.code === "ArrowDown") orbitBy(0, step * 0.6, 1);
      else if (ev.key === "+" || ev.key === "=") orbitBy(0, 0, 0.88);
      else if (ev.key === "-") orbitBy(0, 0, 1 / 0.88);
      else return;
      ev.preventDefault();
    }
  });
  addEventListener("keyup", (ev) => { keys.delete(ev.code); });
  addEventListener("blur", () => keys.clear());

  /* ------------------------------------------------------------ tamanho -- */
  function resize() {
    const w = Math.max(1, ui.scene.clientWidth), h = Math.max(1, ui.scene.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!state.world) return;
    setOrbitLimits();
    // enquanto o visitante não mexeu, a maquete se reenquadra sozinha
    if (state.mode === MAQUETE && !state.userMoved && !flying) home(true);
    invalidate();
  }
  new ResizeObserver(resize).observe(ui.scene);

  /* ---------------------------------------------------------------- início -- */
  fillMonths(ui.month, state.month);
  ui.hour.value = String(state.hour);

  loadPlan(planFromUrl());
  ui.status.hidden = true;
  // Só leitura, para inspeção e testes no navegador (como window.MiranteAroeira na landing).
  window.MiranteTour = {
    get plan() { return state.plan.id; },
    get mode() { return state.mode; },
    get room() { return state.current; },
    get position() { return state.mode === CAMINHAR ? [state.walk.x, state.walk.y] : null; },
    get busy() { return flying || tweens.size > 0 || !!state.walk.path; },
  };
  document.body.classList.add("is-ready");
}

/* ============================================================== móveis ==
   Cada móvel é uma composição de caixas, cilindros e esferas. O desenho é
   feito num espaço local: X = largura (W), Z = profundidade (D), costas em
   -Z, origem no centro do retângulo ocupado, no piso.
   P.box(material, x, y, z, larguraX, altura, profundidadeZ)   y = base da peça
   P.cyl(material, x, y, z, raio, altura)      P.ball(material, x, yTopo, z, raio)
   ====================================================================== */
const FURNITURE_DRAW = {
  cama(P, M, W, D) {
    const back = -D / 2;
    P.box(M.woodDark, 0, 0, 0, W - 0.12, 0.1, D - 0.12);                 // pés recuados
    P.box(M.wood, 0, 0.1, 0, W, 0.18, D);                                // estrado
    P.box(M.wood, 0, 0, back + 0.03, W, 0.95, 0.06);                     // cabeceira
    P.box(M.linen, 0, 0.28, 0.03, W - 0.06, 0.2, D - 0.1);               // colchão
    P.box(M.duvet, 0, 0.47, D * 0.16, W - 0.02, 0.05, D * 0.6);          // edredom
    const n = W >= 1.3 ? 2 : 1, pw = (W - 0.16) / n;
    for (let i = 0; i < n; i++) {
      P.box(M.white, -W / 2 + 0.08 + pw * (i + 0.5), 0.48, back + 0.3, pw - 0.08, 0.11, 0.36);   // travesseiros
    }
  },
  sofa(P, M, W, D, f) {
    const cloth = f.type === "poltrona" ? M.amber : M.fabric;
    const light = f.type === "poltrona" ? M.amberLight : M.fabricLight;
    const arm = Math.min(0.16, W * 0.16), back = -D / 2;
    P.box(M.dark, 0, 0, 0, W - 0.14, 0.09, D - 0.14);                    // pés
    P.box(cloth, 0, 0.09, 0, W, 0.26, D);                                // base
    P.box(cloth, 0, 0.35, back + 0.1, W, 0.45, 0.2);                     // encosto
    P.box(cloth, -W / 2 + arm / 2, 0.35, 0.1, arm, 0.24, D - 0.2);       // braços
    P.box(cloth, W / 2 - arm / 2, 0.35, 0.1, arm, 0.24, D - 0.2);
    const inner = W - arm * 2, n = Math.max(1, Math.round(inner / 0.75)), cw = inner / n;
    for (let i = 0; i < n; i++) {
      const x = -inner / 2 + cw * (i + 0.5);
      P.box(light, x, 0.35, 0.1, cw - 0.03, 0.12, D - 0.22);             // assentos
      P.box(light, x, 0.47, back + 0.25, cw - 0.06, 0.3, 0.1);           // almofadas do encosto
    }
  },
  poltrona(P, M, W, D, f) { FURNITURE_DRAW.sofa(P, M, W, D, f); },
  mesa(P, M, W, D) {
    P.box(M.wood, 0, 0.71, 0, W, 0.04, D);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box(M.woodDark, sx * (W / 2 - 0.07), 0, sz * (D / 2 - 0.07), 0.05, 0.71, 0.05);
    }
  },
  "mesa-lateral"(P, M, W, D) {
    P.box(M.wood, 0, 0.41, 0, W, 0.035, D);
    P.box(M.wood, 0, 0.12, 0, W - 0.08, 0.02, D - 0.08);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box(M.woodDark, sx * (W / 2 - 0.04), 0, sz * (D / 2 - 0.04), 0.03, 0.41, 0.03);
    }
  },
  cadeira(P, M, W, D) {
    P.box(M.fabricLight, 0, 0.42, 0, W, 0.05, D);
    P.box(M.woodDark, 0, 0.5, -D / 2 + 0.02, W, 0.36, 0.035);            // encosto
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.box(M.woodDark, sx * (W / 2 - 0.03), 0, sz * (D / 2 - 0.03), 0.035, sz < 0 ? 0.5 : 0.42, 0.035);
    }
  },
  bancada(P, M, W, D) {
    const back = -D / 2;
    P.box(M.dark, 0, 0, -0.03, W, 0.1, D - 0.1);                         // rodapé recuado
    P.box(M.cabinet, 0, 0.1, -0.01, W, 0.78, D - 0.04);                  // armário de baixo
    P.box(M.stone, 0, 0.88, 0, W, 0.04, D);                              // tampo
    const n = Math.max(1, Math.round(W / 0.6));
    for (let i = 1; i < n; i++) P.box(M.dark, -W / 2 + (W / n) * i, 0.12, D / 2 - 0.03, 0.006, 0.74, 0.004);
    if (W >= 1.8) {
      P.box(M.steel, -W / 4, 0.92, 0.02, 0.5, 0.005, Math.min(0.4, D - 0.16));     // cuba
      P.cyl(M.steel, -W / 4, 0.92, back + 0.08, 0.014, 0.24);                      // torneira
      P.box(M.steel, -W / 4, 1.14, back + 0.14, 0.024, 0.02, 0.14);
      P.box(M.black, W / 4, 0.92, 0.02, 0.58, 0.006, Math.min(0.48, D - 0.1));     // cooktop
    }
    if (W >= 2.5) P.box(M.cabinet, 0, 1.5, back + 0.17, W, 0.65, 0.34);            // armário aéreo
  },
  balcao(P, M, W, D) {
    P.box(M.cabinet, 0, 0, 0, W - 0.06, 1.0, D - 0.16);
    P.box(M.wood, 0, 1.0, 0, W, 0.05, D);
  },
  armario(P, M, W, D) {
    P.box(M.wardrobe, 0, 0, 0, W, 2.2, D);
    const n = Math.max(2, Math.round(W / 0.5)), front = D / 2;
    for (let i = 1; i < n; i++) P.box(M.dark, -W / 2 + (W / n) * i, 0.04, front, 0.008, 2.12, 0.004);   // frestas das portas
    for (let i = 0; i < n; i++) {
      const edge = -W / 2 + (W / n) * (i + (i % 2 ? 0 : 1));
      P.box(M.steel, edge + (i % 2 ? 0.05 : -0.05), 0.95, front + 0.008, 0.012, 0.2, 0.016);            // puxadores
    }
  },
  rack(P, M, W, D) {
    const back = -D / 2;
    P.box(M.dark, 0, 0, 0, W - 0.2, 0.08, D - 0.1);
    P.box(M.wood, 0, 0.08, 0, W, 0.4, D);
    if (W >= 1.2) {
      const tw = Math.min(W * 0.78, 1.35);
      P.box(M.black, 0, 0.48, back + 0.1, 0.3, 0.07, 0.12);              // pé da TV
      P.box(M.black, 0, 0.55, back + 0.1, tw, tw * 0.56, 0.035);         // TV
    } else {
      P.cyl(M.pot, W * 0.22, 0.48, 0, 0.07, 0.2);                        // vaso decorativo
      P.box(M.woodDark, -W * 0.2, 0.48, 0, 0.26, 0.04, 0.18);            // livros
      P.box(M.linen, -W * 0.2, 0.52, 0, 0.22, 0.03, 0.16);
    }
  },
  tapete(P, M, W, D) {
    P.box(M.rug, 0, 0.003, 0, W, 0.012, D);
  },
  planta(P, M, W, D) {
    const r = Math.min(W, D) * 0.36;
    P.cyl(M.pot, 0, 0, 0, r, 0.36);
    P.cyl(M.woodDark, 0, 0.36, 0, 0.02, 0.4);
    P.ball(M.leaf, 0, 1.3, 0, 0.3);
    P.ball(M.leaf, 0.13, 0.98, 0.09, 0.2);
    P.ball(M.leaf, -0.11, 1.04, -0.1, 0.22);
  },
  geladeira(P, M, W, D) {
    const front = D / 2;
    P.box(M.steel, 0, 0, 0, W, 1.8, D);
    P.box(M.dark, 0, 1.12, front, W, 0.01, 0.004);                       // divisão das portas
    P.box(M.dark, -W / 2 + 0.07, 1.2, front + 0.012, 0.02, 0.34, 0.024);
    P.box(M.dark, -W / 2 + 0.07, 0.62, front + 0.012, 0.02, 0.42, 0.024);
  },
  maquina(P, M, W, D) {
    const front = D / 2;
    P.box(M.white, 0, 0, 0, W, 0.88, D);
    P.box(M.dark, 0, 0.24, front, 0.36, 0.36, 0.006);                    // porta
    P.box(M.steel, 0, 0.3, front + 0.004, 0.24, 0.24, 0.006);
    P.box(M.dark, 0, 0.72, front, W - 0.08, 0.1, 0.006);                 // painel
  },
  vaso(P, M, W, D) {
    const back = -D / 2, r = Math.min(W, 0.4) / 2 - 0.01;
    P.box(M.white, 0, 0.36, back + 0.09, Math.min(W, 0.4), 0.42, 0.18);  // caixa acoplada
    P.cyl(M.white, 0, 0, back + 0.18 + r, r * 0.8, 0.38);                // base
    P.cyl(M.white, 0, 0.36, back + 0.18 + r, r, 0.05);                   // assento
  },
  pia(P, M, W, D) {
    const back = -D / 2;
    P.box(M.cabinet, 0, 0.3, -0.01, W, 0.5, D - 0.04);                   // gabinete suspenso
    P.box(M.stone, 0, 0.8, 0, W, 0.04, D);
    const bw = Math.min(W - 0.1, 0.5);
    P.box(M.white, 0, 0.84, 0.03, bw, 0.05, D * 0.62);                   // cuba
    P.cyl(M.steel, 0, 0.84, back + 0.06, 0.012, 0.16);
    P.box(M.mirror, 0, 1.1, back + 0.012, W * 0.9, 0.7, 0.012);          // espelho
  },
  box(P, M, W, D) {
    const t = 0.012, h = 1.95, back = -D / 2;
    P.box(M.white, 0, 0, 0, W, 0.03, D);                                 // piso do box
    P.box(M.glass, 0, 0.03, D / 2 - t / 2, W, h, t);
    P.box(M.glass, 0, 0.03, back + t / 2, W, h, t);
    P.box(M.glass, -W / 2 + t / 2, 0.03, 0, t, h, D - t * 2);
    P.box(M.glass, W / 2 - t / 2, 0.03, 0, t, h, D - t * 2);
    P.cyl(M.steel, 0, 1.0, back + 0.06, 0.012, 1.02);                    // coluna do chuveiro
    P.cyl(M.steel, 0, 2.0, back + 0.16, 0.09, 0.02);                     // ducha
  },
  // tipo sem desenho próprio: uma caixa na altura declarada
  fallback(P, M, W, D, f) {
    P.box(M.wood, 0, 0, 0, W, f.z1, D);
  },
};

/* ---------------------------------------------------------------- partida --
   Fica no fim do arquivo: start() usa FURNITURE_DRAW, que precisa já estar
   declarado quando a primeira planta é montada. */
try {
  renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: "high-performance" });
} catch (err) {
  renderer = null;
}

let started = false;
if (renderer) {
  // Um erro ao montar a cena (dados de planta inválidos, por exemplo) não
  // pode deixar a página presa em "Carregando": cai na mesma mensagem.
  try {
    start();
    started = true;
  } catch (err) {
    console.error(err);
  }
}
if (!started) {
  // Sem WebGL ou sem cena: mensagem clara e o caminho de volta para a planta 2D.
  ui.status.hidden = true;
  ui.canvas.hidden = true;
  ui.compass.hidden = true;
  ui.hint.hidden = true;
  ui.panel.hidden = true;
  ui.fallback.hidden = false;
  const plan = planFromUrl();
  ui.plan.value = plan.id;
  document.title = `Tour 3D · ${plan.title}, ${fmtArea(plan.area)} · ${BRAND}`;
  ui.plan.addEventListener("change", () => { location.search = "?planta=" + encodeURIComponent(ui.plan.value); });
}

/* ============================================================================
   Mirante Aroeira: a "vista da varanda" do espelho de vendas.

   O que é só da vista e precisa do three.js: a camada da cidade (caixas,
   morros, árvores, chão, luzes da noite, céu e sol), a direção do olhar de
   quem está na varanda e o arrasto que olha em volta. O estado da página
   (modo, unidade escolhida, voo da câmera, interface) continua em espelho.js.

   A cidade é fictícia e vem pronta de tour/city.js, um módulo puro. Aqui ela
   só é desenhada. Eixos da cena, como em espelho.js: X = x da laje, Z = y da
   laje, Y = altura.
   ========================================================================== */
import * as THREE from "three";
import { buildCity, hillHeight, CITY } from "./city.js";
import { clamp, lerp, smooth } from "./common.js";

export const VISTA = Object.freeze({
  fov: 62, fovMin: 34, fovMax: 74,     // campo de visão vertical, em graus
  near: 0.2, far: 16000,               // perto o bastante para o guarda-corpo, longe o bastante para a serra
  yawMax: 85,                          // quanto se vira para cada lado, a partir da normal da fachada
  pitchMin: -55, pitchMax: 30,
  pitch: -7,                           // olhar inicial, levemente para baixo
  fogNear: 100, fogFar: 7800,
  skyRadius: 12000, sunDistance: 10000, groundRadius: 15000,
});

const RAD = Math.PI / 180;

/* ------------------------------------------------------------- o olhar -- */

/** Rumo (0 = olhando para -Z, horário visto de cima) e inclinação de um vetor, em radianos. */
export function anglesOf(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { heading: Math.atan2(v.x, -v.z), pitch: Math.asin(clamp(v.y / l, -1, 1)) };
}

/** Vetor unitário de um rumo e de uma inclinação (radianos). Escreve em out. */
export function directionOf(heading, pitch, out) {
  const c = Math.cos(pitch);
  return out.set(Math.sin(heading) * c, Math.sin(pitch), -Math.cos(heading) * c);
}

/**
 * O olhar de quem está na varanda: um desvio (yaw) em torno da normal da
 * fachada e uma inclinação (pitch), em graus, mais o campo de visão. Tudo
 * preso aos limites de VISTA.
 */
export function createLook() {
  const dir = new THREE.Vector3();
  const look = {
    base: 0,                           // rumo da normal da fachada, em radianos
    yaw: 0, pitch: VISTA.pitch, fov: VISTA.fov,
    /** Aponta para a fachada de normal [nx, ny] (sistema da laje) e volta ao olhar inicial. */
    face(normal, keep = false) {
      look.base = Math.atan2(normal[0], -normal[1]);
      // vista nova: olhar e lente voltam ao começo (a lente não fica da visita anterior)
      if (!keep) { look.yaw = 0; look.pitch = VISTA.pitch; look.fov = VISTA.fov; }
    },
    turn(dYaw, dPitch) {
      look.yaw = clamp(look.yaw + dYaw, -VISTA.yawMax, VISTA.yawMax);
      look.pitch = clamp(look.pitch + dPitch, VISTA.pitchMin, VISTA.pitchMax);
    },
    zoom(factor) {
      look.fov = clamp(look.fov * factor, VISTA.fovMin, VISTA.fovMax);
    },
    get heading() { return look.base + look.yaw * RAD; },
    direction(out = dir) { return directionOf(look.heading, look.pitch * RAD, out); },
    /** Põe a câmera no ponto dos olhos, com este olhar. */
    apply(camera, eye) {
      camera.position.copy(eye);
      camera.up.set(0, 1, 0);
      camera.lookAt(dir.copy(look.direction()).add(eye));
      if (camera.fov !== look.fov) { camera.fov = look.fov; camera.updateProjectionMatrix(); }
    },
  };
  return look;
}

/**
 * Arrastar olha em volta, pinça e roda mudam o campo de visão. Só age
 * enquanto active() devolve true; fora disso a cena é do OrbitControls.
 * @param {{ active: () => boolean, turn: (dx: number, dy: number) => void, zoom: (factor: number) => void }} on
 *        turn recebe o arrasto em pixels; zoom, o fator do campo de visão
 * @returns {() => void} função que tira os ouvintes do canvas
 */
export function attachLook(canvas, on) {
  const pts = new Map();
  let pinch = 0;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  // Vale para soltar, cancelar e perder a captura: um toque que some sem
  // "pointerup" não pode ficar na conta, senão um dedo só passaria por pinça.
  // Com três dedos e um a menos, a pinça recomeça da abertura dos dois que ficaram.
  const drop = (ev) => { pts.delete(ev.pointerId); pinch = pts.size === 2 ? spread() : 0; };
  const ctl = new AbortController();
  const opts = { signal: ctl.signal };
  canvas.addEventListener("pointerdown", (ev) => {
    if (!on.active() || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* ponteiro que já saiu */ }
    pinch = pts.size === 2 ? spread() : 0;
  }, opts);
  canvas.addEventListener("pointermove", (ev) => {
    const p = pts.get(ev.pointerId);
    if (!p) return;
    if (!on.active()) { pts.clear(); return; }
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (pts.size === 1) on.turn(dx, dy);
    else if (pts.size === 2) {
      const d = spread();
      if (pinch > 0 && d > 0) on.zoom(pinch / d);    // abrir os dedos aproxima
      pinch = d;
    }
  }, opts);
  canvas.addEventListener("pointerup", drop, opts);
  canvas.addEventListener("pointercancel", drop, opts);
  canvas.addEventListener("lostpointercapture", drop, opts);
  canvas.addEventListener("wheel", (ev) => {
    if (!on.active()) return;
    ev.preventDefault();
    const lines = ev.deltaMode === 1 ? 16 : 1;
    on.zoom(Math.exp(clamp(ev.deltaY * lines, -240, 240) * 0.0012));
  }, { passive: false, signal: ctl.signal });
  return () => ctl.abort();
}

/* --------------------------------------------------------------- o céu -- */
// Céu da vista pela altura do sol (graus): alto do céu, bruma do horizonte
// (que é também a cor da névoa), cor da faixa de luz perto do sol e a força
// dela. Mais fundo que um céu de verdade, para conversar com o tema escuro.
const SKY = [
  { e: -14, top: 0x050812, haze: 0x0e1424, band: 0x1a2038, amount: 0 },
  { e: -6, top: 0x0a1230, haze: 0x2a2a44, band: 0xc8623a, amount: 0.5 },
  { e: 0, top: 0x1a2c5a, haze: 0x7d6a78, band: 0xf58f4c, amount: 0.95 },
  { e: 7, top: 0x33588f, haze: 0xa9a2a6, band: 0xf7bf8a, amount: 0.7 },
  { e: 20, top: 0x34609e, haze: 0x97b0c9, band: 0xffe9cf, amount: 0.2 },
  { e: 70, top: 0x2b579a, haze: 0x93aecb, band: 0xffffff, amount: 0.1 },
].map((k) => ({ ...k, top: new THREE.Color(k.top), haze: new THREE.Color(k.haze), band: new THREE.Color(k.band) }));

function skyAt(elevation, out) {
  const e = Number.isFinite(elevation) ? clamp(elevation, SKY[0].e, SKY[SKY.length - 1].e) : 0;
  let i = 0;
  while (i < SKY.length - 2 && e > SKY[i + 1].e) i++;
  const a = SKY[i], b = SKY[i + 1], t = (e - a.e) / (b.e - a.e);
  out.top.lerpColors(a.top, b.top, t);
  out.haze.lerpColors(a.haze, b.haze, t);
  out.band.lerpColors(a.band, b.band, t);
  out.amount = lerp(a.amount, b.amount, t);
  return out;
}

const SKY_VERT = "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
const SKY_FRAG = `
uniform vec3 top; uniform vec3 haze; uniform vec3 band; uniform vec3 sunDir;
uniform float amount; uniform float stars; uniform float opacity;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(haze, top, pow(h, 0.42));
  // faixa de luz baixa, mais forte do lado do sol
  vec2 a = normalize(d.xz + vec2(1e-5)), s = normalize(sunDir.xz + vec2(1e-5));
  float side = pow(max(dot(a, s) * 0.5 + 0.5, 0.0), 3.0);
  col = mix(col, band, amount * exp(-h * 7.5) * (0.22 + 0.78 * side));
  // halo em volta do sol
  float sd = max(dot(d, normalize(sunDir)), 0.0);
  col += band * (pow(sd, 12.0) * 0.16 + pow(sd, 90.0) * 0.3) * step(-0.12, sunDir.y);
  // estrelas, só bem depois do pôr do sol e longe do horizonte
  vec2 uv = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 58.0;
  vec2 id = floor(uv), f = fract(uv) - 0.5;
  float r = hash(id);
  vec2 jitter = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float star = step(0.972, r) * smoothstep(0.13, 0.02, length(f - jitter * 0.6));
  col += vec3(0.85, 0.9, 1.0) * star * stars * (0.35 + 0.65 * hash(id + 11.3)) * smoothstep(0.04, 0.3, d.y);
  gl_FragColor = vec4(col, opacity);
  #include <colorspace_fragment>
}`;

const SUN_FRAG = `
uniform vec3 color; uniform float opacity; varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float disc = smoothstep(0.125, 0.105, r);
  float halo = pow(max(1.0 - r, 0.0), 3.2) * 0.55;
  gl_FragColor = vec4(color * (disc * 1.6 + halo), (disc + halo) * opacity);
  #include <colorspace_fragment>
}`;

const LIGHT_VERT = `
attribute float size; attribute float kind; attribute float wake; attribute vec3 tint;
uniform float scale; uniform float pixel; uniform float night; uniform float haze;
varying vec3 vTint; varying float vAlpha; varying float vRound;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // um fio à frente da parede: de longe a profundidade não separa 30 cm
  gl_Position.z -= 4e-7 * gl_Position.w;
  float dist = -mv.z;
  float px = size * scale / max(dist, 0.1);
  float least = 1.5 * pixel;
  gl_PointSize = clamp(px, least, 26.0 * pixel);
  // cada luz acende numa hora (wake); as que ficariam menores que um ponto perdem brilho
  float on = smoothstep(wake - 0.12, wake + 0.12, night);
  vAlpha = on * clamp(px / least, 0.3, 1.0) * exp(-dist / haze);
  vTint = tint; vRound = kind;
}`;
const LIGHT_FRAG = `
uniform float opacity; varying vec3 vTint; varying float vAlpha; varying float vRound;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  // postes são um brilho redondo; janelas, um retângulo de borda macia
  float glow = pow(max(1.0 - r, 0.0), 1.6);
  float pane = smoothstep(0.5, 0.36, abs(c.x)) * smoothstep(0.5, 0.3, abs(c.y) * 1.25);
  float a = mix(pane, glow, vRound) * vAlpha * opacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
}`;

/* ------------------------------------------------------- as fachadas -- */
// De dia as caixas ganham fiadas de janelas escuras (na mesma grade em que
// tour/city.js acende as luzes da noite) e uma cor de cobertura. É uma conta
// por pixel no material de sempre, sem textura.
function facadeMaterial({ name, roof, roofMix, glass, win }) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const v = (c) => { const k = new THREE.Color(c); return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`; };
  const cover = ((win[1] - win[0]) * (win[3] - win[2])).toFixed(4);
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCityPos; varying vec3 vCityN;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec4 cityAt = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cityAt = instanceMatrix * cityAt;
        #endif
        vCityPos = (modelMatrix * cityAt).xyz; vCityN = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCityPos; varying vec3 vCityN;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        if (vCityN.y > 0.5) {
          diffuseColor.rgb = mix(diffuseColor.rgb, ${v(roof)}, ${roofMix.toFixed(3)});
        } else if (vCityN.y > -0.5) {
          float along = abs(vCityN.x) > 0.5 ? vCityPos.z : vCityPos.x;
          vec2 g = vec2(along / ${CITY.bay.toFixed(3)}, vCityPos.y / ${CITY.floor.toFixed(3)});
          vec2 f = fract(g);
          float pane = step(${win[0].toFixed(3)}, f.x) * step(f.x, ${win[1].toFixed(3)}) * step(${win[2].toFixed(3)}, f.y) * step(f.y, ${win[3].toFixed(3)});
          // de longe as janelas viram um tom médio, em vez de chuvisco
          float sharp = 1.0 - smoothstep(0.16, 0.55, max(fwidth(g.x), fwidth(g.y)));
          diffuseColor.rgb *= mix(vec3(1.0), ${v(glass)}, mix(${cover}, pane, sharp));
        }`);
  };
  m.customProgramCacheKey = () => `mirante-cidade-${name}`;
  return m;
}

// uma cor por caixa, sorteada na paleta do tipo pelo "tone" que vem dos dados
const PALETTE = {
  casa: [0xb9ad9c, 0xa8977f, 0xc2b8a8, 0x9c8a74, 0xb0a593, 0xb39a7e, 0xa9988c, 0x9aa39a],
  predio: [0x9f9a90, 0x8d8a83, 0xaea696, 0x85827c, 0x988f80, 0xa8a39a, 0x8f969b, 0xa3927f],
  bloco: [0x8e8a82, 0x807e79, 0x989184, 0x89837a],
  torre: [0x76879a, 0x6a7c90, 0x8693a0, 0x61738a, 0x8c979f, 0x7a8590],
};
const KIND_MATERIAL = { casa: "casa", predio: "predio", bloco: "predio", torre: "torre" };
const LIGHT_TINT = {
  janela: [0xf2c98e, 0xf0b76c, 0xeedcb8, 0xf2c180, 0xf0b76c, 0xc4d2ea],
  poste: [0xffb060, 0xffa54d, 0xffbb70],
  longe: [0xffc98a, 0xffd9a8, 0xffb872, 0xeef2ff],
};
const LAND = new THREE.Color(0x49524a);          // o chão de espelho.js (M.land)

/* ----------------------------------------------------------- o chão -- */
// O chão é uma textura pintada num canvas a partir dos dados da cidade: ruas,
// calçadas dos lotes, parque e lago. Duas, para caber em celular: uma do
// entorno, com detalhe, e uma da cidade inteira.
function paintGround(city, half, size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  const k = size / (2 * half);
  const X = (x) => (x - city.center.x + half) * k, Y = (y) => (y - city.center.y + half) * k;
  const css = (c) => `#${new THREE.Color(c).getHexString()}`;

  g.fillStyle = css(LAND);
  g.fillRect(0, 0, size, size);
  // manchas largas de verde e de terra, para o chão não ser uma cor só
  let seed = city.seed >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 900; i++) {
    const r = (60 + rnd() * 260) * k, x = rnd() * size, y = rnd() * size;
    g.fillStyle = ["rgba(74,92,68,0.16)", "rgba(92,90,78,0.14)", "rgba(58,70,58,0.16)", "rgba(100,104,96,0.1)"][Math.floor(rnd() * 4)];
    g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2); g.fill();
  }
  // o chão de cada lote: calçada e quintal em volta da caixa
  for (const b of city.boxes) {
    if (b.crown) continue;
    const pad = b.kind === "bloco" ? 14 : 3.2;
    g.fillStyle = b.kind === "casa" ? "rgba(120,116,104,0.5)" : b.kind === "bloco" ? "rgba(112,110,104,0.42)" : "rgba(134,131,124,0.6)";
    g.fillRect(X(b.x0 - pad), Y(b.y0 - pad), (b.x1 - b.x0 + 2 * pad) * k, (b.y1 - b.y0 + 2 * pad) * k);
  }
  // parque e lago
  const ellipse = (e, grow) => { g.beginPath(); g.ellipse(X(e.x), Y(e.y), (e.rx + grow) * k, (e.ry + grow) * k, 0, 0, Math.PI * 2); g.fill(); };
  for (const p of city.parks) { g.fillStyle = "#4d5f47"; ellipse(p, 6); g.fillStyle = "#42583d"; ellipse(p, -8); }
  for (const t of city.trees) { g.fillStyle = "rgba(48,68,46,0.55)"; g.beginPath(); g.arc(X(t.x), Y(t.y), Math.max(1, t.r * 1.3 * k), 0, Math.PI * 2); g.fill(); }
  for (const w of city.water) { g.fillStyle = "#6f7f76"; ellipse(w, 5); g.fillStyle = "#3f6470"; ellipse(w, 0); }
  // ruas por cima de tudo
  g.lineCap = "butt";
  for (const pass of ["calcada", "asfalto"]) for (const s of city.streets) {
    // a textura cobre até "half": o que encostasse na borda se repetiria até o horizonte
    if (Math.max(Math.abs(s.x0 - city.center.x), Math.abs(s.x1 - city.center.x), Math.abs(s.y0 - city.center.y), Math.abs(s.y1 - city.center.y)) > half * 0.97) continue;
    const walk = pass === "calcada";
    if (walk && s.kind === "estrada") continue;
    g.strokeStyle = walk ? "#77746e" : "#33363b";
    g.lineWidth = Math.max(walk ? 0 : 1.1, (s.w + (walk ? 5 : 0)) * k);
    if (g.lineWidth <= 0 || (walk && g.lineWidth < 2.2)) continue;
    g.lineCap = s.kind === "estrada" ? "butt" : "square";
    g.beginPath(); g.moveTo(X(s.x0), Y(s.y0)); g.lineTo(X(s.x1), Y(s.y1)); g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/* ------------------------------------------------------------ a camada -- */

/**
 * Monta a cidade em volta da torre. Nasce invisível: quem liga é setBlend.
 * @param {{ tower: object, center: THREE.Vector3, neighbors?: object[], maxAnisotropy?: number, light?: boolean }} opts
 *        center é o centro da torre na cena; neighbors são os vizinhos de
 *        buildSite, que na vista ganham as mesmas fachadas da cidade (quem
 *        chama esconde os lisos); light pede texturas menores (celular)
 */
export function createCityLayer({ tower, center, neighbors = [], maxAnisotropy = 1, light = false }) {
  const city = buildCity(tower);
  const trash = [];
  const keep = (x) => { trash.push(x); return x; };
  const group = new THREE.Group();
  group.visible = false;
  const rise = new THREE.Group();                // o que "cresce" do chão ao entrar na vista
  group.add(rise);
  const I = new THREE.Quaternion(), color = new THREE.Color();
  const pick = (list, t) => list[Math.min(list.length - 1, Math.floor(t * list.length))];

  /* caixas: um InstancedMesh por material, sem sombra */
  const mats = {
    casa: keep(facadeMaterial({ name: "casa", roof: 0x7c4c39, roofMix: 0.86, glass: 0x8a9096, win: [0.28, 0.72, 0.34, 0.72] })),
    predio: keep(facadeMaterial({ name: "predio", roof: 0x7b7873, roofMix: 0.75, glass: 0x7a858f, win: [0.2, 0.8, 0.36, 0.78] })),
    torre: keep(facadeMaterial({ name: "torre", roof: 0x565c64, roofMix: 0.85, glass: 0x64809c, win: [0.07, 0.93, 0.2, 0.92] })),
  };
  const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const byMat = { casa: [], predio: [], torre: [] };
  for (const b of city.boxes) byMat[KIND_MATERIAL[b.kind] || "predio"].push(b);
  const m4 = new THREE.Matrix4(), p3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const instanced = (list, material, parent) => {
    const mesh = new THREE.InstancedMesh(boxGeo, material, list.length);
    list.forEach((b, i) => {
      mesh.setMatrixAt(i, m4.compose(p3.set((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, (b.y0 + b.y1) / 2), I, s3.set(b.x1 - b.x0, b.z1 - b.z0, b.y1 - b.y0)));
      mesh.setColorAt(i, color.set(pick(PALETTE[b.kind] || PALETTE.predio, b.tone)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    parent.add(mesh);
    trash.push(mesh);
    return mesh;
  };
  for (const [name, list] of Object.entries(byMat)) if (list.length) instanced(list, mats[name], rise);

  /* os vizinhos da torre, com as mesmas fachadas: são os prédios mais perto
     da varanda, e lisos destoavam da cidade atrás. Estes já existem no modo
     torre, então não sobem do chão e continuam com sombra. */
  const dressed = neighbors.map((b, i) => ({ ...b, kind: b.z1 - b.z0 < 9.5 ? "casa" : "predio", tone: (i * 0.618034) % 1 }));
  for (const name of ["casa", "predio"]) {
    const list = dressed.filter((b) => b.kind === name);
    if (!list.length) continue;
    const mesh = instanced(list, mats[name], group);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  /* morros: a mesma calota de hillHeight, uma instância por morro */
  const RINGS = 9, SEGS = 30;
  const hp = [0, 1, 0], hi = [];
  for (let r = 1; r <= RINGS; r++) for (let s = 0; s < SEGS; s++) {
    const rad = r / RINGS, a = (s / SEGS) * Math.PI * 2;
    hp.push(Math.cos(a) * rad, hillHeight({ x: 0, y: 0, rx: 1, ry: 1, h: 1 }, Math.cos(a) * rad, Math.sin(a) * rad), Math.sin(a) * rad);
  }
  const at = (r, s) => 1 + (r - 1) * SEGS + (s % SEGS);
  for (let s = 0; s < SEGS; s++) hi.push(0, at(1, s + 1), at(1, s));
  for (let r = 1; r < RINGS; r++) for (let s = 0; s < SEGS; s++) hi.push(at(r, s), at(r, s + 1), at(r + 1, s), at(r, s + 1), at(r + 1, s + 1), at(r + 1, s));
  const hillGeo = keep(new THREE.BufferGeometry());
  hillGeo.setAttribute("position", new THREE.Float32BufferAttribute(hp, 3));
  hillGeo.setIndex(hi);
  hillGeo.computeVertexNormals();
  const hillMat = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const hillMesh = new THREE.InstancedMesh(hillGeo, hillMat, city.hills.length);
  city.hills.forEach((h, i) => {
    hillMesh.setMatrixAt(i, m4.compose(p3.set(h.x, -0.5, h.y), I, s3.set(h.rx, h.h, h.ry)));
    hillMesh.setColorAt(i, color.set(h.range === "serra" ? pick([0x35463c, 0x2f4038, 0x3a4a3d], (i * 0.37) % 1) : pick([0x43523f, 0x3c4b3b, 0x4a5644], (i * 0.61) % 1)));
  });
  hillMesh.instanceColor.needsUpdate = true;
  hillMesh.computeBoundingSphere();
  rise.add(hillMesh);
  trash.push(hillMesh);

  /* árvores do parque e das praças: só a copa (de longe o tronco não aparece) */
  const leafMat = keep(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  if (city.trees.length) {
    const treeMesh = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(0.5, 1)), leafMat, city.trees.length);
    city.trees.forEach((t, i) => {
      treeMesh.setMatrixAt(i, m4.compose(p3.set(t.x, t.h - t.r * 0.95, t.y), I, s3.set(t.r * 2.1, Math.min(t.h, t.r * 2.3), t.r * 2.1)));
      treeMesh.setColorAt(i, color.set(pick([0x4d6e48, 0x44633f, 0x5d8054, 0x3f5a3c], (i * 0.283) % 1)));
    });
    treeMesh.instanceColor.needsUpdate = true;
    treeMesh.computeBoundingSphere();
    rise.add(treeMesh);
    trash.push(treeMesh);
  }

  /* chão: um disco com o entorno em detalhe e um anel com a cidade inteira,
     lado a lado (nada sobreposto, então nada pisca de longe) */
  const NEAR = 620, texSize = light ? 1024 : 2048;
  const blendU = { value: 0 };
  const groundMat = (tex) => {
    tex.anisotropy = Math.min(8, maxAnisotropy);
    keep(tex);
    const m = keep(new THREE.MeshLambertMaterial({ map: tex }));
    m.onBeforeCompile = (shader) => {
      shader.uniforms.cityBlend = blendU;
      // ao entrar e sair da vista o chão vem da cor lisa do chão da torre
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float cityBlend;")
        .replace("#include <map_fragment>", `#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(${LAND.r.toFixed(4)}, ${LAND.g.toFixed(4)}, ${LAND.b.toFixed(4)}), diffuseColor.rgb, cityBlend);`);
    };
    m.customProgramCacheKey = () => "mirante-cidade-chao";
    return m;
  };
  const flat = (geo, half) => {
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (2 * half) + 0.5, 0.5 - pos.getZ(i) / (2 * half));
    return keep(geo);
  };
  const FAR_HALF = CITY.far + 700;
  const grounds = [
    new THREE.Mesh(flat(new THREE.CircleGeometry(NEAR, 48), NEAR), groundMat(paintGround(city, NEAR, texSize))),
    new THREE.Mesh(flat(new THREE.RingGeometry(NEAR, VISTA.groundRadius, 48, 1), FAR_HALF), groundMat(paintGround(city, FAR_HALF, texSize))),
  ];
  for (const g of grounds) {
    g.position.set(center.x, -0.02, center.z);
    g.receiveShadow = true;
    group.add(g);
  }

  /* luzes da noite: pontos, com o brilho pela noite (1 - day) */
  const lights = [...city.lights, ...city.siteLights];
  const n = lights.length;
  const lp = new Float32Array(n * 3), lt = new Float32Array(n * 3), ls = new Float32Array(n), lk = new Float32Array(n), lw = new Float32Array(n);
  lights.forEach((l, i) => {
    const r = ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;      // sempre o mesmo por luz
    lp.set([l.x, l.z, l.y], i * 3);
    color.set(pick(LIGHT_TINT[l.kind] || LIGHT_TINT.longe, r));
    lt.set([color.r, color.g, color.b], i * 3);
    ls[i] = l.kind === "janela" ? 1.5 : l.kind === "poste" ? 3.4 : 4.2;
    lk[i] = l.kind === "janela" ? 0 : 1;
    // os postes acendem primeiro; as janelas, aos poucos, até a noite fechada
    lw[i] = l.kind === "poste" ? 0.3 + r * 0.12 : 0.36 + ((r * 7.13) % 1) * 0.5;
  });
  const lightGeo = keep(new THREE.BufferGeometry());
  lightGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  lightGeo.setAttribute("tint", new THREE.BufferAttribute(lt, 3));
  lightGeo.setAttribute("size", new THREE.BufferAttribute(ls, 1));
  lightGeo.setAttribute("kind", new THREE.BufferAttribute(lk, 1));
  lightGeo.setAttribute("wake", new THREE.BufferAttribute(lw, 1));
  lightGeo.computeBoundingSphere();
  const lightMat = keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { scale: { value: 600 }, pixel: { value: 1 }, night: { value: 0 }, haze: { value: 5200 }, opacity: { value: 0 } },
    vertexShader: LIGHT_VERT, fragmentShader: LIGHT_FRAG,
  }));
  const lightPoints = new THREE.Points(lightGeo, lightMat);
  lightPoints.renderOrder = 4;
  lightPoints.frustumCulled = false;
  rise.add(lightPoints);

  /* céu da vista e disco do sol */
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, transparent: true,
    uniforms: {
      top: { value: new THREE.Color() }, haze: { value: new THREE.Color() }, band: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, amount: { value: 0 }, stars: { value: 0 }, opacity: { value: 0 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  }));
  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(VISTA.skyRadius, 32, 16)), skyMat);
  sky.position.copy(center);
  sky.renderOrder = -0.5;
  sky.frustumCulled = false;
  group.add(sky);

  const sunMat = keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { color: { value: new THREE.Color(0xffffff) }, opacity: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: SUN_FRAG,
  }));
  const sunDisc = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), sunMat);
  sunDisc.scale.setScalar(2 * VISTA.sunDistance * Math.tan(7 * RAD));     // o halo inteiro tem 7° de raio
  sunDisc.renderOrder = 0;
  sunDisc.frustumCulled = false;
  group.add(sunDisc);

  const now = { top: new THREE.Color(), haze: new THREE.Color(), band: new THREE.Color(), amount: 0 };
  const sunDir = new THREE.Vector3(0, 1, 0);
  let sunUp = 0, blend = 0;
  const size = new THREE.Vector2();

  const layer = {
    group,
    /** A névoa da vista: cor (a bruma do horizonte) e distâncias. */
    fog: { color: new THREE.Color(), near: VISTA.fogNear, far: VISTA.fogFar },
    counts: { boxes: city.boxes.length, lights: lights.length, hills: city.hills.length, trees: city.trees.length },

    /** Cores e brilhos pela posição do sol. direction aponta da cena para o sol. */
    update({ direction, elevation, day, color: sunColor }) {
      skyAt(elevation, now);
      sunDir.set(direction[0], direction[1], direction[2]).normalize();
      const u = skyMat.uniforms;
      u.top.value.copy(now.top); u.haze.value.copy(now.haze); u.band.value.copy(now.band);
      u.amount.value = now.amount; u.sunDir.value.copy(sunDir);
      u.stars.value = 1 - smooth(-12, -4, elevation);
      layer.fog.color.copy(now.haze);
      // a noite escurece as fachadas (a luz difusa da cena é pensada para a torre)
      const dim = lerp(0.3, 1, day);
      for (const m of Object.values(mats)) m.color.setScalar(dim);
      hillMat.color.setScalar(lerp(0.34, 1, day));
      leafMat.color.setScalar(lerp(0.3, 1, day));
      for (const g of grounds) g.material.color.setScalar(lerp(0.45, 1, day));
      lightMat.uniforms.night.value = 1 - day;
      sunMat.uniforms.color.value.copy(sunColor);
      sunUp = smooth(-1.6, 0.6, elevation);
      layer.setBlend(blend);
    },

    /** 0 = torre (camada invisível), 1 = vista. No meio, a cidade sobe do chão. */
    setBlend(k) {
      blend = clamp(k, 0, 1);
      group.visible = blend > 0;
      rise.scale.y = Math.max(0.0001, blend * blend * (3 - 2 * blend));
      blendU.value = blend;
      skyMat.uniforms.opacity.value = blend;
      lightMat.uniforms.opacity.value = blend;
      sunMat.uniforms.opacity.value = blend * sunUp;
      sunDisc.visible = sunUp > 0;
    },

    /** A cada quadro com a vista ligada: o que depende da câmera. */
    frame(camera, renderer) {
      renderer.getDrawingBufferSize(size);
      lightMat.uniforms.scale.value = size.y / (2 * Math.tan((camera.fov * RAD) / 2));
      lightMat.uniforms.pixel.value = renderer.getPixelRatio();
      sunDisc.position.copy(camera.position).addScaledVector(sunDir, VISTA.sunDistance);
      sunDisc.quaternion.copy(camera.quaternion);
    },

    dispose() {
      for (const x of trash) x.dispose();
    },
  };
  return layer;
}

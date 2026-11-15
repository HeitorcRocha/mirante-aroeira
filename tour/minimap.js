/**
 * Mini-mapa do tour 3D e a conta da vista de topo de um ambiente.
 *
 * Módulo puro: não importa three.js nem nada de "node:". Recebe o modelo de
 * geometry.js (buildModel) e devolve texto SVG e números; quem insere na
 * página e move a câmera é o tour.js. Assim dá para testar tudo no Node.
 *
 * Coordenadas: as da planta (metros, origem no canto superior esquerdo, y
 * para baixo). O viewBox do SVG usa essas mesmas unidades, então o mapa sai
 * na mesma orientação da planta 2D e da vista de topo.
 */

const EPS = 1e-6;
const num = (v) => String(Math.round(v * 1000) / 1000);   // 3 casas bastam (milímetro)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ---------------------------------------------------------------- formas -- */

/** Preenchimento de um ambiente: um retângulo por trecho, num só path. */
export function roomFill(rects) {
  return rects.map((q) => `M${num(q.x0)} ${num(q.y0)}H${num(q.x1)}V${num(q.y1)}H${num(q.x0)}Z`).join("");
}

/**
 * Contorno de um ambiente feito de vários retângulos, sem as emendas entre
 * eles. Sem isso, o "L" do studio ganhava uma linha no meio do cômodo quando
 * destacado. Cada aresta perde os trechos que coincidem com a aresta de outro
 * retângulo do mesmo ambiente (lado a lado, a emenda é compartilhada).
 */
export function roomOutline(rects) {
  const edges = [];
  rects.forEach((q, i) => {
    edges.push({ i, axis: "h", c: q.y0, a: q.x0, b: q.x1 }, { i, axis: "h", c: q.y1, a: q.x0, b: q.x1 });
    edges.push({ i, axis: "v", c: q.x0, a: q.y0, b: q.y1 }, { i, axis: "v", c: q.x1, a: q.y0, b: q.y1 });
  });
  let d = "";
  for (const e of edges) {
    let parts = [[e.a, e.b]];
    for (const o of edges) {
      if (o.i === e.i || o.axis !== e.axis || Math.abs(o.c - e.c) > EPS) continue;
      parts = parts.flatMap(([a, b]) => {
        const lo = Math.max(a, o.a), hi = Math.min(b, o.b);
        if (hi - lo <= EPS) return [[a, b]];
        return [[a, lo], [hi, b]].filter(([p, q]) => q - p > EPS);
      });
    }
    for (const [a, b] of parts) {
      d += e.axis === "h" ? `M${num(a)} ${num(e.c)}H${num(b)}` : `M${num(e.c)} ${num(a)}V${num(b)}`;
    }
  }
  return d;
}

/**
 * Cunha da direção do olhar no modo caminhar, como path SVG.
 * yaw segue a câmera do tour: 0 olha para y negativo (alto da planta) e cresce
 * girando para a esquerda, a frente no plano é (-sen yaw, -cos yaw).
 */
export function viewWedge(x, y, yaw, radius = 1.4, spread = Math.PI / 3) {
  const p = (a) => [x - Math.sin(a) * radius, y - Math.cos(a) * radius];
  const [ax, ay] = p(yaw + spread / 2), [bx, by] = p(yaw - spread / 2);
  // o arco vai de "esquerda" para "direita" da vista: sentido horário na tela
  return `M${num(x)} ${num(y)}L${num(ax)} ${num(ay)}A${num(radius)} ${num(radius)} 0 0 1 ${num(bx)} ${num(by)}Z`;
}

/* ----------------------------------------------------------------- mapa -- */

/**
 * Descrição neutra do mini-mapa: viewBox, um item por ambiente e as paredes.
 * @param {object} model  saída de buildModel
 * @param {{ pad?: number }} [opt]  folga em volta, em metros
 */
export function minimapData(model, { pad = 0.35 } = {}) {
  if (!model || !model.bounds || !Array.isArray(model.rooms)) throw new TypeError("minimapData: modelo inválido");
  const B = model.bounds;
  const viewBox = [B.x0 - pad, B.y0 - pad, B.x1 - B.x0 + pad * 2, B.y1 - B.y0 + pad * 2];
  const rooms = model.rooms.map((room) => ({
    index: room.index, name: room.full,
    fill: roomFill(room.rects), outline: roomOutline(room.rects),
  }));
  // Só o que vai do piso para cima: as vergas sobre portas e panos de vidro
  // ficam de fora, assim cada vão aparece aberto como na planta 2D. O peitoril
  // (embaixo da janela) entra à parte, mais claro, para marcar a janela.
  const rect = (w) => ({ x: w.x0, y: w.y0, w: w.x1 - w.x0, h: w.y1 - w.y0 });
  const walls = model.walls.filter((w) => w.z0 < EPS && w.kind !== "peitoril").map(rect);
  const windows = model.walls.filter((w) => w.kind === "peitoril").map(rect);
  return { viewBox, rooms, walls, windows };
}

/**
 * O mini-mapa pronto, como texto SVG. Cada ambiente é um <path data-room>
 * (preenchimento) com o contorno em outro path, para o destaque não ter
 * emenda. O marcador do visitante vai num <g> vazio que o tour preenche.
 */
export function minimapSvg(model, { title = model && model.title } = {}) {
  const { viewBox, rooms, walls, windows } = minimapData(model);
  const r = (q, cls) => `<rect class="${cls}" x="${num(q.x)}" y="${num(q.y)}" width="${num(q.w)}" height="${num(q.h)}"/>`;
  const label = `Mini-mapa do apartamento ${title || ""}`.trim();
  return [
    `<svg class="minimap__svg" viewBox="${viewBox.map(num).join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(label)}" focusable="false">`,
    `<g class="minimap__rooms">`,
    ...rooms.map((room) => `<path class="minimap__room" data-room="${room.index}" d="${room.fill}"><title>${esc(room.name)}</title></path>`),
    `</g>`,
    `<g class="minimap__outlines" aria-hidden="true">`,
    ...rooms.map((room) => `<path class="minimap__outline" data-room="${room.index}" d="${room.outline}"/>`),
    `</g>`,
    `<g class="minimap__walls" aria-hidden="true">${walls.map((w) => r(w, "minimap__wall")).join("")}${windows.map((w) => r(w, "minimap__window")).join("")}</g>`,
    `<g class="minimap__me" aria-hidden="true"></g>`,
    `</svg>`,
  ].join("");
}

/* ---------------------------------------------------------- vista de topo -- */

/**
 * Altura da câmera, acima do piso, para um retângulo da planta caber inteiro
 * na tela olhando reto para baixo, com o alto da planta no alto da tela.
 * O retângulo é enquadrado na altura `top` (o topo das paredes, por exemplo),
 * que fica mais perto da câmera e por isso aparece maior que o piso.
 *
 * @param {{x0:number,y0:number,x1:number,y1:number}} box
 * @param {number} fov     campo de visão vertical, em graus
 * @param {number} aspect  largura / altura da tela
 * @param {{ margin?: number, top?: number }} [opt]  margin multiplica o tamanho
 * @returns {number} altura em metros, ou NaN com entrada inválida
 */
export function topDownHeight(box, fov, aspect, { margin = 1.2, top = 0 } = {}) {
  if (!box || ![box.x0, box.y0, box.x1, box.y1, fov, aspect, margin, top].every(Number.isFinite)) return NaN;
  if (fov <= 0 || fov >= 180 || aspect <= 0 || margin <= 0) return NaN;
  const halfW = Math.abs(box.x1 - box.x0) / 2, halfH = Math.abs(box.y1 - box.y0) / 2;
  const tanV = Math.tan((fov * Math.PI) / 360);
  // x da planta corre na horizontal da tela, y na vertical
  const need = Math.max(halfH / tanV, halfW / (tanV * aspect)) * margin;
  return top + need;
}

/**
 * Pose de topo: alvo no centro do retângulo (no piso) e câmera logo acima.
 * Devolve números puros; o tour converte para a cena (X = x, Z = y, Y = altura).
 * O deslocamento minúsculo para +y (polar = 0.001) evita a pose degenerada de
 * olhar exatamente na direção do "para cima" da câmera, e é ele que deixa o
 * y = 0 da planta no alto da tela.
 */
export function topDownPose(box, fov, aspect, opt = {}) {
  const height = topDownHeight(box, fov, aspect, opt);
  if (!Number.isFinite(height)) return null;
  const polar = 0.001;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  return {
    target: [cx, 0, cy],
    pos: [cx, height * Math.cos(polar), cy + height * Math.sin(polar)],
    height,
  };
}

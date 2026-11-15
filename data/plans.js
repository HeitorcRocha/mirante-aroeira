/**
 * Dados das plantas do Mirante Aroeira. Módulo ESM puro: nenhum import de
 * "node:", então o mesmo arquivo serve ao gerador de SVG (tools/plans.mjs, no
 * Node) e ao tour 3D (tour/tour.js, no navegador).
 *
 * Unidade: metros. Origem no canto superior esquerdo da planta, x para a
 * direita, y para baixo (como na tela).
 *
 * Campos usados pela planta 2D e pelo tour:
 *   rooms    r: [[x, y, w, h], ...]   name: rótulo na planta   full: nome na lista
 *            at: [x, y] posição do rótulo (padrão: centro do primeiro retângulo)
 *            floor: "madeira" | "pedra" | "deck" (só o tour usa)
 *   outer    polilinhas da parede externa (com o vão da porta de entrada)
 *   inner    segmentos de parede interna [x1, y1, x2, y2], já com os vãos
 *   glass    panos de vidro (portas de correr, janelas)
 *   rail     guarda-corpo da varanda (polilinhas)
 *   doors    { wall: "h"|"v", at: [x, y], w, hinge: 0|1, side: 1|-1 }
 *            at = início do vão (menor coordenada); hinge 0 = dobradiça no início
 *            side = para que lado a folha abre (+1 = y ou x crescente)
 *   fits     mobiliário fixo [x, y, w, h] que a planta 2D desenha, só para dar escala
 *
 * Campos que só o tour 3D usa:
 *   north    para onde aponta o norte, em graus, medido no sentido horário a
 *            partir do "para cima" da planta (o lado de y = 0).
 *              0   = norte no alto da planta      90  = norte à direita
 *              180 = norte embaixo                270 = norte à esquerda
 *            No plano, o vetor norte é (sen north, -cos north). As três plantas
 *            têm a varanda voltada para o norte (com um pequeno desvio), que é
 *            a face que recebe sol no hemisfério sul.
 *   furniture  móveis do tour: { type, x, y, w, h, rot? }
 *            x, y, w, h = retângulo ocupado no chão, já na posição final
 *            (igual a "fits"). rot diz para que lado ficam as COSTAS do móvel
 *            (cabeceira, encosto, lado da parede):
 *              0 = costas para cima (y menor)   90  = costas para a direita
 *              180 = costas para baixo          270 = costas para a esquerda
 *            Tipos: cama, sofa, poltrona, mesa, mesa-lateral, cadeira, bancada,
 *            balcao, armario, rack, tapete, planta, geladeira, maquina, vaso
 *            (sanitário), pia, box. A altura e o desenho de cada tipo ficam em
 *            tour/geometry.js (FURNITURE) e tour/tour.js.
 *            Os itens que também aparecem em "fits" usam o mesmo retângulo.
 *            Um móvel pode ser declarado encostado na linha da parede: o
 *            modelo 3D apara a meia espessura da parede (tour/geometry.js).
 */

// Mesma formatação de área na landing e no tour: pt-BR, vírgula decimal, sem ",0".
export const fmtArea = (a) => {
  const r = Math.round(a * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",")) + " m²";
};

export const plans = [
  {
    id: "studio", title: "Studio", area: 38, w: 7.6, h: 5.0,
    desc: "Um ambiente integrado de estar e dormir com cozinha linear, um banho e varanda em toda a largura.",
    rooms: [
      { name: "Estar e dormir", full: "Estar, dormir e cozinha", r: [[2.2, 0, 4.0, 1.8], [0, 1.8, 6.2, 3.2]], at: [3.1, 3.55], floor: "madeira" },
      { name: "Banho", full: "Banho", r: [[0, 0, 2.2, 1.8]], floor: "pedra" },
      { name: "Varanda", full: "Varanda", r: [[6.2, 0, 1.4, 5.0]], floor: "deck" },
    ],
    outer: [[[0, 3.6], [0, 0], [6.2, 0]], [[0, 4.5], [0, 5], [6.2, 5]]],
    inner: [[2.2, 0, 2.2, 1.8], [0, 1.8, 0.7, 1.8], [1.5, 1.8, 2.2, 1.8]],
    glass: [[6.2, 0, 6.2, 5]],
    rail: [[[6.2, 0], [7.6, 0], [7.6, 5], [6.2, 5]]],
    doors: [
      { wall: "v", at: [0, 3.6], w: 0.9, hinge: 1, side: 1 },
      { wall: "h", at: [0.7, 1.8], w: 0.8, hinge: 0, side: 1 },
    ],
    fits: [[2.2, 0, 2.6, 0.6], [4.4, 3.0, 1.4, 2.0], [2.7, 2.1, 1.7, 0.8]],
    north: 105,
    furniture: [
      // estar, dormir e cozinha
      { type: "bancada", x: 2.2, y: 0, w: 2.6, h: 0.6, rot: 0 },
      { type: "geladeira", x: 4.8, y: 0, w: 0.65, h: 0.65, rot: 0 },
      { type: "mesa", x: 4.9, y: 1.2, w: 0.8, h: 0.8 },
      { type: "cadeira", x: 4.44, y: 1.4, w: 0.42, h: 0.4, rot: 270 },
      { type: "cadeira", x: 5.74, y: 1.4, w: 0.42, h: 0.4, rot: 90 },
      { type: "sofa", x: 2.7, y: 2.1, w: 1.7, h: 0.8, rot: 0 },
      { type: "tapete", x: 2.4, y: 2.95, w: 1.9, h: 1.4 },
      { type: "rack", x: 2.2, y: 4.55, w: 1.5, h: 0.4, rot: 180 },
      { type: "cama", x: 4.4, y: 3, w: 1.4, h: 2, rot: 180 },
      { type: "mesa-lateral", x: 3.9, y: 4.5, w: 0.4, h: 0.4 },
      { type: "armario", x: 0, y: 1.9, w: 0.6, h: 1.6, rot: 270 },
      // banho
      { type: "box", x: 0, y: 0, w: 0.9, h: 0.9, rot: 0 },
      { type: "vaso", x: 1.1, y: 0, w: 0.4, h: 0.65, rot: 0 },
      { type: "pia", x: 1.75, y: 0.9, w: 0.45, h: 0.6, rot: 90 },
      // varanda
      { type: "poltrona", x: 6.55, y: 0.3, w: 0.7, h: 0.7, rot: 0 },
      { type: "mesa-lateral", x: 6.7, y: 1.15, w: 0.4, h: 0.4 },
      { type: "poltrona", x: 6.55, y: 1.7, w: 0.7, h: 0.7, rot: 180 },
      { type: "planta", x: 6.75, y: 4.3, w: 0.45, h: 0.45 },
    ],
  },
  {
    id: "dois-quartos", title: "Dois quartos", area: 72, w: 9.0, h: 8.0,
    desc: "Sala de estar e jantar aberta para a varanda, cozinha, uma suíte, um segundo quarto e banho social, ligados por uma circulação curta.",
    rooms: [
      { name: "Entrada", full: "Entrada", r: [[3.0, 5.6, 2.0, 2.4]], at: [4.0, 6.3], floor: "madeira" },
      { name: "Estar e jantar", full: "Estar e jantar", r: [[0, 1.5, 5.0, 4.1]], at: [2.5, 4.3], floor: "madeira" },
      { name: "Cozinha", full: "Cozinha", r: [[0, 5.6, 3.0, 2.4]], at: [1.5, 6.6], floor: "pedra" },
      { name: "Varanda", full: "Varanda", r: [[0, 0, 5.0, 1.5]], floor: "deck" },
      { name: "Circulação", full: "Circulação", r: [[5.0, 3.3, 2.1, 1.8]], floor: "madeira" },
      { name: "Suíte", full: "Suíte", r: [[5.0, 0, 4.0, 3.3]], at: [7.0, 2.75], floor: "madeira" },
      { name: "Banho", full: "Banho da suíte", r: [[7.1, 3.3, 1.9, 1.8]], floor: "pedra" },
      { name: "Quarto", full: "Quarto", r: [[6.4, 5.1, 2.6, 2.9]], at: [7.15, 6.7], floor: "madeira" },
      { name: "Banho", full: "Banho social", r: [[5.0, 5.1, 1.4, 2.9]], floor: "pedra" },
    ],
    outer: [[[0, 1.5], [0, 8], [3.6, 8]], [[4.5, 8], [9, 8], [9, 0], [5, 0]]],
    inner: [
      [5, 0, 5, 3.5], [5, 4.4, 5, 8],
      [0, 5.6, 1.0, 5.6], [3.0, 5.6, 3.0, 8],
      [5, 3.3, 5.3, 3.3], [6.1, 3.3, 7.6, 3.3], [8.3, 3.3, 9, 3.3],
      [7.1, 3.3, 7.1, 5.1],
      [5, 5.1, 5.3, 5.1], [6.0, 5.1, 6.4, 5.1], [7.1, 5.1, 9, 5.1],
      [6.4, 5.1, 6.4, 8],
    ],
    glass: [[0, 1.5, 5, 1.5], [5.7, 0, 8.3, 0], [9, 5.8, 9, 7.4], [9, 3.8, 9, 4.6], [0, 6.2, 0, 7.4]],
    rail: [[[0, 1.5], [0, 0], [5, 0]]],
    doors: [
      { wall: "h", at: [3.6, 8], w: 0.9, hinge: 0, side: -1 },
      { wall: "h", at: [5.3, 3.3], w: 0.8, hinge: 0, side: -1 },
      { wall: "h", at: [7.6, 3.3], w: 0.7, hinge: 1, side: -1 },
      { wall: "h", at: [5.3, 5.1], w: 0.7, hinge: 0, side: 1 },
      { wall: "h", at: [6.4, 5.1], w: 0.7, hinge: 1, side: 1 },
    ],
    fits: [[0.5, 2.0, 2.2, 0.9], [1.0, 5.45, 2.0, 0.45], [0, 7.4, 3.0, 0.6], [6.2, 0.25, 1.6, 2.0], [7.9, 6.0, 1.0, 1.9]],
    north: 345,
    furniture: [
      // estar e jantar
      { type: "sofa", x: 0.5, y: 2, w: 2.2, h: 0.9, rot: 0 },
      { type: "tapete", x: 0.4, y: 2.95, w: 2.2, h: 1.4 },
      { type: "mesa-lateral", x: 1.2, y: 3.35, w: 0.9, h: 0.5 },
      { type: "poltrona", x: 0.2, y: 4.4, w: 0.8, h: 0.8, rot: 270 },
      { type: "rack", x: 4.5, y: 1.6, w: 0.45, h: 1.3, rot: 90 },
      { type: "mesa", x: 2.7, y: 3.5, w: 1.4, h: 0.9 },
      { type: "cadeira", x: 2.85, y: 3.04, w: 0.4, h: 0.42, rot: 0 },
      { type: "cadeira", x: 3.55, y: 3.04, w: 0.4, h: 0.42, rot: 0 },
      { type: "cadeira", x: 2.85, y: 4.44, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 3.55, y: 4.44, w: 0.4, h: 0.42, rot: 180 },
      { type: "balcao", x: 1.9, y: 5.6, w: 1.1, h: 0.45, rot: 180 },
      // cozinha
      { type: "bancada", x: 0, y: 7.4, w: 3, h: 0.6, rot: 180 },
      { type: "geladeira", x: 2.3, y: 6.65, w: 0.7, h: 0.7, rot: 90 },
      // entrada
      { type: "rack", x: 4.6, y: 5.9, w: 0.4, h: 1, rot: 90 },
      { type: "planta", x: 3.1, y: 7.45, w: 0.4, h: 0.4 },
      // varanda
      { type: "mesa", x: 0.9, y: 0.4, w: 0.7, h: 0.7 },
      { type: "cadeira", x: 0.4, y: 0.55, w: 0.42, h: 0.4, rot: 270 },
      { type: "cadeira", x: 1.68, y: 0.55, w: 0.42, h: 0.4, rot: 90 },
      { type: "poltrona", x: 3.3, y: 0.35, w: 0.75, h: 0.75, rot: 90 },
      { type: "planta", x: 4.4, y: 0.2, w: 0.45, h: 0.45 },
      // suíte
      { type: "cama", x: 6.2, y: 0.25, w: 1.6, h: 2, rot: 0 },
      { type: "mesa-lateral", x: 5.7, y: 0.3, w: 0.45, h: 0.4 },
      { type: "mesa-lateral", x: 7.85, y: 0.3, w: 0.45, h: 0.4 },
      { type: "armario", x: 8.4, y: 0.9, w: 0.6, h: 1.6, rot: 90 },
      { type: "tapete", x: 5.9, y: 1.5, w: 2.2, h: 1.1 },
      // banho da suíte
      { type: "pia", x: 7.1, y: 3.4, w: 0.45, h: 0.6, rot: 270 },
      { type: "box", x: 7.1, y: 4.2, w: 0.9, h: 0.9, rot: 0 },
      { type: "vaso", x: 8.35, y: 4.4, w: 0.65, h: 0.4, rot: 90 },
      // quarto
      { type: "cama", x: 7.9, y: 6, w: 1, h: 1.9, rot: 180 },
      { type: "mesa-lateral", x: 7.4, y: 7.45, w: 0.4, h: 0.4 },
      { type: "armario", x: 7.3, y: 5.1, w: 1.6, h: 0.55, rot: 0 },
      { type: "mesa", x: 6.4, y: 6.3, w: 0.55, h: 1.1 },
      { type: "cadeira", x: 7, y: 6.65, w: 0.42, h: 0.4, rot: 90 },
      // banho social
      { type: "pia", x: 5.95, y: 5.85, w: 0.45, h: 0.55, rot: 90 },
      { type: "vaso", x: 5, y: 6.55, w: 0.65, h: 0.4, rot: 270 },
      { type: "box", x: 5, y: 7.1, w: 1.4, h: 0.9, rot: 180 },
    ],
  },
  {
    id: "tres-suites", title: "Três suítes", area: 124, w: 15.5, h: 8.0,
    desc: "Sala ampla aberta para a varanda gourmet, cozinha com área de serviço, e três suítes, uma delas master com closet.",
    rooms: [
      { name: "Entrada", full: "Entrada", r: [[5.4, 5.8, 2.1, 2.2]], at: [6.45, 6.4], floor: "madeira" },
      { name: "Estar e jantar", full: "Estar e jantar", r: [[0, 2.2, 7.5, 3.6]], at: [3.75, 4.85], floor: "madeira" },
      { name: "Cozinha", full: "Cozinha", r: [[0, 5.8, 3.6, 2.2]], at: [1.8, 6.75], floor: "pedra" },
      { name: "Serviço", full: "Área de serviço", r: [[3.6, 5.8, 1.8, 2.2]], floor: "pedra" },
      { name: "Varanda gourmet", full: "Varanda gourmet", r: [[0, 0, 7.5, 2.2]], at: [3.75, 1.75], floor: "deck" },
      { name: "Circulação", full: "Circulação", r: [[7.5, 3.6, 4.7, 1.1]], floor: "madeira" },
      { name: "Suíte 2", full: "Suíte 2", r: [[7.5, 0, 3.1, 3.6]], at: [9.05, 3.0], floor: "madeira" },
      { name: "Banho", full: "Banho da suíte 2", r: [[10.6, 0, 1.6, 2.2]], at: [11.4, 1.7], floor: "pedra" },
      { name: "Rouparia", full: "Rouparia", r: [[10.6, 2.2, 1.6, 1.4]], at: [11.4, 2.85], floor: "madeira" },
      { name: "Suíte master", full: "Suíte master", r: [[12.2, 0, 3.3, 4.7]], at: [13.85, 3.4], floor: "madeira" },
      { name: "Closet", full: "Closet", r: [[12.2, 4.7, 1.4, 3.3]], floor: "madeira" },
      { name: "Banho", full: "Banho da master", r: [[13.6, 4.7, 1.9, 3.3]], floor: "pedra" },
      { name: "Suíte 3", full: "Suíte 3", r: [[7.5, 4.7, 3.1, 3.3]], at: [9.05, 5.35], floor: "madeira" },
      { name: "Banho", full: "Banho da suíte 3", r: [[10.6, 4.7, 1.6, 3.3]], floor: "pedra" },
    ],
    outer: [[[0, 2.2], [0, 8], [5.9, 8]], [[6.8, 8], [15.5, 8], [15.5, 0], [7.5, 0]]],
    inner: [
      [7.5, 0, 7.5, 3.7], [7.5, 4.6, 7.5, 8],
      [0, 5.8, 0.8, 5.8], [2.6, 5.8, 5.4, 5.8],
      [3.6, 5.8, 3.6, 6.5], [3.6, 7.3, 3.6, 8], [5.4, 5.8, 5.4, 8],
      [7.5, 3.6, 7.8, 3.6], [8.6, 3.6, 10.9, 3.6], [11.6, 3.6, 12.2, 3.6],
      [10.6, 0, 10.6, 0.6], [10.6, 1.3, 10.6, 3.6],
      [10.6, 2.2, 12.2, 2.2],
      [12.2, 0, 12.2, 3.75], [12.2, 4.55, 12.2, 8],
      [7.5, 4.7, 7.8, 4.7], [8.6, 4.7, 12.5, 4.7], [13.2, 4.7, 13.9, 4.7], [14.6, 4.7, 15.5, 4.7],
      [10.6, 4.7, 10.6, 5.2], [10.6, 5.9, 10.6, 8],
      [13.6, 4.7, 13.6, 8],
    ],
    glass: [
      [0, 2.2, 7.5, 2.2], [8.1, 0, 10.0, 0], [10.95, 0, 11.85, 0], [12.9, 0, 14.8, 0],
      [15.5, 1.0, 15.5, 3.4], [15.5, 5.6, 15.5, 7.1], [8.2, 8, 9.9, 8], [11.0, 8, 11.8, 8],
      [0, 6.3, 0, 7.5], [4.1, 8, 4.9, 8],
    ],
    rail: [[[0, 2.2], [0, 0], [7.5, 0]]],
    doors: [
      { wall: "h", at: [5.9, 8], w: 0.9, hinge: 0, side: -1 },
      { wall: "v", at: [3.6, 6.5], w: 0.8, hinge: 0, side: -1 },
      { wall: "h", at: [7.8, 3.6], w: 0.8, hinge: 0, side: -1 },
      { wall: "h", at: [10.9, 3.6], w: 0.7, hinge: 0, side: 1 },
      { wall: "v", at: [10.6, 0.6], w: 0.7, hinge: 0, side: 1 },
      { wall: "v", at: [12.2, 3.75], w: 0.8, hinge: 1, side: 1 },
      { wall: "h", at: [7.8, 4.7], w: 0.8, hinge: 0, side: 1 },
      { wall: "v", at: [10.6, 5.2], w: 0.7, hinge: 0, side: 1 },
      { wall: "h", at: [12.5, 4.7], w: 0.7, hinge: 0, side: 1 },
      { wall: "h", at: [13.9, 4.7], w: 0.7, hinge: 0, side: 1 },
    ],
    fits: [
      [0.7, 2.8, 2.6, 0.95], [4.3, 3.0, 2.2, 1.0], [2.8, 0.45, 2.0, 0.9], [6.3, 0.2, 1.0, 0.6],
      [0, 7.4, 3.6, 0.6], [8.3, 0.3, 1.6, 2.0], [13.0, 0.35, 1.8, 2.0], [8.3, 5.8, 1.6, 2.0],
    ],
    north: 0,
    furniture: [
      // estar e jantar
      { type: "sofa", x: 0.7, y: 2.8, w: 2.6, h: 0.95, rot: 0 },
      { type: "tapete", x: 0.6, y: 3.8, w: 2.8, h: 1.5 },
      { type: "mesa-lateral", x: 1.5, y: 4.2, w: 1, h: 0.55 },
      { type: "poltrona", x: 3.5, y: 2.8, w: 0.8, h: 0.8, rot: 0 },
      { type: "rack", x: 3.2, y: 5.3, w: 1.8, h: 0.45, rot: 180 },
      { type: "mesa", x: 4.3, y: 3, w: 2.2, h: 1 },
      { type: "cadeira", x: 4.5, y: 2.54, w: 0.4, h: 0.42, rot: 0 },
      { type: "cadeira", x: 5.2, y: 2.54, w: 0.4, h: 0.42, rot: 0 },
      { type: "cadeira", x: 5.9, y: 2.54, w: 0.4, h: 0.42, rot: 0 },
      { type: "cadeira", x: 4.5, y: 4.04, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 5.2, y: 4.04, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 5.9, y: 4.04, w: 0.4, h: 0.42, rot: 180 },
      { type: "planta", x: 6.9, y: 2.35, w: 0.45, h: 0.45 },
      // cozinha
      { type: "bancada", x: 0, y: 7.4, w: 3.6, h: 0.6, rot: 180 },
      { type: "geladeira", x: 2.75, y: 5.85, w: 0.7, h: 0.65, rot: 0 },
      // área de serviço
      { type: "maquina", x: 4.7, y: 5.85, w: 0.65, h: 0.6, rot: 0 },
      { type: "pia", x: 4.95, y: 6.7, w: 0.45, h: 0.6, rot: 90 },
      // entrada
      { type: "rack", x: 7.1, y: 6, w: 0.4, h: 1.1, rot: 90 },
      { type: "planta", x: 5.45, y: 7.5, w: 0.4, h: 0.4 },
      // varanda gourmet
      { type: "mesa", x: 2.8, y: 0.45, w: 2, h: 0.9 },
      { type: "cadeira", x: 3, y: 1.4, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 3.6, y: 1.4, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 4.2, y: 1.4, w: 0.4, h: 0.42, rot: 180 },
      { type: "cadeira", x: 2.33, y: 0.7, w: 0.42, h: 0.4, rot: 270 },
      { type: "cadeira", x: 4.85, y: 0.7, w: 0.42, h: 0.4, rot: 90 },
      { type: "bancada", x: 6.3, y: 0.2, w: 1, h: 0.6, rot: 0 },
      { type: "poltrona", x: 0.4, y: 0.5, w: 0.75, h: 0.75, rot: 270 },
      { type: "poltrona", x: 0.4, y: 1.35, w: 0.75, h: 0.75, rot: 270 },
      { type: "planta", x: 1.4, y: 0.2, w: 0.45, h: 0.45 },
      // suíte 2
      { type: "cama", x: 8.3, y: 0.3, w: 1.6, h: 2, rot: 0 },
      { type: "mesa-lateral", x: 7.8, y: 0.35, w: 0.45, h: 0.4 },
      { type: "armario", x: 8.8, y: 3, w: 1.7, h: 0.55, rot: 180 },
      { type: "tapete", x: 8, y: 1.5, w: 2.2, h: 1.1 },
      // banho da suíte 2
      { type: "vaso", x: 11.55, y: 0.45, w: 0.65, h: 0.4, rot: 90 },
      { type: "box", x: 11.3, y: 1.3, w: 0.9, h: 0.9, rot: 0 },
      { type: "pia", x: 10.6, y: 1.45, w: 0.45, h: 0.6, rot: 270 },
      // rouparia
      { type: "armario", x: 10.65, y: 2.2, w: 1.5, h: 0.5, rot: 0 },
      // suíte master
      { type: "cama", x: 13, y: 0.35, w: 1.8, h: 2, rot: 0 },
      { type: "mesa-lateral", x: 12.5, y: 0.4, w: 0.45, h: 0.4 },
      { type: "mesa-lateral", x: 14.85, y: 0.4, w: 0.45, h: 0.4 },
      { type: "rack", x: 12.2, y: 2.5, w: 0.4, h: 1.1, rot: 270 },
      { type: "poltrona", x: 14.65, y: 3.75, w: 0.75, h: 0.8, rot: 180 },
      { type: "tapete", x: 12.9, y: 1.6, w: 2, h: 1.3 },
      // closet
      { type: "armario", x: 12.2, y: 5.5, w: 0.5, h: 1.8, rot: 270 },
      { type: "armario", x: 12.8, y: 7.5, w: 0.75, h: 0.5, rot: 180 },
      // banho da master
      { type: "pia", x: 13.6, y: 5.6, w: 0.5, h: 1.2, rot: 270 },
      { type: "vaso", x: 14.85, y: 6, w: 0.65, h: 0.4, rot: 90 },
      { type: "box", x: 13.6, y: 7, w: 1.9, h: 1, rot: 180 },
      // suíte 3
      { type: "cama", x: 8.3, y: 5.8, w: 1.6, h: 2, rot: 180 },
      { type: "mesa-lateral", x: 9.95, y: 7.35, w: 0.45, h: 0.4 },
      { type: "armario", x: 7.5, y: 5.7, w: 0.55, h: 1.5, rot: 270 },
      // banho da suíte 3
      { type: "pia", x: 11.5, y: 4.7, w: 0.6, h: 0.45, rot: 0 },
      { type: "vaso", x: 11.55, y: 6.3, w: 0.65, h: 0.4, rot: 90 },
      { type: "box", x: 10.6, y: 7.1, w: 1.6, h: 0.9, rot: 180 },
    ],
  },
];

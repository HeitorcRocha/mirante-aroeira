/* ============================================================================
   Mirante Aroeira: comportamento próprio da página.

   O motor (scrollcraft.js) cuida do vídeo, dos cues, do trilho lateral e dos
   wipes. Este arquivo cuida de duas coisas que só existem neste site:

     1. o ato das plantas: o desenho em SVG avança com o scroll e o corte do
        prédio acende os andares da planta em tela;
     2. o formulário de visita, que monta um e-mail (nada é enviado daqui).

   O motor não é editado. Aqui só lemos a posição do <section> na tela.
   ========================================================================== */
(function () {
  "use strict";

  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var smooth = function (x) { x = clamp01(x); return x * x * (3 - 2 * x); };

  ScrollCraft.mount(document.body);

  /* ------------------------------------------------------------ plantas -- */
  var act = document.getElementById("plantas");
  var select = document.getElementById("f-planta");
  var selectTouched = false;

  // Vindo do espelho de vendas (index.html?planta=<id>#visita): a tipologia da
  // unidade escolhida lá já entra no formulário e o scroll não a troca mais.
  var pedida = /[?&]planta=([^&#]+)/.exec(String(location.search || ""));
  if (select && pedida) {
    var idPedido = "";
    try { idPedido = decodeURIComponent(pedida[1]); } catch (e) { /* endereço malformado: ignora */ }
    if (Array.prototype.some.call(select.options, function (o) { return o.value === idPedido; })) {
      select.value = idPedido;
      selectTouched = true;
    }
  }

  // Janela de cada grupo de traços dentro do desenho (0 = nada, 1 = pronto).
  // As janelas se sobrepõem de propósito: as paredes internas começam antes
  // de as externas fecharem, como numa prancha sendo riscada.
  var GROUPS = { outer: [0, 0.42], inner: [0.3, 0.72], open: [0.62, 0.9], fit: [0.7, 0.95], dim: [0.82, 1] };

  var units = Array.prototype.map.call(act.querySelectorAll(".unit"), function (el, i) {
    var byGroup = {};
    var draws = Array.prototype.map.call(el.querySelectorAll(".draw"), function (path) {
      var g = path.getAttribute("data-g");
      (byGroup[g] = byGroup[g] || []).push(path);
      return { el: path, g: g, a: 0, len: 1, last: -1 };
    });
    // cada traço ganha um trecho da janela do seu grupo, em ordem
    draws.forEach(function (d) {
      var list = byGroup[d.g], w = GROUPS[d.g], k = list.indexOf(d.el);
      var span = w[1] - w[0];
      d.len = span * 0.45;
      d.a = w[0] + (list.length > 1 ? k / (list.length - 1) : 0) * (span - d.len);
    });

    var rooms = [];
    Array.prototype.forEach.call(el.querySelectorAll("[data-room]"), function (node) {
      var k = +node.getAttribute("data-room");
      var r = rooms[k] || (rooms[k] = { rects: [], label: null, item: null, last: -1 });
      if (node.classList.contains("room")) r.rects.push(node);
      else if (node.classList.contains("lbl")) r.label = node;
      else r.item = node;
    });

    var floors = el.getAttribute("data-floors").split(" ").map(Number);
    return {
      el: el, id: el.getAttribute("data-unit"), draws: draws, rooms: rooms,
      tour: el.querySelector(".unit__tour"),
      from: floors[0], to: floors[1], vis: -1,
      // a primeira planta começa a ser riscada enquanto o palco ainda está
      // entrando na tela, para não chegar vazia
      start: i === 0 ? -0.25 : 0.04,
      len: i === 0 ? 0.68 : 0.5
    };
  });

  var floorEls = Array.prototype.map.call(act.querySelectorAll(".torre__andar"), function (el) {
    return { el: el, n: +el.getAttribute("data-n") };
  });
  var N = units.length;
  var activeIndex = -1;
  var lastT = null;
  var stage = act.querySelector("[data-sc-stage]");

  // quanto do traço está desenhado e quantos cômodos já acenderam
  function signature(u) {
    var drawn = 0, lit = 0;
    for (var k = 0; k < u.draws.length; k++) drawn += Math.max(u.draws[k].last, 0);
    for (var r = 0; r < u.rooms.length; r++) if (u.rooms[r].last > 0.5) lit++;
    return (drawn / u.draws.length).toFixed(2) + "/" + lit;
  }

  function paintUnit(u, i, T) {
    var t = T - i;                                      // tempo local desta planta
    var fadeIn = i === 0 ? 1 : smooth((t + 0.07) / 0.12);
    var fadeOut = i === N - 1 ? 1 : 1 - smooth((t - 0.93) / 0.12);
    var vis = +(fadeIn * fadeOut).toFixed(3);

    if (vis !== u.vis) {
      u.vis = vis;
      u.el.style.opacity = vis;
      // Só opacidade, nunca visibility: hidden. As três plantas continuam na
      // árvore de acessibilidade, então um leitor de tela lê todas mesmo sem
      // rolar. pointer-events evita que a planta invisível capture cliques.
      // "auto" explícito: o CSS deixa a 2ª e a 3ª planta com pointer-events: none
      // até o JS assumir, e uma string vazia devolveria o controle a essa regra.
      u.el.style.pointerEvents = vis < 0.02 ? "none" : "auto";
      // O link do tour de uma planta invisível sai da ordem do Tab (o foco não
      // pode cair num botão que não se vê), mas continua na árvore de
      // acessibilidade, como o resto da planta.
      if (u.tour) u.tour.tabIndex = vis < 0.02 ? -1 : 0;
    }
    if (vis < 0.02) return vis;

    var d = reduce ? 1 : clamp01((t - u.start) / u.len);
    for (var k = 0; k < u.draws.length; k++) {
      var dr = u.draws[k];
      var lp = +clamp01((d - dr.a) / dr.len).toFixed(3);
      if (lp !== dr.last) { dr.last = lp; dr.el.style.strokeDashoffset = 1 - lp; }
    }

    // os cômodos acendem um a um depois que as paredes fecham
    var labelsFrom = u.start + u.len * 0.74;
    var step = 0.24 / u.rooms.length;
    for (var r = 0; r < u.rooms.length; r++) {
      var room = u.rooms[r];
      var rp = reduce ? 1 : +clamp01((t - (labelsFrom + r * step)) / 0.08).toFixed(3);
      if (rp === room.last) continue;
      room.last = rp;
      var fill = 0.05 * smooth(rp) + 0.2 * Math.sin(Math.PI * rp);   // pisca e assenta
      for (var q = 0; q < room.rects.length; q++) room.rects[q].style.fillOpacity = fill.toFixed(3);
      if (room.label) room.label.style.opacity = smooth(rp).toFixed(3);
      if (room.item) room.item.classList.toggle("on", rp > 0.5);
    }
    return vis;
  }

  function frame() {
    queued = false;
    var rect = act.getBoundingClientRect();
    var vh = innerHeight;

    var travel = Math.max(rect.height - vh, 1);
    // T é a linha do tempo do ato: 0..N enquanto o palco está fixo, e um
    // pouco negativo enquanto ele ainda sobe para dentro da tela. Os dois
    // extremos saturam: com o ato ainda abaixo da tela T fica em -0.25, e com
    // ele já para trás fica em N. Isso importa quando a página abre já rolada
    // (recarregar em #visita): a última planta precisa estar ativa mesmo sem
    // o visitante ter passado por aqui.
    var T = rect.top > 0
      ? (clamp01((vh - rect.top) / vh) - 1) * 0.25
      : clamp01(-rect.top / travel) * N;
    if (T === lastT) return;                 // nada mudou: nenhuma escrita no DOM
    lastT = T;

    var best = 0, bestVis = -1, sig = "";
    for (var i = 0; i < N; i++) {
      var v = paintUnit(units[i], i, T);
      if (v > bestVis) { bestVis = v; best = i; }
      sig += v.toFixed(2) + "/" + signature(units[i]) + " ";
    }
    // Assinatura do que está de fato pintado (não do scroll bruto). O script de
    // verificação lê isto para saber se a tela mudou entre duas posições.
    stage.setAttribute("data-sc-verify-state", sig);

    if (best !== activeIndex) {
      activeIndex = best;
      var u = units[best];
      for (var f = 0; f < floorEls.length; f++) {
        floorEls[f].el.classList.toggle("on", floorEls[f].n >= u.from && floorEls[f].n <= u.to);
      }
      // a última planta vista já vai escolhida para o formulário
      if (select && !selectTouched) select.value = u.id;
    }
  }

  var queued = false;
  function request() { if (!queued) { queued = true; requestAnimationFrame(frame); } }
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request);
  request();

  /* ------------------------------------------------------------- visita -- */
  var form = document.getElementById("form-visita");
  var aviso = document.getElementById("form-aviso");
  if (select) select.addEventListener("change", function () { selectTouched = true; });

  if (form && select) form.addEventListener("submit", function (ev) {
    // Sem JS o formulário cai no mailto: do próprio action. Com JS montamos
    // uma mensagem mais legível. Em nenhum dos casos algo é enviado a um
    // servidor: quem envia é o aplicativo de e-mail da pessoa.
    ev.preventDefault();
    var campoNome = form.elements.nome;
    if (!campoNome.value.trim()) {           // "required" aceita só espaços
      aviso.textContent = "Escreva o seu nome para a gente saber com quem falar.";
      campoNome.focus();
      return;
    }
    var to = form.getAttribute("action").replace(/^mailto:/, "");
    location.href = montarEmail(
      to,
      form.elements.nome.value,
      select.options[select.selectedIndex].text,
      form.elements.periodo.value
    );
    aviso.textContent = "Pedimos ao seu aplicativo de e-mail para abrir a mensagem. Se nada abriu, escreva para " + to + ".";
  });

  // Função pura (sem DOM), exposta para poder ser testada isoladamente.
  function montarEmail(to, nome, planta, periodo) {
    var body = "Olá, gostaria de agendar uma visita ao Mirante Aroeira.\n\n" +
      "Nome: " + String(nome == null ? "" : nome).trim() + "\nPlanta: " + planta + "\nMelhor período: " + periodo + "\n";
    return "mailto:" + to +
      "?subject=" + encodeURIComponent("Visita: " + planta) +
      "&body=" + encodeURIComponent(body);
  }
  window.MiranteAroeira = { montarEmail: montarEmail };
})();

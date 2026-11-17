/* CONECTAcamp — comportamento do site (sem dependências) */
(function () {
  'use strict';

  var C = window.CONTENT || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var brl = function (n) { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  var P = { full: (C.prices && C.prices.full) || 0 };
  var AGE_MIN = C.ageMin != null ? C.ageMin : 15;
  var AGE_MAX = C.ageMax != null ? C.ageMax : 25;
  var contact = C.contact || {};
  /* Vagas: com o servidor rodando, os números vêm de /api/status; sem ele, ficam os de content.js */
  var live = { api: false, capacity: C.spots, remaining: C.spots, taken: 0, open: true };

  /* ---------- Conteúdo vindo de content.js e do servidor ---------- */
  function derivedMap() {
    return {
      price: P.full ? brl(P.full) : '',
      spots: live.capacity != null ? String(live.capacity) : '',
      spotsLeft: live.remaining != null ? String(live.remaining) : '',
      ageRange: AGE_MIN + ' a ' + AGE_MAX,
      ageDash: AGE_MIN + '–' + AGE_MAX
    };
  }
  function applyBinds() {
    var d = derivedMap();
    $$('[data-bind]').forEach(function (n) {
      var k = n.getAttribute('data-bind');
      var v = d[k];
      if (v == null || v === '') v = C.bind && C.bind[k];
      if (v == null || v === '') v = contact[k];
      if (v != null && v !== '') n.textContent = v;
    });
  }
  applyBinds();

  var city = $('.local-city');
  if (city && C.bind && C.bind.placeCity) city.hidden = false;

  var waNumber = (contact.whatsapp || '').replace(/\D/g, '');
  function setLink(id, href) {
    var n = document.getElementById(id);
    if (n && href) { n.href = href; n.hidden = false; }
  }
  setLink('mapBtn', C.mapUrl);
  setLink('waContact', waNumber && 'https://wa.me/' + waNumber);
  setLink('footWa', waNumber && 'https://wa.me/' + waNumber);
  setLink('footIg', contact.instagram);
  setLink('footMail', contact.email && 'mailto:' + contact.email);

  var media = $('#localMedia');
  if (media && C.localPhotos && C.localPhotos.length) {
    media.innerHTML = '';
    C.localPhotos.forEach(function (p) {
      var n;
      if (p.type === 'video') { n = document.createElement('video'); n.src = p.src; n.controls = true; n.preload = 'metadata'; n.setAttribute('aria-label', p.alt || ''); }
      else { n = document.createElement('img'); n.src = p.src; n.alt = p.alt || ''; n.loading = 'lazy'; }
      media.appendChild(n);
    });
  }

  /* ---------- Navegação ---------- */
  var burger = $('#burger'), menu = $('#menu');
  function setMenu(open) {
    menu.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
  }
  burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
  $$('#menu a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });

  /* ---------- Entrada suave ---------- */
  var reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (n) { io.observe(n); });
  } else { reveals.forEach(function (n) { n.classList.add('in'); }); }

  /* ---------- Efeitos: holofote no topo, ingresso 3D e contagem de vagas ---------- */
  var canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  var heroBox = $('.hero');
  if (heroBox && !reduceMotion && canHover) {
    heroBox.addEventListener('pointermove', function (e) {
      var r = heroBox.getBoundingClientRect();
      heroBox.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      heroBox.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }
  var tilt = $('.ticket-wrap');
  var tk = $('.ticket');
  if (tilt && tk && !reduceMotion && canHover) {
    tilt.addEventListener('pointermove', function (e) {
      var r = tilt.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tk.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg');
      tk.style.setProperty('--rx', (-y * 9).toFixed(2) + 'deg');
    });
    tilt.addEventListener('pointerleave', function () { tk.style.setProperty('--rx', '0deg'); tk.style.setProperty('--ry', '0deg'); });
  }
  function countUp(n) {
    var end = parseInt(n.textContent, 10);
    if (isNaN(end) || end < 1) return;
    var t0 = null, dur = 1100;
    var step = function (ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      n.textContent = String(Math.round(end * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step); else n.textContent = String(end);
    };
    n.textContent = '0';
    requestAnimationFrame(step);
  }
  function startCounters() {
    var counters = $$('.count');
    if (counters.length && 'IntersectionObserver' in window && !reduceMotion) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) { countUp(en.target); cio.unobserve(en.target); } });
      }, { threshold: 0.6 });
      counters.forEach(function (n) { cio.observe(n); });
    }
  }

  /* ---------- Contagem regressiva (só com data definida) ---------- */
  var cd = $('#countdown');
  var start = C.eventStart ? new Date(C.eventStart).getTime() : NaN;
  if (cd && !isNaN(start) && start > Date.now()) {
    cd.hidden = false;
    var parts = { d: $('[data-u="d"]', cd), h: $('[data-u="h"]', cd), m: $('[data-u="m"]', cd), s: $('[data-u="s"]', cd) };
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var timer;
    var tick = function () {
      var diff = Math.max(0, start - Date.now());
      parts.d.textContent = pad(Math.floor(diff / 864e5));
      parts.h.textContent = pad(Math.floor(diff % 864e5 / 36e5));
      parts.m.textContent = pad(Math.floor(diff % 36e5 / 6e4));
      parts.s.textContent = pad(Math.floor(diff % 6e4 / 1e3));
      if (diff === 0) { clearInterval(timer); cd.hidden = true; }
    };
    timer = setInterval(tick, 1000); tick();
  }

  /* ---------- Programação: cartão "aguarde" ou carrossel de dias ---------- */
  var progWait = $('#progWait'), progCar = $('#progCarousel'), progList = $('#progList'), progLead = $('#progLead'), dayDots = $('#dayDots');
  var hasProg = !!(C.program && C.program.length);
  if (hasProg && progList && progCar) {
    progCar.hidden = false;
    if (progWait) progWait.hidden = true;
    if (progLead) progLead.textContent = 'Prévia da programação. Horários e atividades podem ser ajustados; a versão final será divulgada nos nossos canais.';
    var tones = ['c-blue', 'c-ice', 'c-ink'];
    var cards = [];
    var goTo = function (i) {
      var c = cards[i]; if (!c) return;
      progList.scrollTo({ left: c.offsetLeft, behavior: reduceMotion ? 'auto' : 'smooth' });
    };
    var current = function () {
      var best = 0, bd = Infinity;
      cards.forEach(function (c, i) { var d = Math.abs(c.offsetLeft - progList.scrollLeft); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    var markDots = function () { var cur = current(); $$('button', dayDots).forEach(function (b, i) { b.classList.toggle('on', i === cur); }); };
    C.program.forEach(function (d, i) {
      var dayNum = String(d.date).split('/')[0];
      var card = el('article', 'day ' + tones[i % tones.length]);
      card.appendChild(el('span', 'num', dayNum));
      card.appendChild(el('div', 'wk', d.day));
      card.appendChild(el('h3', '', d.title));
      var ul = el('ul');
      d.items.forEach(function (it) {
        var li = el('li'); li.appendChild(el('time', '', it.time));
        var body = el('div'); body.appendChild(el('b', '', it.name));
        if (it.desc) body.appendChild(el('small', '', it.desc));
        li.appendChild(body); ul.appendChild(li);
      });
      card.appendChild(ul); progList.appendChild(card); cards.push(card);
      var dot = el('button', '', dayNum); dot.type = 'button'; dot.setAttribute('aria-label', 'Ir para ' + d.day + ' ' + d.date);
      dot.addEventListener('click', function () { goTo(i); });
      dayDots.appendChild(dot);
    });
    progList.addEventListener('scroll', markDots, { passive: true });
    $('#prevDay').addEventListener('click', function () { goTo(Math.max(0, current() - 1)); });
    $('#nextDay').addEventListener('click', function () { goTo(Math.min(cards.length - 1, current() + 1)); });
    markDots();
  }

  /* ---------- Botão fixo no celular ---------- */
  var sticky = $('#stickyCta'), heroEl = $('.hero'), regEl = $('#inscricao');
  if (sticky && 'IntersectionObserver' in window) {
    var visible = { hero: true, reg: false };
    var update = function () { sticky.classList.toggle('show', !visible.hero && !visible.reg); };
    new IntersectionObserver(function (e) { visible.hero = e[0].isIntersecting; update(); }, { threshold: 0.1 }).observe(heroEl);
    new IntersectionObserver(function (e) { visible.reg = e[0].isIntersecting; update(); }, { threshold: 0.05 }).observe(regEl);
  }

  /* ---------- Valores ---------- */
  var priceBox = $('#priceBox');
  function renderPrices() {
    if (!priceBox || !P.full) return;
    priceBox.innerHTML = '';
    [
      ['Inscrição', brl(P.full), 'Valor fixo por pessoa', true],
      ['Idade', AGE_MIN + ' a ' + AGE_MAX, 'anos', false],
      ['Vagas', String(live.capacity || ''), 'para o público geral', false]
    ].forEach(function (c) {
      var d = el('div', 'price' + (c[3] ? ' feat' : '')); d.appendChild(el('small', '', c[0])); d.appendChild(el('b', '', c[1])); d.appendChild(el('p', '', c[2])); priceBox.appendChild(d);
    });
  }
  renderPrices();

  /* ---------- Vagas ao vivo (servidor) ---------- */
  var form = $('#regForm'), peopleEl = $('#people'), summary = $('#summary');
  var minorBox = $('#minorBox'), accSel = $('#accompanied'), authBox = $('#authBox');

  function updateVagasUI() {
    var left = live.remaining, cap = live.capacity || 0;
    var soldOut = live.api && left <= 0, closed = live.api && !live.open && !soldOut;
    var box = $('#vagasBox');
    if (box) {
      box.hidden = !live.api;
      var fill = $('#vFill'); if (fill) fill.style.width = (cap ? Math.min(100, Math.round(live.taken / cap * 100)) : 0) + '%';
      var txt = $('#vText'); if (txt) txt.textContent = soldOut ? 'Vagas esgotadas' : (left === cap ? cap + ' vagas abertas' : 'Restam ' + left + ' de ' + cap + ' vagas');
    }
    var so = $('#soldout'); if (so) so.hidden = !soldOut;
    var cl = $('#closed'); if (cl) cl.hidden = !closed;
    if (form) form.hidden = soldOut || closed || ($('#success') && !$('#success').hidden);
    var lbl = $('#heroCta .lbl'); if (lbl) lbl.textContent = soldOut ? 'Vagas esgotadas' : 'Quero participar';
    var unit = $('#posterUnit'); if (unit) unit.textContent = soldOut ? 'esgotado' : 'vagas';
    var pv = $('.poster-vagas'); if (pv) pv.classList.toggle('out', soldOut);
    var tv = $('.tk-vagas'); if (tv) { tv.classList.toggle('out', soldOut); var tsm = $('small', tv); if (tsm) tsm.textContent = soldOut ? 'esgotado' : 'vagas'; }
    $$('.band [data-bind="spotsLeft"]').forEach(function (b) { if (b.parentElement) b.parentElement.hidden = soldOut; });
    if (sticky) sticky.textContent = soldOut ? 'Vagas esgotadas' : 'Quero participar';
  }
  function updateAgeInputs() {
    $$('.person [name="idade"]').forEach(function (i) { i.min = String(AGE_MIN); i.max = String(AGE_MAX); });
  }
  function applyStatus(s) {
    live.api = true; live.capacity = s.capacity; live.remaining = s.remaining; live.taken = s.taken; live.open = s.open;
    P.full = s.price; AGE_MIN = s.ageMin; AGE_MAX = s.ageMax;
    applyBinds(); renderPrices(); updateAgeInputs(); refresh(); updateVagasUI();
  }
  /* canApi: a página pode ter servidor (não foi aberta direto do arquivo).
     noServer: algo respondeu, mas não é o servidor do CONECTAcamp (site publicado só como arquivos).
     Sem resposta (rede lenta, queda) NÃO conta como "sem servidor": a inscrição tenta de novo ao enviar. */
  var canApi = !!window.fetch && location.protocol !== 'file:';
  var noServer = false;
  function fetchStatus(timeoutMs) {
    if (!canApi) return Promise.resolve(null);
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 2500);
    return window.ccFetch('/api/status', { headers: { 'Accept': 'application/json' }, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (s) { clearTimeout(t); if (s && typeof s.capacity === 'number') { noServer = false; return s; } noServer = true; return null; })
      .catch(function () { clearTimeout(t); return null; });
  }

  /* ---------- CPF (máscara e conferência dos dígitos) ---------- */
  function fmtCpf(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 11), o = d;
    if (d.length > 9) o = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    else if (d.length > 6) o = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    else if (d.length > 3) o = d.slice(0, 3) + '.' + d.slice(3);
    return o;
  }
  function validCpf(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) {
      var s = 0; for (var i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
    }
    return true;
  }
  window.CCUtil = { fmtCpf: fmtCpf, validCpf: validCpf };

  /* ---------- Formulário de pré-cadastro ---------- */
  function field(label, inp, full, hint) {
    var w = el('div', 'field' + (full ? ' full' : ''));
    var l = el('label', '', label + ' '); if (hint) l.appendChild(el('small', '', hint));
    inp.id = inp.id || ('f' + Math.random().toString(36).slice(2, 8)); l.htmlFor = inp.id;
    w.appendChild(l); w.appendChild(inp);
    var err = el('p', 'err'); err.setAttribute('role', 'alert'); w.appendChild(err);
    return w;
  }
  function input(type, name, extra) {
    var i = document.createElement('input'); i.type = type; i.name = name;
    if (type === 'text') i.autocomplete = 'off';
    Object.keys(extra || {}).forEach(function (k) { i.setAttribute(k, extra[k]); });
    return i;
  }
  function addPerson() {
    var n = peopleEl.children.length + 1;
    var box = el('div', 'person');
    var head = el('div', 'person-head'); head.appendChild(el('h4', '', 'Participante ' + n));
    if (n > 1) {
      var rm = el('button', 'rm'); rm.type = 'button';
      rm.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#i-x"/></svg> Remover';
      rm.addEventListener('click', function () { box.remove(); renumber(); refresh(); });
      head.appendChild(rm);
    }
    box.appendChild(head);
    var f = el('div', 'fields');
    var nome = input('text', 'nome', { required: '', autocomplete: n === 1 ? 'name' : 'off' });
    var cpf = input('text', 'cpf', { inputmode: 'numeric', maxlength: '14', placeholder: '000.000.000-00', required: '' });
    cpf.addEventListener('input', function () { cpf.value = fmtCpf(cpf.value); });
    var idade = input('number', 'idade', { min: String(AGE_MIN), max: String(AGE_MAX), inputmode: 'numeric', required: '' });
    var tel = input('tel', 'tel', { inputmode: 'tel', autocomplete: n === 1 ? 'tel' : 'off', required: '' });
    var igreja = input('text', 'igreja');
    var obs = input('text', 'obs');
    f.appendChild(field('Nome completo', nome, true));
    f.appendChild(field('CPF', cpf, false, '(para consultar seu voucher)'));
    f.appendChild(field('Idade', idade));
    f.appendChild(field('WhatsApp', tel, true));
    f.appendChild(field('Igreja / grupo', igreja, true, '(opcional)'));
    f.appendChild(field('Alergias ou restrições alimentares', obs, true, '(opcional)'));
    box.appendChild(f);
    peopleEl.appendChild(box);
    idade.addEventListener('input', refresh);
    refresh();
  }
  function renumber() { $$('.person h4', peopleEl).forEach(function (h, i) { h.textContent = 'Participante ' + (i + 1); }); }

  function people() {
    return $$('.person', peopleEl).map(function (p) {
      var g = function (name) { return (p.querySelector('[name="' + name + '"]') || {}).value || ''; };
      return { nome: g('nome').trim(), cpf: g('cpf').trim(), idade: g('idade').trim(), tel: g('tel').trim(), igreja: g('igreja').trim(), obs: g('obs').trim() };
    });
  }
  function totals() {
    var list = people();
    return { list: list, total: list.length * (P.full || 0) };
  }
  function hasMinor(list) { return list.some(function (p) { var a = parseInt(p.idade, 10); return !isNaN(a) && a < 18; }); }

  function refresh() {
    var t = totals();
    minorBox.hidden = !hasMinor(t.list);
    authBox.hidden = minorBox.hidden || accSel.value !== 'nao';
    summary.innerHTML = '';
    var add = function (k, v, cls) { var r = el('div', 'row' + (cls ? ' ' + cls : '')); r.appendChild(el('span', '', k)); r.appendChild(el('span', '', v)); summary.appendChild(r); };
    add('Participantes', String(t.list.length));
    add('Valor por pessoa', brl(P.full || 0));
    add('Total', brl(t.total), 'total');
  }
  accSel.addEventListener('change', refresh);
  $('#addPerson').addEventListener('click', function () { addPerson(); var last = $$('.person', peopleEl).pop(); if (last) last.querySelector('input').focus(); });

  function setErr(node, msg) {
    var w = node.closest('.field'); if (!w) return;
    node.classList.toggle('invalid', !!msg);
    var e = w.querySelector('.err'); if (e) e.textContent = msg || '';
  }
  var PLAN_LABEL = { pix: 'Pix (pagamento único)', cartao: 'Cartão de crédito (pagamento único)', crediario: 'Crediário (parcelado)' };
  function selectedPlan() { var r = $('input[name="payPlan"]:checked'); return r ? r.value : ''; }
  function validate() {
    var ok = true, firstBad = null;
    var bad = function (node, msg) { setErr(node, msg); ok = false; if (!firstBad) firstBad = node; };
    var seenCpf = {};
    $$('.person', peopleEl).forEach(function (p) {
      var nome = p.querySelector('[name="nome"]'), idade = p.querySelector('[name="idade"]'), tel = p.querySelector('[name="tel"]'), cpf = p.querySelector('[name="cpf"]');
      setErr(nome); setErr(idade); setErr(tel); setErr(cpf);
      if (nome.value.trim().split(/\s+/).length < 2) bad(nome, 'Informe nome e sobrenome.');
      var cd = cpf.value.replace(/\D/g, '');
      if (!validCpf(cpf.value)) bad(cpf, cd ? 'CPF inválido. Confira os números.' : 'Informe o CPF.');
      else if (seenCpf[cd]) bad(cpf, 'Este CPF já foi informado para outro participante.');
      else seenCpf[cd] = true;
      var a = parseInt(idade.value, 10);
      if (isNaN(a)) bad(idade, 'Informe a idade.');
      else if (a < AGE_MIN || a > AGE_MAX) bad(idade, 'O CONECTAcamp é para jovens de ' + AGE_MIN + ' a ' + AGE_MAX + ' anos.');
      if (tel.value.replace(/\D/g, '').length < 10) bad(tel, 'Informe um WhatsApp com DDD.');
    });
    var t = totals();
    $('#accErr').textContent = ''; $('#authErr').textContent = '';
    if (hasMinor(t.list)) {
      if (!accSel.value) { $('#accErr').textContent = 'Selecione uma opção.'; ok = false; firstBad = firstBad || accSel; }
      else if (accSel.value === 'nao' && !$('#authAck').checked) { $('#authErr').textContent = 'Confirme que levará a autorização assinada.'; ok = false; firstBad = firstBad || $('#authAck'); }
    }
    var errs = [];
    $('#planErr').textContent = '';
    if (!selectedPlan()) { $('#planErr').textContent = 'Escolha a forma de pagamento.'; errs.push('Escolha a forma de pagamento (Pix, cartão de crédito ou crediário).'); ok = false; firstBad = firstBad || $('input[name="payPlan"]'); }
    if (!$('#agree').checked || !$('#imgAck').checked) { errs.push('Marque as duas confirmações para continuar.'); ok = false; firstBad = firstBad || (!$('#agree').checked ? $('#agree') : $('#imgAck')); }
    $('#regErr').textContent = errs.join(' ');
    if (firstBad) {
      firstBad.focus();
      /* os botões de pagamento são escondidos: rola até o grupo inteiro para o aviso aparecer na tela */
      var target = firstBad.name === 'payPlan' ? $('.payplan') : firstBad;
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }
    return ok;
  }

  function buildMessage(protocol) {
    var t = totals(), L = [];
    L.push('*Pré-inscrição CONECTAcamp 2027*');
    L.push('Protocolo: ' + protocol);
    L.push('');
    L.push('*Participantes*');
    t.list.forEach(function (p, i) {
      var line = (i + 1) + ') ' + p.nome + ' — ' + p.idade + ' anos';
      if (p.igreja) line += ' — ' + p.igreja;
      L.push(line); L.push('   WhatsApp: ' + p.tel);
      if (p.obs) L.push('   Obs.: ' + p.obs);
    });
    L.push('');
    L.push('Acomodação: dormitório');
    L.push('Total: ' + brl(t.total) + ' (' + brl(P.full || 0) + ' por pessoa)');
    L.push('Forma de pagamento: ' + (PLAN_LABEL[selectedPlan()] || 'a combinar com a organização'));
    if (hasMinor(t.list)) L.push('Menores de 18: ' + (accSel.value === 'sim' ? 'acompanhados do responsável' : 'levarão autorização assinada'));
    L.push('Autorização de imagem e confirmação dos dados: ok');
    return L.join('\n');
  }

  var lastMsg = '';
  function showSuccess(protocol, registered) {
    lastMsg = buildMessage(protocol);
    $('#okTitle').textContent = registered ? 'Pré-cadastro registrado!' : 'Pré-cadastro pronto!';
    $('#okText').textContent = registered ? 'Sua pré-inscrição foi registrada. Agora envie a mensagem abaixo para a organização pelo WhatsApp para combinar o pagamento e garantir sua vaga.' : 'Envie a mensagem abaixo para a organização para garantir sua vaga.';
    $('#protocol').textContent = protocol;
    $('#msgPreview').textContent = lastMsg;
    $('#copyNote').textContent = '';
    var my = $('#successMy'), myBtn = $('#successMyBtn');
    if (my && myBtn) { my.hidden = !registered; myBtn.setAttribute('data-q', protocol); }
    var wa = $('#waSend');
    if (waNumber) { wa.href = 'https://wa.me/' + waNumber + '?text=' + encodeURIComponent(lastMsg); wa.hidden = false; } else { wa.hidden = true; }
    form.hidden = true; var s = $('#success'); s.hidden = false; s.focus(); s.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validate()) return;
    var btn = $('.submit', form);
    var offline = function () { showSuccess('CC-' + Date.now().toString(36).toUpperCase().slice(-6), false); };
    if (!canApi) { offline(); return; }
    btn.disabled = true; $('#regErr').textContent = '';
    if (live.api) { sendReg(btn); return; }
    /* As vagas não carregaram ao abrir a página: tenta o servidor de novo antes de desistir dele */
    fetchStatus(8000).then(function (s) {
      if (s) { applyStatus(s); if (form.hidden) { btn.disabled = false; return; } sendReg(btn); return; }
      btn.disabled = false;
      if (noServer) offline();
      else $('#regErr').textContent = 'Não foi possível falar com o servidor agora. Verifique sua conexão e toque em “Enviar pré-cadastro” de novo. Seus dados continuam preenchidos.';
    });
  });
  function sendReg(btn) {
    var t = totals();
    var payload = {
      participants: t.list.map(function (p) { return { nome: p.nome, cpf: p.cpf.replace(/\D/g, ''), idade: parseInt(p.idade, 10), tel: p.tel, igreja: p.igreja, obs: p.obs }; }),
      accompanied: hasMinor(t.list) ? accSel.value : '',
      authAck: $('#authAck').checked, agree: $('#agree').checked, imgAck: $('#imgAck').checked, payPlan: selectedPlan(),
      hp: ($('#hp') || {}).value || ''
    };
    window.ccFetch('/api/registrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (o) {
        if (o.res.ok && o.data && o.data.protocol) { showSuccess(o.data.protocol, true); fetchStatus().then(function (s) { if (s) applyStatus(s); }); }
        else {
          $('#regErr').textContent = (o.data && o.data.error) || 'Não foi possível enviar agora. Tente de novo em instantes.';
          if (o.res.status === 409 || o.res.status === 403) fetchStatus().then(function (s) { if (s) applyStatus(s); });
        }
      })
      .catch(function () { $('#regErr').textContent = 'Não foi possível enviar agora. Verifique sua conexão e tente de novo, ou fale com a organização pelo WhatsApp.'; })
      .then(function () { btn.disabled = false; });
  }
  $('#copyMsg').addEventListener('click', function () {
    var note = $('#copyNote');
    var done = function () { note.textContent = 'Mensagem copiada. É só colar no WhatsApp da organização.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lastMsg).then(done, function () { note.textContent = 'Não foi possível copiar. Selecione o texto acima e copie manualmente.'; });
    else { var r = document.createRange(); r.selectNodeContents($('#msgPreview')); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); note.textContent = 'Texto selecionado. Copie e cole no WhatsApp da organização.'; }
  });
  $('#newReg').addEventListener('click', function () {
    $$('input[name="payPlan"]').forEach(function (r) { r.checked = false; });
    peopleEl.innerHTML = ''; accSel.value = ''; $('#authAck').checked = false; $('#agree').checked = false; $('#imgAck').checked = false;
    addPerson(); $('#success').hidden = true; updateVagasUI(); if (!live.api) form.hidden = false; form.scrollIntoView({ block: 'start' });
  });

  addPerson();

  /* Consulta as vagas e só então inicia as animações de contagem (evita o número "pular") */
  fetchStatus().then(function (s) { if (s) applyStatus(s); startCounters(); });
})();

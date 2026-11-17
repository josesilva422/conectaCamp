/* CONECTAcamp — "Minha inscrição": consulta por CPF/código e voucher por pessoa (sem dependências) */
(function () {
  'use strict';

  var dlg = document.getElementById('dlgMy');
  if (!dlg || typeof dlg.showModal !== 'function') return;

  var U = window.CCUtil || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  var form = $('#myForm'), q = $('#myQ'), err = $('#myErr'), go = $('#myGo'), result = $('#myResult'), lookup = $('#myLookup');
  var STUB_LABEL = { confirmado: 'Confirmado', pre: 'Pré-cadastro', parcial: 'Pré-cadastro', cancelada: 'Cancelada' };
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- abrir / fechar ---------- */
  function showLookup() { result.hidden = true; result.textContent = ''; lookup.hidden = false; }
  function openMy(prefill, autorun) {
    if (!dlg.open) dlg.showModal();
    try { history.replaceState(null, '', '#minha-inscricao'); } catch (e) { /* sem histórico */ }
    showLookup();
    err.textContent = '';
    q.value = prefill || '';
    if (autorun && prefill) run(prefill); else q.focus();
  }
  dlg.addEventListener('close', function () {
    showLookup(); q.value = ''; err.textContent = '';   /* não deixa dados de outra pessoa na tela */
    var w = dlg.querySelector('.wel'); if (w) w.remove(); dlg.classList.remove('has-wel');
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sem histórico */ }
  });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $('#myClose').addEventListener('click', function () { dlg.close(); });
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-my]') : null;
    if (!t) return;
    e.preventDefault();
    var pre = t.getAttribute('data-q') || '';
    openMy(pre, !!pre);
  });
  if (location.hash === '#minha-inscricao') openMy('', false);

  /* CPF ganha máscara enquanto digita; códigos (CC-…) ficam como estão */
  q.addEventListener('input', function () {
    err.textContent = '';
    if (q.value && /^[\d.\-\s]*$/.test(q.value) && U.fmtCpf) q.value = U.fmtCpf(q.value);
  });

  /* ---------- consulta ---------- */
  form.addEventListener('submit', function (e) { e.preventDefault(); run(q.value); });
  function run(value) {
    value = String(value || '').trim();
    if (!value) { err.textContent = 'Digite o CPF ou o código da inscrição.'; q.focus(); return; }
    if (/^[\d.\-\s]+$/.test(value)) {
      var d = value.replace(/\D/g, '');
      if (d.length !== 11) { err.textContent = 'O CPF tem 11 números. Confira e tente de novo.'; q.focus(); return; }
      if (U.validCpf && !U.validCpf(d)) { err.textContent = 'CPF inválido. Confira os números.'; q.focus(); return; }
    }
    if (location.protocol === 'file:') { err.textContent = 'A consulta só funciona com o site no ar.'; return; }
    go.disabled = true; err.textContent = '';
    fetch('/api/voucher', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: value }) })
      .then(function (res) { return res.json().catch(function () { return null; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (o) {
        if (o.res.ok && o.data && o.data.vouchers) render(o.data);
        else err.textContent = (o.data && o.data.error) || 'Não foi possível consultar agora. Tente de novo em instantes.';
      })
      .catch(function () { err.textContent = 'Sem conexão com o servidor. Verifique a internet e tente de novo.'; })
      .then(function () { go.disabled = false; });
  }

  /* ---------- resultado: só o voucher ---------- */
  function render(data) {
    var r = data.registration;
    result.textContent = '';

    var list = el('div', 'vch-list');
    data.vouchers.forEach(function (v) { list.appendChild(voucherEl(v, r, !!data.selfCheckin)); });
    result.appendChild(list);

    var tools = el('div', 'my-tools');
    var pr = el('button', 'btn btn-ghost', 'Imprimir'); pr.type = 'button'; pr.addEventListener('click', function () { window.print(); });
    var again = el('button', 'btn btn-ghost', 'Consultar outra inscrição'); again.type = 'button';
    again.addEventListener('click', function () { showLookup(); q.value = ''; q.focus(); });
    if (r.status === 'confirmado') tools.appendChild(pr);
    tools.appendChild(again);
    result.appendChild(tools);

    lookup.hidden = true; result.hidden = false;
    dlg.scrollTop = 0;
  }

  function qrText(code) { return location.origin + '/admin/?v=' + encodeURIComponent(code); }
  var pad2 = function (n) { return String(n).padStart(2, '0'); };
  function fmtAt(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + ' às ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* Parte destacada: mostra a entrada confirmada e um relógio correndo (prova de que não é uma foto da tela) */
  function usedStub(at) {
    var s = el('div', 'vch-stub vch-used');
    s.setAttribute('role', 'status');
    s.appendChild(el('span', 'vch-check', '✓'));
    s.appendChild(el('p', 'vch-in', 'Entrada confirmada'));
    s.appendChild(el('p', 'vch-at', fmtAt(at)));
    var live = el('p', 'vch-live'); live.appendChild(el('i')); var clock = el('span'); live.appendChild(clock); s.appendChild(live);
    var tick = function () { var n = new Date(); clock.textContent = 'Agora ' + pad2(n.getHours()) + ':' + pad2(n.getMinutes()) + ':' + pad2(n.getSeconds()); };
    tick();
    var timer = setInterval(function () { if (!document.contains(s)) { clearInterval(timer); return; } tick(); }, 1000);
    return s;
  }

  /* Destacar o voucher: arrastar a parte do QR (para o lado no computador, para baixo no celular) registra a entrada */
  /* pedacinhos de papel que voam da linha do rasgo */
  function scraps(art, stub, vertical) {
    if (reduceMotion || !art.animate) return;
    var ar = art.getBoundingClientRect(), sr = stub.getBoundingClientRect();
    var tones = ['#fff', '#4ADE80', '#090B12', '#FF6A1F'];
    for (var i = 0; i < 22; i++) {
      var s = el('i', 'vch-scrap');
      var size = 5 + Math.random() * 9;
      s.style.width = size + 'px'; s.style.height = (size * (0.5 + Math.random() * 0.8)) + 'px';
      s.style.background = tones[i % tones.length];
      s.style.left = (vertical ? Math.random() * ar.width : sr.left - ar.left) + 'px';
      s.style.top = (vertical ? sr.top - ar.top : Math.random() * ar.height) + 'px';
      art.appendChild(s);
      var dx = (Math.random() - 0.5) * (vertical ? 120 : 170), dy = (Math.random() - 0.5) * (vertical ? 170 : 120) - 30;
      (function (node) {
        var a = node.animate([
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (Math.random() * 720 - 360) + 'deg)', opacity: 0 }
        ], { duration: 550 + Math.random() * 500, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'forwards' });
        a.onfinish = function () { node.remove(); };
      })(s);
    }
  }

  /* ---------- boas-vindas: aparece depois que o voucher é destacado ---------- */
  var welImg = null;
  function welcomeImg() {
    if (welImg) return welImg;
    welImg = new Image();
    welImg.className = 'wel-img'; welImg.alt = ''; welImg.decoding = 'async';
    welImg.sizes = '(max-width: 640px) 100vw, 66vh';
    welImg.srcset = 'img/bem-vindo.webp 927w, img/bem-vindo-4k.webp 2224w';
    welImg.src = 'img/bem-vindo.webp';
    return welImg;
  }
  function showWelcome(v, at) {
    var old = dlg.querySelector('.wel'); if (old) old.remove();
    var o = el('div', 'wel'); o.setAttribute('role', 'status');
    o.appendChild(el('div', 'wel-rays'));
    var txt = el('div', 'wel-txt');
    txt.appendChild(el('p', 'wel-kick', '✓ Entrada confirmada · ' + fmtAt(at)));
    var h = el('h2', 'wel-title'); h.setAttribute('aria-label', 'Bem-vindo!');
    'Bem-vindo!'.split('').forEach(function (ch, i) { var s = el('span', '', ch); s.style.setProperty('--i', i); s.setAttribute('aria-hidden', 'true'); h.appendChild(s); });
    txt.appendChild(h);
    txt.appendChild(el('p', 'wel-name', v.nome.split(' ')[0]));
    o.appendChild(txt);
    o.appendChild(welcomeImg());
    var btn = el('button', 'btn wel-btn', 'Ver meu voucher'); btn.type = 'button';
    var close = function () {
      o.classList.add('out'); dlg.classList.remove('has-wel');
      setTimeout(function () { o.remove(); }, reduceMotion ? 0 : 320);
    };
    btn.addEventListener('click', close);
    o.appendChild(btn);
    dlg.appendChild(o); dlg.classList.add('has-wel'); dlg.scrollTop = 0;
    try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
  }

  var TEAR = 80;
  function makeTearable(art, stub, v, msg) {
    var busy = false, drag = null;
    welcomeImg(); /* já vai baixando a imagem das boas-vindas */
    var vertical = function () { return window.matchMedia && window.matchMedia('(max-width:640px)').matches; };
    var move = function (d, rot) { stub.style.transform = (vertical() ? 'translateY(' : 'translateX(') + d + ') rotate(' + rot + 'deg)'; };
    function reset() { stub.classList.remove('dragging', 'torn'); art.classList.remove('ripping'); stub.style.transform = ''; stub.style.opacity = ''; }
    function fail(m) { busy = false; reset(); msg.textContent = m; }
    function done(at) {
      var u = usedStub(at);
      if (!reduceMotion) u.classList.add('pop');
      art.replaceChild(u, stub);
      art.classList.remove('vch-tear', 'ripping'); art.classList.add('is-used');
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* sem vibração */ } }
      showWelcome(v, at);
    }
    function commit() {
      if (busy) return;
      busy = true; msg.textContent = '';
      stub.classList.remove('dragging'); stub.classList.add('torn'); art.classList.add('ripping');
      scraps(art, stub, vertical());
      move('85%', 14); stub.style.opacity = '0';
      var t0 = Date.now();
      fetch('/api/voucher/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: v.code }) })
        .then(function (res) { return res.json().catch(function () { return null; }).then(function (data) { return { res: res, data: data }; }); })
        .then(function (o) {
          if (o.res.ok && o.data && o.data.at) setTimeout(function () { done(o.data.at); }, Math.max(0, 600 - (Date.now() - t0)));
          else fail((o.data && o.data.error) || 'Não foi possível confirmar a entrada agora. Tente de novo ou procure a organização.');
        })
        .catch(function () { fail('Sem conexão. Verifique a internet e destaque de novo, ou procure a organização.'); });
    }
    stub.addEventListener('pointerdown', function (e) {
      if (busy || e.button) return;
      drag = { x: e.clientX, y: e.clientY, d: 0 };
      try { stub.setPointerCapture(e.pointerId); } catch (err) { /* navegador antigo */ }
      stub.classList.add('dragging');
    });
    stub.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var d = Math.max(0, vertical() ? e.clientY - drag.y : e.clientX - drag.x);
      drag.d = d; move(d + 'px', (d / 30).toFixed(2));
      art.classList.toggle('ripping', d > 12);
    });
    var end = function (cancelled) {
      if (!drag) return;
      var d = drag.d; drag = null;
      if (!cancelled && d >= TEAR) commit(); else reset();
    };
    stub.addEventListener('pointerup', function () { end(false); });
    stub.addEventListener('pointercancel', function () { end(true); });
    /* teclado e leitor de tela: Enter ou espaço, com confirmação */
    stub.tabIndex = 0; stub.setAttribute('role', 'button');
    stub.setAttribute('aria-label', 'Destacar o voucher de ' + v.nome + ' e confirmar a entrada');
    stub.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (confirm('Confirmar a entrada de ' + v.nome + ' agora? Faça isso só na chegada ao acampamento.')) commit();
    });
  }

  function voucherEl(v, r, selfOn) {
    var conf = r.status === 'confirmado';
    var wrap = el('div', 'vch-wrap');
    var art = el('article', 'vch st-' + r.status);
    art.setAttribute('aria-label', 'Voucher de ' + v.nome);

    var main = el('div', 'vch-main');
    main.appendChild(el('p', 'vch-top', 'Voucher · Acampamento Jovem'));
    var brand = el('p', 'vch-brand', 'CONECTA'); brand.appendChild(el('span', '', 'camp')); main.appendChild(brand);
    main.appendChild(el('p', 'vch-ed', '1ª edição · 2027'));
    main.appendChild(el('p', 'vch-name', v.nome));
    var dl = el('dl', 'vch-data');
    var add = function (k, val) { var d = el('div'); d.appendChild(el('dt', '', k)); d.appendChild(el('dd', '', val)); dl.appendChild(d); };
    add('Idade', v.idade + ' anos');
    if (v.igreja) add('Igreja / grupo', v.igreja);
    if (v.cpf) add('CPF', v.cpf);
    main.appendChild(dl);
    if (v.minor) {
      main.appendChild(el('p', 'vch-note', v.auth === 'pendente' ? 'Menor de 18 anos: levar a autorização assinada pelo responsável.' : v.auth === 'recebida' ? 'Menor de 18 anos: autorização do responsável recebida.' : 'Menor de 18 anos: vem acompanhado do responsável.'));
    }
    art.appendChild(main);

    var msg = el('p', 'err vch-msg'); msg.setAttribute('role', 'alert');
    if (conf && v.checkin) {
      art.classList.add('is-used');
      art.appendChild(usedStub(v.checkin.at));
    } else {
      var tear = conf && selfOn;
      var stub = el('div', 'vch-stub');
      if (tear) stub.appendChild(el('p', 'vch-pull', 'Arraste para destacar'));
      var box = el('div', 'vch-qr' + (conf ? '' : ' off'));
      if (conf && window.QR) {
        try { box.innerHTML = window.QR.svg(qrText(v.code), { margin: 1, label: 'QR Code do voucher de ' + v.nome }); }
        catch (e) { box.appendChild(el('span', 'vch-stamp', 'QR indisponível')); }
      } else {
        var s = el('span', 'vch-stamp', r.status === 'cancelada' ? 'Cancelada' : 'Pré-cadastro');
        box.appendChild(s);
        if (r.status !== 'cancelada') box.appendChild(el('small', '', 'O voucher é liberado quando o pagamento for confirmado.'));
      }
      stub.appendChild(box);
      stub.appendChild(el('p', 'vch-code', v.code));
      stub.appendChild(el('span', 'vch-status', STUB_LABEL[r.status] || ''));
      if (conf && !selfOn) stub.appendChild(el('small', 'vch-soon', 'No dia do acampamento, você destaca esta parte pelo celular para confirmar a entrada.'));
      art.appendChild(stub);
      if (tear) { art.classList.add('vch-tear'); makeTearable(art, stub, v, msg); }
    }
    wrap.appendChild(art);
    wrap.appendChild(msg);

    if (conf) {
      var save = el('button', 'btn btn-ghost vch-save', 'Salvar imagem do voucher'); save.type = 'button';
      save.addEventListener('click', function () { savePng(v, save); });
      wrap.appendChild(save);
    }
    return wrap;
  }

  /* ---------- imagem do voucher (para guardar na galeria) ---------- */
  function rr(g, x, y, w, h, rad) {
    g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + w, y, x + w, y + h, rad); g.arcTo(x + w, y + h, x, y + h, rad); g.arcTo(x, y + h, x, y, rad); g.arcTo(x, y, x + w, y, rad); g.closePath();
  }
  function fitText(g, text, font, maxW, size) {
    do { g.font = font.replace('{s}', size + 'px'); size -= 2; } while (g.measureText(text).width > maxW && size > 26);
    return size + 2;
  }
  function drawVoucher(v) {
    var W = 1280, H = 560, SW = 400, PAD = 64;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d');
    g.save(); rr(g, 0, 0, W, H, 28); g.clip();
    g.fillStyle = '#090B12'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 2;
    for (var x = -H; x < W - SW; x += 14) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }

    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#9DB8FF'; g.font = '800 24px Archivo, Arial, sans-serif';
    g.fillText('VOUCHER · ACAMPAMENTO JOVEM', PAD, 92);
    g.fillStyle = '#fff'; g.font = '116px Anton, Impact, sans-serif';
    g.fillText('CONECTA', PAD, 205);
    var cw = g.measureText('CONECTA').width;
    g.fillStyle = '#FF6A1F'; g.font = '60px Anton, Impact, sans-serif';
    g.fillText('camp', PAD + cw + 14, 205);
    g.fillStyle = '#2563EB'; g.fillRect(PAD, 232, 236, 46);
    g.fillStyle = '#fff'; g.font = '30px Anton, Impact, sans-serif'; g.fillText('1ª EDIÇÃO · 2027', PAD + 14, 267);

    g.fillStyle = '#fff';
    var nameSize = fitText(g, v.nome.toUpperCase(), '{s} Anton, Impact, sans-serif', W - SW - PAD * 2, 74);
    g.font = nameSize + 'px Anton, Impact, sans-serif';
    g.fillText(v.nome.toUpperCase(), PAD, 360);
    g.fillStyle = '#9DB8FF'; g.font = '600 26px Archivo, Arial, sans-serif';
    var line1 = v.idade + ' anos' + (v.igreja ? ' · ' + v.igreja : '');
    g.fillText(line1.length > 52 ? line1.slice(0, 51) + '…' : line1, PAD, 412);
    if (v.cpf) g.fillText('CPF ' + v.cpf, PAD, 452);
    if (v.minor) { g.fillStyle = '#FFB38A'; g.font = '800 22px Archivo, Arial, sans-serif'; g.fillText('MENOR DE 18 ANOS', PAD, 500); }

    var sx = W - SW;
    g.fillStyle = '#4ADE80'; g.fillRect(sx, 0, SW, H);
    g.save(); g.strokeStyle = 'rgba(9,11,18,.55)'; g.lineWidth = 4; g.setLineDash([12, 10]); g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, H); g.stroke(); g.restore();
    var qr = window.QR.encode(qrText(v.code)), margin = 2, n = qr.size + margin * 2, cell = Math.floor(280 / n), qs = cell * n;
    var qx = sx + (SW - qs) / 2, qy = 50;
    g.fillStyle = '#fff'; g.fillRect(qx - 10, qy - 10, qs + 20, qs + 20);
    g.fillStyle = '#000';
    for (var yy = 0; yy < qr.size; yy++) for (var xx = 0; xx < qr.size; xx++) if (qr.modules[yy][xx]) g.fillRect(qx + (xx + margin) * cell, qy + (yy + margin) * cell, cell, cell);
    g.fillStyle = '#090B12'; g.textAlign = 'center';
    g.font = '800 30px Archivo, Arial, sans-serif'; g.fillText(v.code, sx + SW / 2, qy + qs + 62);
    g.font = '40px Anton, Impact, sans-serif'; g.fillText('CONFIRMADO', sx + SW / 2, qy + qs + 114);
    g.restore();
    return c;
  }
  function savePng(v, btn) {
    btn.disabled = true;
    var fonts = (document.fonts && document.fonts.load) ? Promise.all([document.fonts.load('60px Anton'), document.fonts.load('800 24px Archivo')]).catch(function () {}) : Promise.resolve();
    fonts.then(function () {
      var canvas = drawVoucher(v);
      canvas.toBlob(function (blob) {
        if (!blob) { btn.disabled = false; return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'voucher-conectacamp-' + v.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
        btn.disabled = false;
      }, 'image/png');
    });
  }
})();

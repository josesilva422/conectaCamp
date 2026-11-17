/* Painel do organizador — CONECTAcamp (sem dependências, compatível com CSP estrita) */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var METHODS = ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'];
  var LABEL = { pago: 'Pago', pendente: 'Pendente', parcial: 'Parcial', cancelado: 'Cancelado' };
  var PLAN_NAMES = { pix: 'Pix', cartao: 'Cartão de crédito', crediario: 'Crediário' };
  var state = { regs: [], stats: null, settings: null, q: '', status: 'todos', sort: 'recentes', openId: null, editing: false };

  /* ---------- utilidades ---------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    var kids = Array.prototype.slice.call(arguments, 2);
    (function add(list) {
      list.forEach(function (c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) return add(c);
        el.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  }
  function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function dt(iso) { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function dday(s) { var p = String(s).split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  /* Número no formato do wa.me: só dígitos, com 55 na frente e sem zeros de discagem (0 62..., 00 55 62...). */
  function phoneFull(tel) { var d = digits(tel).replace(/^0+/, ''); return d.length <= 11 ? '55' + d : d; }
  function waLink(tel, text) { return 'https://wa.me/' + phoneFull(tel) + (text ? '?text=' + encodeURIComponent(text) : ''); }
  function fmtCpf(v) {
    var d = digits(v).slice(0, 11), o = d;
    if (d.length > 9) o = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    else if (d.length > 6) o = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    else if (d.length > 3) o = d.slice(0, 3) + '.' + d.slice(3);
    return o;
  }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  var toastTimer;
  function toast(msg, bad) {
    var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function api(method, url, body) {
    return window.ccFetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.status === 401 && url !== '/api/admin/login') { showLogin(); var e1 = new Error('Sessão expirada. Entre novamente.'); e1.status = 401; throw e1; }
        if (!res.ok) { var e2 = new Error((data && data.error) || 'Algo deu errado.'); e2.status = res.status; e2.data = data; throw e2; }
        return data;
      });
    });
  }

  /* ---------- login / sessão ---------- */
  function closeAll() { ['dlgDetail', 'dlgNew', 'dlgSettings', 'dlgCheck'].forEach(function (id) { var d = $('#' + id); if (d.open) d.close(); }); }
  /* Com o Supabase o login é por e-mail e senha; com o servidor local, só a senha */
  var sbMode = window.CCBackend && window.CCBackend.mode === 'supabase';
  if (sbMode) {
    $('#emailRow').hidden = false;
    var savedEmail = ''; try { savedEmail = localStorage.getItem('cc_admin_email') || ''; } catch (e) { /* sem storage */ }
    $('#email').value = savedEmail || window.CCBackend.adminEmail || '';
  }
  function showLogin() { $('#app').hidden = true; $('#login').hidden = false; closeAll(); setTimeout(function () { (sbMode && !$('#email').value ? $('#email') : $('#pw')).focus(); }, 0); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; }
  function load() {
    return api('GET', '/api/admin/data').then(function (d) {
      state.regs = d.registrations; state.stats = d.stats; state.settings = d.settings;
      showApp(); render(); if ($('#dlgDetail').open) renderDetail();
      consumeDeepLink();
    });
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button'); btn.disabled = true; $('#loginErr').textContent = '';
    api('POST', '/api/admin/login', { password: $('#pw').value, email: sbMode ? $('#email').value : undefined })
      .then(function () { $('#pw').value = ''; if (sbMode) { try { localStorage.setItem('cc_admin_email', $('#email').value.trim().toLowerCase()); } catch (e) { /* sem storage */ } } return load(); })
      .catch(function (err) { $('#loginErr').textContent = err.message; })
      .then(function () { btn.disabled = false; });
  });
  /* Exportar CSV: com o Supabase o arquivo é montado aqui no navegador */
  $('#btnCsv').addEventListener('click', function (e) {
    if (!sbMode) return;
    e.preventDefault();
    window.CCBackend.downloadCsv().catch(function (err) { toast(err.message || 'Não foi possível exportar.', true); });
  });
  $('#btnLogout').addEventListener('click', function () { api('POST', '/api/admin/logout').catch(function () {}).then(showLogin); });

  /* ---------- resumo ---------- */
  function renderStats() {
    var s = state.stats, box = $('#stats'); box.textContent = '';
    var fill = h('i'); fill.style.width = Math.min(100, Math.round(s.taken / s.capacity * 100)) + '%';
    box.append(
      h('div', { class: 'stat hot' }, h('small', null, 'Vagas ocupadas'), h('b', null, s.taken + ' / ' + s.capacity), h('span', null, s.remaining > 0 ? 'Restam ' + s.remaining + ' vagas' : 'Vagas esgotadas'), h('div', { class: 'bar' }, fill)),
      h('div', { class: 'stat' }, h('small', null, 'Inscrições'), h('b', null, s.registrations), h('span', null, s.participants + ' participantes')),
      h('div', { class: 'stat green' }, h('small', null, 'Pagas'), h('b', null, s.pago), h('span', null, brl(s.received) + ' recebidos')),
      h('div', { class: 'stat warn' }, h('small', null, 'A receber'), h('b', null, s.pendente + s.parcial), h('span', null, brl(s.toReceive) + ' em aberto')),
      h('div', { class: 'stat' }, h('small', null, 'Menores de 18'), h('b', null, s.minors), h('span', null, s.authPending ? s.authPending + ' sem autorização recebida' : 'Autorizações em dia')),
      h('div', { class: 'stat' }, h('small', null, 'Canceladas'), h('b', null, s.cancelado), h('span', null, 'não ocupam vaga'))
    );
  }

  /* ---------- lista ---------- */
  function visible() {
    var q = state.q.trim().toLowerCase(), qd = digits(q);
    var arr = state.regs.filter(function (r) {
      if (state.status !== 'todos' && r.paymentStatus !== state.status) return false;
      if (!q) return true;
      if (r.protocol.toLowerCase().indexOf(q) >= 0) return true;
      return r.participants.some(function (p) {
        return p.nome.toLowerCase().indexOf(q) >= 0 || (p.igreja || '').toLowerCase().indexOf(q) >= 0 || (p.voucher || '').toLowerCase().indexOf(q) >= 0
          || (qd.length >= 3 && (digits(p.tel).indexOf(qd) >= 0 || digits(p.cpf).indexOf(qd) >= 0));
      });
    });
    arr.sort(function (a, b) {
      if (state.sort === 'antigas') return a.createdAt < b.createdAt ? -1 : 1;
      if (state.sort === 'nome') return a.participants[0].nome.localeCompare(b.participants[0].nome, 'pt-BR');
      if (state.sort === 'valor') return b.amount - a.amount;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    return arr;
  }
  function pill(r) { return h('span', { class: 'pill ' + r.paymentStatus }, LABEL[r.paymentStatus]); }
  function renderList() {
    var list = visible(), box = $('#list'); box.textContent = '';
    $('#count').textContent = list.length + (list.length === 1 ? ' inscrição' : ' inscrições') + (list.length !== state.regs.length ? ' (de ' + state.regs.length + ')' : '');
    if (!list.length) { box.append(h('p', { class: 'empty' }, state.regs.length ? 'Nenhuma inscrição com esses filtros.' : 'Ainda não há inscrições. Elas aparecem aqui assim que alguém se cadastrar.')); return; }
    list.forEach(function (r) {
      var first = r.participants[0], minors = r.participants.some(function (p) { return p.idade < 18; });
      var open = function () { openDetail(r.id); };
      var pct = r.amount > 0 ? Math.max(0, Math.min(100, Math.round(r.paid / r.amount * 100))) : 0;
      var fill = h('i'); fill.style.width = pct + '%';
      var extra = r.participants.length - 1;
      box.append(h('article', { class: 'card ' + r.paymentStatus, tabindex: '0', role: 'button', 'aria-label': 'Abrir detalhes de ' + first.nome, onclick: open, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } },
        h('div', { class: 'card-top' }, h('span', { class: 'proto' }, r.protocol), pill(r)),
        h('h3', { class: 'card-name' }, first.nome, minors ? h('span', { class: 'tagm' }, 'menor') : null),
        h('p', { class: 'card-sub' }, extra > 0 ? '+' + extra + (extra === 1 ? ' participante' : ' participantes') : '1 participante', first.igreja ? ' · ' + first.igreja : ''),
        h('p', { class: 'card-date' }, dt(r.createdAt)),
        h('p', { class: 'card-plan' }, h('span', { class: 'chip-plan plan-' + (r.payPlan || 'none') }, PLAN_NAMES[r.payPlan] || 'Forma a definir')),
        h('div', { class: 'card-money' }, h('div', null, h('small', null, 'Valor'), h('b', null, brl(r.amount))), h('div', null, h('small', null, 'Pago'), h('b', null, brl(r.paid)))),
        h('div', { class: 'bar' }, fill),
        h('span', { class: 'card-go' }, 'Ver detalhes →')));
    });
  }
  function render() { renderStats(); renderList(); }
  $('#q').addEventListener('input', function (e) { state.q = e.target.value; renderList(); });
  $('#fStatus').addEventListener('change', function (e) { state.status = e.target.value; renderList(); });
  $('#fSort').addEventListener('change', function (e) { state.sort = e.target.value; renderList(); });

  /* ---------- mudanças nos dados ---------- */
  function applyReg(data) {
    var i = state.regs.findIndex(function (x) { return x.id === data.registration.id; });
    if (i >= 0) state.regs[i] = data.registration; else state.regs.unshift(data.registration);
    state.stats = data.stats; render(); if ($('#dlgDetail').open) renderDetail();
  }
  function run(btn, promise, okMsg) {
    if (btn) btn.disabled = true;
    return promise.then(function (d) { if (okMsg) toast(okMsg); return d; })
      .catch(function (e) { toast(e.message, true); throw e; })
      .then(function (d) { if (btn) btn.disabled = false; return d; }, function (e) { if (btn) btn.disabled = false; throw e; });
  }

  /* ---------- detalhes ---------- */
  function waMessage(r) {
    var n = r.participants[0].nome.split(' ')[0];
    if (r.paymentStatus === 'pago') return 'Olá, ' + n + '! Recebemos o pagamento da sua inscrição no CONECTAcamp (protocolo ' + r.protocol + '). Sua vaga está confirmada! Em breve enviamos as próximas informações.';
    return 'Olá, ' + n + '! Aqui é da organização do CONECTAcamp. Recebemos sua pré-inscrição (protocolo ' + r.protocol + '). Para confirmar sua vaga falta ' + brl(Math.max(0, r.amount - r.paid)) + '. Como prefere pagar?';
  }
  function openDetail(id) { state.openId = id; state.editing = false; renderDetail(); var d = $('#dlgDetail'); if (!d.open) d.showModal(); }
  function methodSelect(id, value) {
    var s = h('select', { id: id }, METHODS.map(function (m) { return h('option', { value: m }, m); }));
    s.value = value || 'Pix'; return s;
  }
  function renderDetail() {
    var r = state.regs.find(function (x) { return x.id === state.openId; }), dlg = $('#dlgDetail');
    if (!r) { if (dlg.open) dlg.close(); return; }
    var remaining = Math.max(0, r.amount - r.paid);
    var minors = r.participants.filter(function (p) { return p.idade < 18; });
    var body = h('div', { class: 'dlg-body' });

    body.append(h('div', { class: 'dlg-head' },
      h('div', null, h('h2', null, r.protocol), h('div', { class: 'meta' }, pill(r), h('span', null, 'Recebida em ' + dt(r.createdAt)), h('span', null, r.source === 'admin' ? 'Cadastrada pelo painel' : 'Veio pelo site'))),
      h('button', { class: 'x', type: 'button', 'aria-label': 'Fechar', onclick: function () { dlg.close(); } }, '×')));

    /* participantes */
    var sec = h('div', { class: 'sect' });
    sec.append(h('h3', null, 'Participantes (' + r.participants.length + ')', h('button', { class: 'btn btn-w btn-sm', type: 'button', onclick: function () { state.editing = !state.editing; renderDetail(); } }, state.editing ? 'Cancelar edição' : 'Editar dados')));
    if (!state.editing) {
      r.participants.forEach(function (p) {
        sec.append(h('div', { class: 'person' },
          h('h4', null, p.nome, p.idade < 18 ? h('span', { class: 'tagm' }, 'menor') : null),
          h('p', null, p.idade + ' anos' + (p.igreja ? ' · ' + p.igreja : '')),
          h('p', null, 'WhatsApp: ' + p.tel),
          h('p', null, 'CPF: ' + (p.cpf ? fmtCpf(p.cpf) : 'não informado (use “Editar dados” para incluir)')),
          h('p', { class: 'vline' }, 'Voucher: ', h('b', null, p.voucher || '—')),
          p.obs ? h('p', null, h('span', { class: 'obs' }, 'Alergias/observações: ' + p.obs)) : null,
          p.checkin ? h('p', null, h('span', { class: 'chip-in' }, '✓ Entrada registrada às ' + hhmm(p.checkin.at) + (p.checkin.self ? ' (pelo celular)' : '') + (p.checkin.unpaid ? ' (sem pagamento total)' : ''))) : null,
          h('div', { class: 'links' }, h('a', { class: 'btn btn-w btn-sm', href: waLink(p.tel), target: '_blank', rel: 'noopener' }, 'WhatsApp'), h('a', { class: 'btn btn-w btn-sm', href: 'tel:+' + phoneFull(p.tel) }, 'Ligar'),
            r.status !== 'cancelada' ? h('button', { class: 'btn btn-sm ' + (p.checkin ? 'btn-w' : 'btn-o'), type: 'button', onclick: function (e) { checkin(p, { undo: !!p.checkin }, e.currentTarget); } }, p.checkin ? 'Desfazer entrada' : 'Registrar entrada') : null)));
      });
    } else {
      var inputs = r.participants.map(function (p) {
        var f = { id: p.id, nome: h('input', { value: p.nome, maxlength: '100' }), cpf: h('input', { inputmode: 'numeric', maxlength: '14', placeholder: '000.000.000-00' }), idade: h('input', { type: 'number', min: '0', max: '120', value: String(p.idade) }), tel: h('input', { type: 'tel', value: p.tel, maxlength: '30' }), igreja: h('input', { value: p.igreja || '', maxlength: '100' }), obs: h('input', { value: p.obs || '', maxlength: '200' }) };
        f.nome.value = p.nome; f.cpf.value = fmtCpf(p.cpf); f.idade.value = p.idade; f.tel.value = p.tel; f.igreja.value = p.igreja || ''; f.obs.value = p.obs || '';
        f.cpf.addEventListener('input', function () { f.cpf.value = fmtCpf(f.cpf.value); });
        sec.append(h('div', { class: 'person' },
          h('div', { class: 'field' }, h('label', null, 'Nome completo'), f.nome),
          h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'Idade'), f.idade), h('div', { class: 'field' }, h('label', null, 'CPF'), f.cpf)),
          h('div', { class: 'field' }, h('label', null, 'WhatsApp'), f.tel),
          h('div', { class: 'field' }, h('label', null, 'Igreja / grupo'), f.igreja),
          h('div', { class: 'field' }, h('label', null, 'Alergias / observações'), f.obs)));
        return f;
      });
      var save = h('button', { class: 'btn btn-o', type: 'button' }, 'Salvar alterações');
      save.addEventListener('click', function () {
        run(save, api('PATCH', '/api/admin/registrations/' + r.id, { participants: inputs.map(function (f) { return { id: f.id, nome: f.nome.value, cpf: f.cpf.value, idade: f.idade.value, tel: f.tel.value, igreja: f.igreja.value, obs: f.obs.value }; }) }), 'Dados atualizados.')
          .then(function (d) { state.editing = false; applyReg(d); }).catch(function () {});
      });
      sec.append(save);
    }
    body.append(sec);

    /* menores */
    if (minors.length) {
      var ms = h('div', { class: 'sect' }, h('h3', null, 'Menores de 18 anos'),
        h('p', null, minors.length + (minors.length === 1 ? ' participante menor' : ' participantes menores') + ' · ' + (r.accompanied === 'sim' ? 'vão acompanhados do responsável.' : 'vão SEM o responsável: precisam levar a autorização assinada.')));
      if (r.accompanied === 'nao') {
        var cb = h('input', { type: 'checkbox' }); cb.checked = !!r.authReceived;
        cb.addEventListener('change', function () { run(null, api('PATCH', '/api/admin/registrations/' + r.id, { authReceived: cb.checked }), cb.checked ? 'Autorização marcada como recebida.' : 'Autorização desmarcada.').then(applyReg).catch(function () {}); });
        ms.append(h('label', { class: 'check' }, cb, h('span', null, 'Autorização assinada recebida')));
      }
      body.append(ms);
    }

    /* pagamento: resumo + 3 passos coloridos */
    var plan = r.payPlan || '';
    var single = plan === 'pix' || plan === 'cartao';
    var pct = r.amount > 0 ? Math.max(0, Math.min(100, Math.round(r.paid / r.amount * 100))) : 0;
    var done = r.status !== 'cancelada' && r.amount > 0 && r.paid >= r.amount;
    var ps = h('div', { class: 'sect pay-sect' }, h('h3', null, 'Pagamento', pill(r)));

    var fill = h('i'); fill.style.width = pct + '%';
    ps.append(
      h('div', { class: 'tiles' },
        h('div', { class: 'tile t-total' }, h('small', null, 'Valor da inscrição'), h('b', null, brl(r.amount))),
        h('div', { class: 'tile t-paid' }, h('small', null, 'Já pago'), h('b', null, brl(r.paid))),
        remaining > 0 && r.status !== 'cancelada'
          ? h('div', { class: 'tile t-due' }, h('small', null, 'Falta pagar'), h('b', null, brl(remaining)))
          : h('div', { class: 'tile t-ok' }, h('small', null, 'Situação'), h('b', null, r.status === 'cancelada' ? 'Cancelada' : 'Quitado'))),
      h('div', { class: 'bar bar-lg' }, fill));

    /* passo 1: forma de pagamento escolhida */
    var s1 = h('div', { class: 'step-box s1' }, h('p', { class: 'step' }, h('b', null, '1'), 'Forma de pagamento escolhida'));
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Forma de pagamento' });
    Object.keys(PLAN_NAMES).forEach(function (k) {
      var b = h('button', { type: 'button', class: 'seg-b seg-' + k + (plan === k ? ' on' : ''), 'aria-pressed': String(plan === k) }, PLAN_NAMES[k]);
      b.addEventListener('click', function () {
        if (plan === k) return;
        run(null, api('PATCH', '/api/admin/registrations/' + r.id, { payPlan: k }), 'Forma de pagamento: ' + PLAN_NAMES[k] + '.').then(applyReg).catch(function () {});
      });
      seg.append(b);
    });
    s1.append(seg, h('p', { class: 'hint' }, !plan
      ? 'Escolha como a pessoa vai pagar para poder registrar o pagamento.'
      : single ? PLAN_NAMES[plan] + ': um único pagamento, no valor total.' : 'Crediário: pode registrar vários pagamentos (parcelas) até quitar.'));
    ps.append(s1);

    /* passo 2: pagamentos recebidos */
    var s2 = h('div', { class: 'step-box s2' }, h('p', { class: 'step' }, h('b', null, '2'), 'Pagamentos recebidos (' + r.payments.length + ')'));
    if (r.payments.length) {
      s2.append(h('ul', { class: 'paylist' }, r.payments.map(function (p, i) {
        return h('li', { class: 'pay-item' },
          h('span', { class: 'pay-n' }, single ? 'Pagamento único' : (plan === 'crediario' ? 'Parcela ' + (i + 1) : 'Pagamento ' + (i + 1))),
          h('span', { class: 'pay-v' }, brl(p.amount)),
          h('span', { class: 'pay-m' }, p.method + ' · ' + dday(p.date) + (p.note ? ' · ' + p.note : '')),
          h('button', { class: 'btn btn-bad btn-sm', type: 'button', onclick: function () { if (confirm('Remover este pagamento de ' + brl(p.amount) + '?')) run(null, api('DELETE', '/api/admin/registrations/' + r.id + '/payments/' + p.id), 'Pagamento removido.').then(applyReg).catch(function () {}); } }, 'Remover'));
      })));
    } else s2.append(h('p', { class: 'hint' }, 'Nenhum pagamento recebido ainda.'));
    ps.append(s2);

    /* passo 3: registrar (só aparece quando faz sentido) */
    if (r.status === 'cancelada') {
      ps.append(h('div', { class: 'banner b-off' }, 'Inscrição cancelada: não recebe novos pagamentos.'));
    } else if (done) {
      ps.append(h('div', { class: 'banner b-ok' }, '✓ ' + (single ? 'Pagamento único recebido. Nada mais a pagar.' : 'Pagamento completo: todas as parcelas foram pagas.')));
    } else if (!plan) {
      ps.append(h('div', { class: 'banner b-warn' }, 'Escolha a forma de pagamento (passo 1) para registrar pagamentos.'));
    } else if (single && r.payments.length >= 1) {
      ps.append(h('div', { class: 'banner b-warn' }, PLAN_NAMES[plan] + ' permite um único pagamento, e ele já foi registrado. Para corrigir, remova o pagamento acima e registre de novo.'));
    } else {
      var amount = h('input', { type: 'number', min: '0', step: '0.01' }); amount.value = remaining.toFixed(2);
      if (single) { amount.readOnly = true; amount.className = 'ro'; amount.setAttribute('aria-readonly', 'true'); }
      var method = methodSelect('payMethod', plan === 'cartao' ? 'Cartão' : 'Pix');
      var date = h('input', { type: 'date' }); date.value = today();
      var note = h('input', { placeholder: single ? 'Opcional' : 'Ex.: parcela ' + (r.payments.length + 1), maxlength: '200' });
      var add = h('button', { class: 'btn btn-o', type: 'button' }, single ? 'Registrar pagamento de ' + brl(remaining) : 'Registrar parcela ' + (r.payments.length + 1));
      add.addEventListener('click', function () {
        run(add, api('POST', '/api/admin/registrations/' + r.id + '/payments', { amount: amount.value, method: method.value, date: date.value, note: note.value }), 'Pagamento registrado.').then(applyReg).catch(function () {});
      });
      ps.append(h('div', { class: 'step-box s3' },
        h('p', { class: 'step' }, h('b', null, '3'), single ? 'Registrar o pagamento único' : 'Registrar parcela ' + (r.payments.length + 1) + ' (falta ' + brl(remaining) + ')'),
        h('div', { class: 'addpay' },
          h('div', { class: 'field' }, h('label', null, single ? 'Valor total (R$)' : 'Valor desta parcela (R$)'), amount),
          h('div', { class: 'field' }, h('label', null, 'Como pagou'), method),
          h('div', { class: 'field' }, h('label', null, 'Data'), date),
          h('div', { class: 'field' }, h('label', null, 'Observação'), note)),
        h('div', { class: 'actions' }, add)));
    }
    body.append(ps);

    /* observações */
    var noteBox = h('textarea', { rows: '3', maxlength: '2000', placeholder: 'Anotações internas (não aparecem para o participante)' }); noteBox.value = r.adminNote || '';
    var noteBtn = h('button', { class: 'btn btn-w', type: 'button' }, 'Salvar observação');
    noteBtn.addEventListener('click', function () { run(noteBtn, api('PATCH', '/api/admin/registrations/' + r.id, { adminNote: noteBox.value }), 'Observação salva.').then(applyReg).catch(function () {}); });
    body.append(h('div', { class: 'sect' }, h('h3', null, 'Observações do organizador'), noteBox, h('div', { class: 'actions' }, noteBtn)));

    /* consentimento + ações */
    var consent = r.consent && r.consent.byAdmin ? 'Cadastro feito pelo organizador.' : 'Aceitou o uso de dados e a autorização de imagem em ' + dt((r.consent && r.consent.at) || r.createdAt) + '.';
    var acts = h('div', { class: 'actions' },
      h('a', { class: 'btn btn-w', href: waLink(r.participants[0].tel, waMessage(r)), target: '_blank', rel: 'noopener' }, r.paymentStatus === 'pago' ? 'Enviar confirmação' : 'Cobrar / lembrar'));
    if (r.status === 'cancelada') {
      var re = h('button', { class: 'btn btn-w', type: 'button' }, 'Reativar inscrição');
      re.addEventListener('click', function () {
        run(re, api('PATCH', '/api/admin/registrations/' + r.id, { status: 'ativa' }), 'Inscrição reativada.').then(applyReg).catch(function (e) {
          if (e.data && e.data.canForce && confirm(e.message + ' Reativar mesmo assim?')) run(re, api('PATCH', '/api/admin/registrations/' + r.id, { status: 'ativa', force: true }), 'Inscrição reativada.').then(applyReg).catch(function () {});
        });
      });
      acts.append(re);
    } else {
      var ca = h('button', { class: 'btn btn-bad', type: 'button' }, 'Cancelar inscrição');
      ca.addEventListener('click', function () { if (confirm('Cancelar a inscrição ' + r.protocol + '? As vagas voltam a ficar livres.')) run(ca, api('PATCH', '/api/admin/registrations/' + r.id, { status: 'cancelada' }), 'Inscrição cancelada.').then(applyReg).catch(function () {}); });
      acts.append(ca);
    }
    var del = h('button', { class: 'btn btn-bad', type: 'button' }, 'Excluir definitivamente');
    del.addEventListener('click', function () {
      var typed = prompt('Isso apaga os dados para sempre (use só para pedidos de exclusão). Para confirmar, digite o protocolo ' + r.protocol + ':');
      if (typed === null) return;
      if (typed.trim().toUpperCase() !== r.protocol) { toast('Protocolo não confere. Nada foi apagado.', true); return; }
      run(del, api('DELETE', '/api/admin/registrations/' + r.id), 'Inscrição excluída.').then(function (d) {
        state.regs = state.regs.filter(function (x) { return x.id !== r.id; }); state.stats = d.stats; render(); dlg.close();
      }).catch(function () {});
    });
    acts.append(del);
    body.append(h('div', { class: 'sect' }, h('h3', null, 'Ações'), h('p', { class: 'hint' }, consent), acts));

    dlg.textContent = ''; dlg.append(body);
  }

  /* ---------- nova inscrição ---------- */
  var newRows = [];
  function newRow(first) {
    var f = { nome: h('input', { maxlength: '100', required: true }), cpf: h('input', { inputmode: 'numeric', maxlength: '14', placeholder: '000.000.000-00' }), idade: h('input', { type: 'number', min: '0', max: '120', required: true }), tel: h('input', { type: 'tel', maxlength: '30', required: true }), igreja: h('input', { maxlength: '100' }), obs: h('input', { maxlength: '200' }) };
    f.cpf.addEventListener('input', function () { f.cpf.value = fmtCpf(f.cpf.value); });
    var box = h('div', { class: 'sect' },
      h('div', { class: 'field' }, h('label', null, 'Nome completo'), f.nome),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'CPF (opcional)'), f.cpf), h('div', { class: 'field' }, h('label', null, 'Idade'), f.idade)),
      h('div', { class: 'field' }, h('label', null, 'WhatsApp (com DDD)'), f.tel),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', null, 'Igreja / grupo'), f.igreja), h('div', { class: 'field' }, h('label', null, 'Alergias / observações'), f.obs)),
      first ? null : h('button', { class: 'btn btn-bad btn-sm', type: 'button', onclick: function () { box.remove(); newRows = newRows.filter(function (x) { return x !== f; }); updateNewAmount(); } }, 'Remover'));
    f.box = box; newRows.push(f); $('#newPeople').append(box); updateNewAmount();
  }
  function updateNewAmount() { if (state.settings) $('#newPayAmount').value = (newRows.length * state.settings.price).toFixed(2); }
  /* Pix e cartão: pagamento único no valor total (valor travado); crediário: valor livre */
  function syncNewPay() {
    var plan = $('#newPlan').value, single = plan === 'pix' || plan === 'cartao';
    $('#newPayAmount').readOnly = single;
    if (single) updateNewAmount();
    if (plan === 'cartao') $('#newPayMethod').value = 'Cartão'; else if (plan === 'pix') $('#newPayMethod').value = 'Pix';
  }
  $('#newPlan').addEventListener('change', syncNewPay);
  function openNew() {
    newRows = []; $('#newPeople').textContent = ''; $('#newErr').textContent = ''; $('#newNote').value = ''; $('#newPaidNow').checked = false; $('#newPayBox').hidden = true; $('#newAcc').value = 'sim';
    var ms = $('#newPayMethod'); ms.textContent = ''; METHODS.forEach(function (m) { ms.append(h('option', { value: m }, m)); });
    $('#newPlan').value = ''; $('#newPayAmount').readOnly = false;
    newRow(true); $('#dlgNew').showModal();
  }
  $('#btnNew').addEventListener('click', openNew);
  $('#newAdd').addEventListener('click', function () { newRow(false); });
  $('#newPaidNow').addEventListener('change', function (e) { $('#newPayBox').hidden = !e.target.checked; });
  $('#newForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    var payload = { participants: newRows.map(function (f) { return { nome: f.nome.value, cpf: f.cpf.value, idade: f.idade.value, tel: f.tel.value, igreja: f.igreja.value, obs: f.obs.value }; }), accompanied: $('#newAcc').value, payPlan: $('#newPlan').value, adminNote: $('#newNote').value };
    if ($('#newPaidNow').checked) payload.payment = { amount: $('#newPayAmount').value, method: $('#newPayMethod').value, date: today() };
    if (payload.payment && !payload.payPlan) { $('#newErr').textContent = 'Escolha a forma de pagamento para registrar o pagamento agora.'; return; }
    var send = function (extra) { return api('POST', '/api/admin/registrations', Object.assign({}, payload, extra || {})); };
    $('#newErr').textContent = '';
    run(btn, send(), 'Inscrição criada.').then(function (d) { $('#dlgNew').close(); applyReg(d); openDetail(d.registration.id); }).catch(function (err) {
      if (err.data && err.data.canForce && confirm(err.message + ' Registrar mesmo assim?')) {
        run(btn, send({ force: true }), 'Inscrição criada.').then(function (d) { $('#dlgNew').close(); applyReg(d); openDetail(d.registration.id); }).catch(function (e2) { $('#newErr').textContent = e2.message; });
      } else $('#newErr').textContent = err.message;
    });
  });

  /* ---------- configurações ---------- */
  $('#btnSettings').addEventListener('click', function () {
    var s = state.settings; $('#setErr').textContent = '';
    $('#setCap').value = s.capacity; $('#setPrice').value = s.price; $('#setAgeMin').value = s.ageMin; $('#setAgeMax').value = s.ageMax; $('#setPending').checked = !!s.countPending; $('#setOpen').checked = !!s.open; $('#setSelf').checked = !!s.selfCheckin;
    $('#dlgSettings').showModal();
  });
  $('#setForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('button[type=submit]');
    run(btn, api('PUT', '/api/admin/settings', { capacity: $('#setCap').value, price: $('#setPrice').value, ageMin: $('#setAgeMin').value, ageMax: $('#setAgeMax').value, countPending: $('#setPending').checked, open: $('#setOpen').checked, selfCheckin: $('#setSelf').checked }), 'Configurações salvas.')
      .then(function (d) { state.settings = d.settings; state.stats = d.stats; render(); $('#dlgSettings').close(); })
      .catch(function (err) { $('#setErr').textContent = err.message; });
  });

  /* ---------- lista de presença (impressão) ---------- */
  $('#btnPrint').addEventListener('click', function () {
    var rows = [];
    state.regs.forEach(function (r) { if (r.status !== 'cancelada') r.participants.forEach(function (p) { rows.push({ p: p, r: r }); }); });
    /* A lista de presença SEMPRE sai em ordem alfabética (pt-BR: ignora acento e maiúscula/minúscula). */
    var abc = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
    rows.sort(function (a, b) { return abc.compare(a.p.nome.trim(), b.p.nome.trim()) || (a.r.protocol < b.r.protocol ? -1 : 1); });
    var sheet = $('#printSheet'); sheet.textContent = '';
    sheet.append(h('h1', null, 'CONECTAcamp — Lista de presença'), h('p', null, rows.length + ' participantes · gerada em ' + dt(new Date().toISOString())),
      h('table', null,
        h('thead', null, h('tr', null, ['#', 'Nome', 'Idade', 'WhatsApp', 'Igreja', 'Pagamento', 'Alergias/obs.', 'Presença'].map(function (t) { return h('th', null, t); }))),
        h('tbody', null, rows.map(function (x, i) {
          return h('tr', null, h('td', null, i + 1), h('td', null, x.p.nome), h('td', null, x.p.idade), h('td', null, x.p.tel), h('td', null, x.p.igreja || ''), h('td', null, LABEL[x.r.paymentStatus]), h('td', null, x.p.obs || ''), h('td', { class: 'chk' }, x.p.checkin ? '✔ ' + hhmm(x.p.checkin.at) : '☐'));
        }))));
    window.print();
  });

  /* ---------- validar voucher (chegada ao acampamento) ---------- */
  var ck = { matches: [], justIn: null };
  var ckOut = $('#ckOut'), ckErr = $('#ckErr'), ckQ = $('#ckQ');

  /* registra (ou desfaz) a entrada de uma pessoa; usado aqui e nos detalhes da inscrição */
  function checkin(p, opts, btn) {
    opts = opts || {};
    if (btn) btn.disabled = true;
    return api('POST', '/api/admin/vouchers/checkin', { participantId: p.id, undo: !!opts.undo, force: !!opts.force })
      .then(function (d) {
        toast(opts.undo ? 'Entrada desfeita: ' + p.nome : 'Entrada registrada: ' + p.nome);
        ck.justIn = opts.undo ? null : p.id;
        applyReg(d);
        if ($('#dlgCheck').open) { renderCheck(); ckQ.value = ''; ckQ.focus(); }
      })
      .catch(function (e) {
        if (e.data && e.data.canForce && !opts.force) {
          if (confirm(e.message + '\n\nLiberar a entrada de ' + p.nome + ' mesmo assim?')) return checkin(p, { force: true }, btn);
          return;
        }
        toast(e.message, true);
        if (e.data && e.data.already) load().then(function () { if ($('#dlgCheck').open) renderCheck(); }).catch(function () {});
      })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function mergeReg(reg) {
    var i = state.regs.findIndex(function (x) { return x.id === reg.id; });
    if (i >= 0) state.regs[i] = reg; else state.regs.unshift(reg);
  }
  function ckState(r, p) {
    if (r.status === 'cancelada') return 'cancelled';
    if (p.checkin) return 'in';
    return r.paymentStatus === 'pago' ? 'ok' : 'pending';
  }
  function renderCheck() {
    var s = state.stats;
    $('#ckCount').textContent = s ? 'Presentes: ' + s.checkedIn + ' · Confirmados esperados: ' + s.expected : '';
    ckOut.textContent = '';
    ck.matches.forEach(function (m) {
      var r = state.regs.find(function (x) { return x.id === m.regId; });
      var p = r && r.participants.find(function (x) { return x.id === m.pid; });
      if (!p) return;
      var st = ckState(r, p), fresh = st === 'in' && ck.justIn === p.id;
      var band = fresh ? '✓ ENTRADA REGISTRADA' : { ok: 'LIBERADO', pending: 'PAGAMENTO PENDENTE', in: 'ENTRADA JÁ REGISTRADA', cancelled: 'INSCRIÇÃO CANCELADA' }[st];
      var card = h('article', { class: 'ck-card ck-' + st + (fresh ? ' fresh' : '') });
      card.append(h('div', { class: 'ck-band' }, band, st === 'in' && !fresh ? h('small', null, 'em ' + dt(p.checkin.at)) : null));
      var body = h('div', { class: 'ck-body' });
      body.append(
        h('h3', null, p.nome, p.idade < 18 ? h('span', { class: 'tagm' }, 'menor') : null),
        h('p', { class: 'ck-line' }, p.idade + ' anos' + (p.igreja ? ' · ' + p.igreja : '')),
        h('p', { class: 'ck-line' }, 'CPF: ' + (p.cpf ? fmtCpf(p.cpf) : 'não informado') + ' · Voucher: ' + (p.voucher || '—')),
        h('p', { class: 'ck-line' }, r.protocol + ' · pago ' + brl(r.paid) + ' de ' + brl(r.amount) + (r.payPlan ? ' · ' + PLAN_NAMES[r.payPlan] : '')));
      if (p.idade < 18 && st !== 'cancelled') {
        body.append(h('p', { class: 'ck-warn' }, r.accompanied === 'sim' ? 'Menor de 18 anos: vem com o responsável.' : (r.authReceived ? 'Menor de 18 anos: autorização assinada já recebida.' : 'Menor de 18 anos: conferir a autorização assinada (ainda NÃO marcada como recebida).')));
      }
      var acts = h('div', { class: 'actions' });
      if (st === 'ok') acts.append(h('button', { class: 'btn btn-o ck-main', type: 'button', onclick: function (e) { checkin(p, {}, e.currentTarget); } }, 'Registrar entrada'));
      if (st === 'pending') acts.append(h('button', { class: 'btn btn-w ck-main', type: 'button', onclick: function (e) { checkin(p, {}, e.currentTarget); } }, 'Liberar mesmo assim'));
      if (st === 'in') acts.append(h('button', { class: 'btn btn-w', type: 'button', onclick: function (e) { checkin(p, { undo: true }, e.currentTarget); } }, 'Desfazer entrada'));
      acts.append(h('button', { class: 'btn btn-w', type: 'button', onclick: function () { openDetail(r.id); } }, 'Abrir inscrição'));
      body.append(acts);
      card.append(body);
      ckOut.append(card);
    });
  }
  function ckSearch(q) {
    q = String(q || '').trim(); ckErr.textContent = ''; ck.justIn = null;
    if (!q) { ck.matches = []; renderCheck(); return Promise.resolve(); }
    var m = q.match(/[?&]v=([^&#\s]+)/);          /* o QR traz o endereço completo: fica só o código */
    if (m) { try { q = decodeURIComponent(m[1]); } catch (e) { q = m[1]; } }
    ckQ.value = q;
    var btn = $('#ckGo'); btn.disabled = true;
    return api('POST', '/api/admin/vouchers/find', { q: q }).then(function (d) {
      state.stats = d.stats; d.matches.forEach(function (x) { mergeReg(x.registration); });
      ck.matches = d.matches.map(function (x) { return { regId: x.registration.id, pid: x.participantId }; });
      render(); renderCheck();
      if (!ck.matches.length) ckErr.textContent = 'Nenhum voucher encontrado para “' + q + '”. Confira o código ou tente pelo CPF ou pelo nome.';
      else { var b = ckOut.querySelector('.ck-main'); if (b) b.focus(); }
    }).catch(function (e) { ckErr.textContent = e.message; }).then(function () { btn.disabled = false; });
  }
  function openCheck() {
    ck.matches = []; ck.justIn = null; ckErr.textContent = ''; ckQ.value = ''; renderCheck();
    var d = $('#dlgCheck'); if (!d.open) d.showModal();
    ckQ.focus();
  }
  $('#btnCheck').addEventListener('click', openCheck);
  $('#ckForm').addEventListener('submit', function (e) { e.preventDefault(); ckSearch(ckQ.value); });
  ckQ.addEventListener('input', function () { if (/^[\d.\-\s]+$/.test(ckQ.value)) ckQ.value = fmtCpf(ckQ.value); });

  /* câmera: lê o QR aqui mesmo, no computador (webcam) ou no celular.
     Usa o leitor do próprio navegador (BarcodeDetector) quando existe; senão, a biblioteca jsQR
     (admin/vendor/jsqr.js), carregada só na primeira vez que alguém abre a câmera. */
  var cam = { stream: null, timer: null, gen: 0 };
  function camStop() {
    cam.gen++;                                   /* cancela uma abertura que ainda esteja esperando a permissão */
    if (cam.timer) clearInterval(cam.timer); cam.timer = null;
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null; $('#ckCam').hidden = true; $('#ckVideo').srcObject = null;
  }
  var jsqrLoading = null;
  function loadJsQR() {
    if (typeof window.jsQR === 'function') return Promise.resolve();
    if (!jsqrLoading) jsqrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = 'vendor/jsqr.js';
      s.onload = function () { if (typeof window.jsQR === 'function') resolve(); else { jsqrLoading = null; reject(new Error('jsqr')); } };
      s.onerror = function () { jsqrLoading = null; reject(new Error('jsqr')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }
  function startScan(det, gen) {
    var v = $('#ckVideo'), cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true }), busy = false;
    cam.timer = setInterval(function () {
      if (busy || gen !== cam.gen || !v.videoWidth) return;
      busy = true;
      var found = function (raw) { busy = false; if (raw && gen === cam.gen) { camStop(); ckSearch(raw); } };
      if (det) { det.detect(v).then(function (c) { found(c && c.length ? c[0].rawValue : ''); }).catch(function () { busy = false; }); return; }
      var w = Math.min(640, v.videoWidth), h = Math.max(1, Math.round(v.videoHeight * w / v.videoWidth));
      cv.width = w; cv.height = h; g.drawImage(v, 0, 0, w, h);
      var img = g.getImageData(0, 0, w, h), c = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      found(c && c.data);
    }, 250);
  }
  $('#ckScan').addEventListener('click', function () {
    ckErr.textContent = '';
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) { ckErr.textContent = 'A câmera só funciona em endereço seguro (https:// ou localhost). Neste endereço, use a câmera do celular ou digite o código.'; return; }
    camStop();
    var det = null;
    if ('BarcodeDetector' in window) { try { det = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { det = null; } }
    var gen = cam.gen;
    (det ? Promise.resolve() : loadJsQR())
      .then(function () { return md.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); })
      .then(function (stream) {
        if (gen !== cam.gen) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }   /* fechou enquanto esperava a permissão */
        cam.stream = stream; var v = $('#ckVideo'); v.srcObject = stream; $('#ckCam').hidden = false;
        return v.play().then(function () { startScan(det, gen); });
      })
      .catch(function (e) {
        camStop();
        var n = e && e.name, m = e && e.message;
        ckErr.textContent = m === 'jsqr' ? 'Não foi possível carregar o leitor de QR. Recarregue a página e tente de novo.'
          : (n === 'NotFoundError' || n === 'OverconstrainedError') ? 'Nenhuma câmera encontrada neste aparelho. Digite o código ou use a câmera do celular.'
          : 'Não foi possível abrir a câmera. Permita o acesso à câmera no navegador e tente de novo.';
      });
  });
  $('#ckCamStop').addEventListener('click', camStop);
  $('#dlgCheck').addEventListener('close', camStop);

  /* o QR do voucher abre /admin/?v=CODIGO: depois do login, a pessoa já aparece pronta para validar */
  function consumeDeepLink() {
    var v = null; try { v = new URLSearchParams(location.search).get('v'); } catch (e) { /* sem URLSearchParams */ }
    if (!v) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* sem histórico */ }
    openCheck(); ckSearch(v);
  }

  /* ---------- diálogos ---------- */
  document.addEventListener('click', function (e) {
    var close = e.target.closest && e.target.closest('[data-close]');
    if (close) { var d = close.closest('dialog'); if (d) d.close(); return; }
    if (e.target.tagName === 'DIALOG') e.target.close();
  });

  /* ---------- início ---------- */
  load().catch(function (e) { if (e.status !== 401) { showLogin(); $('#loginErr').textContent = 'Não foi possível carregar: ' + e.message; } });
})();

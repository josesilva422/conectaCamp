/* CONECTAcamp — acesso aos dados (sem dependências)
   Expõe  window.ccFetch(path, init)  com a mesma cara do fetch para os caminhos /api/...:
   - modo "local":    repassa para o servidor Node (node server.js)
   - modo "supabase": traduz cada /api/... para chamadas ao Supabase (REST, funções e login)
   O modo é escolhido em js/config.js. O resto do site e do painel não sabe a diferença. */
(function () {
  'use strict';

  var cfg = (window.CC_CONFIG && window.CC_CONFIG.supabase) || {};
  var host = location.hostname;
  var isLocalHost = location.protocol === 'file:' || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || /\.localhost$/.test(host);
  var forced = ''; try { forced = localStorage.getItem('cc_backend') || ''; } catch (e) { /* sem storage */ }
  var useSb = !!(cfg.url && cfg.key) && forced !== 'local' && (forced === 'supabase' || !isLocalHost);
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;

  window.CCBackend = { mode: useSb ? 'supabase' : 'local', adminEmail: cfg.adminEmail || '' };
  if (!useSb) { window.ccFetch = function (p, i) { return nativeFetch(p, i); }; return; }

  /* ---------------- Supabase ---------------- */
  var BASE = String(cfg.url).replace(/\/+$/, '');
  var KEY = cfg.key;
  var SESSION_KEY = 'cc_sb_session';
  var PLANS = { pix: 1, cartao: 1, crediario: 1 };
  var METHODS = ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'];
  var cache = { regs: [], settings: null };

  function HttpErr(status, message, extra) { var e = new Error(message); e.status = status; e.extra = extra || {}; return e; }
  function respond(status, data) { return new Response(JSON.stringify(data), { status: status, headers: { 'Content-Type': 'application/json; charset=utf-8' } }); }
  function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function round2(n) { return Math.round(n * 100) / 100; }
  function digits(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function plain(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function keyOf(s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function validCpf(d) {
    if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
    for (var t = 9; t < 11; t++) { var s = 0; for (var i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i); if (((s * 10) % 11) % 10 !== Number(d[t])) return false; }
    return true;
  }

  /* ----- sessão do painel (login por e-mail e senha do Supabase) ----- */
  function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function setSession(s) { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* sem storage */ } }
  function keepSession(d) { setSession({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600) }); }
  function headers(token) { var h = { apikey: KEY, 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token; return h; }
  var refreshing = null;
  function adminToken() {
    var s = getSession();
    if (!s || !s.access_token) return Promise.reject(HttpErr(401, 'Faça login para continuar.'));
    if (s.expires_at - 30 > Date.now() / 1000) return Promise.resolve(s.access_token);
    if (!refreshing) {
      refreshing = nativeFetch(BASE + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: s.refresh_token }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d.access_token) throw new Error('refresh'); keepSession(d); return d.access_token; }); })
        .catch(function (e) { if (e && e.message === 'refresh') { setSession(null); throw HttpErr(401, 'Sessão expirada. Entre novamente.'); } throw HttpErr(503, 'Sem conexão com o servidor. Verifique a internet e tente de novo.'); })
        .then(function (t) { refreshing = null; return t; }, function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }

  /* ----- chamadas ao Supabase ----- */
  function toErr(status, d, admin) {
    d = d || {};
    var msg = d.message || d.msg || d.error_description || '';
    var extra = {}; if (d.details) { try { var x = JSON.parse(d.details); if (x && typeof x === 'object') extra = x; } catch (e) { /* detalhe em texto */ } }
    if (/^PT\d{3}$/.test(d.code || '')) return HttpErr(Number(String(d.code).slice(2)), msg, extra);
    if (/^PGRST30[0-9]$/.test(d.code || '') || /JWT/i.test(msg) || status === 401) return HttpErr(admin ? 401 : 401, admin ? 'Sessão expirada. Entre novamente.' : 'Acesso negado.');
    if (status === 403) return HttpErr(403, 'Acesso negado.');
    if (status >= 500) return HttpErr(502, 'O servidor não respondeu direito. Tente de novo em instantes.');
    return HttpErr(status || 500, msg || 'Algo deu errado.');
  }
  function rest(method, path, o) {
    o = o || {};
    return (o.admin ? adminToken() : Promise.resolve(null)).then(function (token) {
      var h = headers(token); if (o.prefer) h.Prefer = o.prefer; if (o.body === undefined) delete h['Content-Type'];
      return nativeFetch(BASE + path, { method: method, headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body), cache: 'no-store', signal: o.signal });
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null; if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
        if (res.ok) return data;
        throw toErr(res.status, data, !!o.admin);
      });
    });
  }
  function rpc(fn, args, admin, signal) { return rest('POST', '/rest/v1/rpc/' + fn, { body: args || {}, admin: admin, signal: signal }); }

  /* ----- formato que o painel já conhece (igual ao do servidor local) ----- */
  function payStatus(r) {
    if (r.status === 'cancelada') return 'cancelado';
    if (r.amount > 0 && r.paid >= r.amount) return 'pago';
    return r.paid > 0 ? 'parcial' : 'pendente';
  }
  function toView(row) {
    var parts = (row.participants || []).slice().sort(function (a, b) { return a.position - b.position; }).map(function (p) {
      return { id: p.id, nome: p.nome, idade: p.idade, tel: p.tel, igreja: p.igreja || '', obs: p.obs || '', cpf: p.cpf || '', voucher: p.voucher,
        checkin: p.checkin_at ? { at: p.checkin_at, unpaid: !!p.checkin_unpaid, self: !!p.checkin_self } : null };
    });
    var pays = (row.payments || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).map(function (y) {
      return { id: y.id, amount: Number(y.amount), method: y.method, date: y.paid_on, note: y.note || '', createdAt: y.created_at };
    });
    var v = { id: row.id, protocol: row.protocol, createdAt: row.created_at, updatedAt: row.updated_at, source: row.source, participants: parts, accompanied: row.accompanied || '',
      authAck: !!row.auth_ack, authReceived: !!row.auth_received, payPlan: row.pay_plan || '', consent: { data: true, image: true, at: row.consent_at || row.created_at, byAdmin: !!row.consent_by_admin },
      amount: Number(row.amount), payments: pays, status: row.status, adminNote: row.admin_note || '' };
    v.paid = round2(pays.reduce(function (s, y) { return s + y.amount; }, 0));
    v.paymentStatus = payStatus(v);
    return v;
  }
  function settingsView(s) {
    s = s || {};
    return { capacity: s.capacity, price: Number(s.price), ageMin: s.age_min, ageMax: s.age_max, countPending: !!s.count_pending, open: !!s.open, selfCheckin: !!s.self_checkin };
  }
  function stats() {
    var s = cache.settings || {};
    var out = { capacity: s.capacity, price: s.price, ageMin: s.ageMin, ageMax: s.ageMax, open: !!s.open, registrations: 0, participants: 0, pago: 0, parcial: 0, pendente: 0, cancelado: 0, received: 0, toReceive: 0, minors: 0, authPending: 0, expected: 0, checkedIn: 0, taken: 0 };
    cache.regs.forEach(function (r) {
      out[r.paymentStatus] += 1;
      if (r.status === 'cancelada') return;
      var n = r.participants.length;
      out.registrations += 1; out.participants += n;
      if (s.countPending || r.paid > 0) out.taken += n;
      if (r.paymentStatus === 'pago') out.expected += n;
      out.checkedIn += r.participants.filter(function (p) { return p.checkin; }).length;
      out.received += r.paid; out.toReceive += Math.max(0, r.amount - r.paid);
      var minors = r.participants.filter(function (p) { return p.idade < 18; }).length;
      out.minors += minors;
      if (minors && r.accompanied === 'nao' && !r.authReceived) out.authPending += 1;
    });
    out.remaining = Math.max(0, (s.capacity || 0) - out.taken);
    out.received = round2(out.received); out.toReceive = round2(out.toReceive);
    return out;
  }
  var SELECT = 'select=*,participants(*),payments(*)';
  function loadAll() {
    return Promise.all([
      rest('GET', '/rest/v1/registrations?' + SELECT + '&order=created_at.desc', { admin: true }),
      rest('GET', '/rest/v1/settings?select=*&id=eq.1', { admin: true })
    ]).then(function (x) { cache.regs = (x[0] || []).map(toView); cache.settings = settingsView((x[1] || [])[0]); return cache; });
  }
  function loadOne(id) {
    return rest('GET', '/rest/v1/registrations?' + SELECT + '&id=eq.' + encodeURIComponent(id), { admin: true }).then(function (rows) {
      if (!rows || !rows.length) throw HttpErr(404, 'Inscrição não encontrada.');
      var v = toView(rows[0]), i = cache.regs.findIndex(function (x) { return x.id === v.id; });
      if (i >= 0) cache.regs[i] = v; else cache.regs.unshift(v);
      return v;
    });
  }
  function withStats(extra) {
    return (cache.settings ? Promise.resolve() : loadAll()).then(function () { return Object.assign({ stats: stats() }, extra); });
  }

  /* ----- validação dos dados de um participante editado no painel (igual ao servidor local) ----- */
  function parseParticipant(p) {
    var nome = clean(p.nome, 100), idade = parseInt(p.idade, 10), tel = clean(p.tel, 30), cpf = digits(p.cpf);
    if (nome.split(' ').filter(Boolean).length < 2) throw HttpErr(400, 'Informe nome e sobrenome de cada participante.');
    if (!(idade >= 0 && idade <= 120)) throw HttpErr(400, 'Idade inválida para ' + nome + '.');
    if (digits(tel).length < 10) throw HttpErr(400, 'Informe um WhatsApp com DDD para ' + nome + '.');
    if (cpf && !validCpf(cpf)) throw HttpErr(400, 'CPF inválido para ' + nome + '.');
    return { nome: nome, idade: idade, tel: tel, igreja: clean(p.igreja, 100), obs: clean(p.obs, 200), cpf: cpf };
  }

  /* ----- busca para validar o voucher (mesma lógica do servidor local) ----- */
  function findLocal(q) {
    var raw = String(q == null ? '' : q).trim().slice(0, 80), dig = digits(raw), key = keyOf(raw), out = [];
    cache.regs.forEach(function (r) {
      r.participants.forEach(function (p) {
        var hit = false;
        if (/^[\d.\-\s]+$/.test(raw) && dig.length === 11) hit = !!p.cpf && p.cpf === dig;
        else if (key.length === 11 && key.indexOf('CCV') === 0) hit = keyOf(p.voucher) === key;
        else if (key.length === 8 && key.indexOf('CC') === 0) hit = keyOf(r.protocol) === key;
        if (hit) out.push({ reg: r, p: p });
      });
    });
    if (out.length && /^[\d.\-\s]+$/.test(raw) && dig.length === 11) {
      var live = out.filter(function (x) { return x.reg.status !== 'cancelada'; });
      if (live.length) out = live;
    }
    if (!out.length && plain(raw).length >= 3) {
      var words = plain(raw).split(/\s+/).filter(Boolean);
      cache.regs.forEach(function (r) { r.participants.forEach(function (p) { var nm = plain(p.nome); if (words.every(function (w) { return nm.indexOf(w) >= 0; })) out.push({ reg: r, p: p }); }); });
    }
    return out.slice(0, 20);
  }

  /* ----- exportar CSV (igual ao do servidor local) ----- */
  var PLAN_NAMES = { pix: 'Pix', cartao: 'Cartão de crédito', crediario: 'Crediário' };
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv() {
    var rows = [['Protocolo', 'Data da inscrição', 'Situação', 'Forma de pagamento', 'Participante', 'CPF', 'Idade', 'WhatsApp', 'Igreja/grupo', 'Alergias/observações', 'Menores: responsável', 'Autorização recebida', 'Valor da inscrição (R$)', 'Pago (R$)', 'Observação do organizador', 'Código do voucher', 'Entrada registrada em']];
    cache.regs.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; }).forEach(function (r) {
      r.participants.forEach(function (p, i) {
        rows.push([r.protocol, String(r.createdAt).slice(0, 10), r.paymentStatus, PLAN_NAMES[r.payPlan] || '', p.nome, p.cpf ? p.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '', p.idade, p.tel, p.igreja, p.obs,
          p.idade < 18 ? (r.accompanied === 'sim' ? 'com responsável' : 'sem responsável') : '', p.idade < 18 && r.accompanied === 'nao' ? (r.authReceived ? 'sim' : 'não') : '',
          i === 0 ? r.amount.toFixed(2).replace('.', ',') : '', i === 0 ? r.paid.toFixed(2).replace('.', ',') : '', i === 0 ? r.adminNote : '', p.voucher || '', p.checkin ? p.checkin.at : '']);
      });
    });
    return '﻿' + rows.map(function (row) { return row.map(csvCell).join(';'); }).join('\r\n') + '\r\n';
  }
  window.CCBackend.downloadCsv = function () {
    return loadAll().then(function () {
      var blob = new Blob([exportCsv()], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'conectacamp-inscricoes-' + today() + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  };

  /* ----- rotas ----- */
  function patchRegistration(id, b) {
    var chain = Promise.resolve(), upd = {};
    if (typeof b.adminNote === 'string') upd.admin_note = clean(b.adminNote, 2000);
    if (typeof b.authReceived === 'boolean') upd.auth_received = b.authReceived;
    if (typeof b.payPlan === 'string') {
      if (b.payPlan !== '' && !PLANS[b.payPlan]) throw HttpErr(400, 'Forma de pagamento inválida.');
      upd.pay_plan = b.payPlan;
    }
    if (Object.keys(upd).length) chain = chain.then(function () { return rest('PATCH', '/rest/v1/registrations?id=eq.' + id, { admin: true, body: upd, prefer: 'return=minimal' }); });
    if (b.status === 'cancelada' || b.status === 'ativa') chain = chain.then(function () { return rpc('camp_admin_set_status', { p_id: id, p_status: b.status, p_force: !!b.force }, true); });
    if (Array.isArray(b.participants)) {
      chain = chain.then(function () { return loadOne(id); }).then(function (cur) {
        var ops = [];
        b.participants.forEach(function (e) {
          var t = cur.participants.find(function (x) { return x.id === e.id; });
          if (!t) return;
          ops.push({ id: t.id, body: parseParticipant(Object.assign({}, t, e)) });
        });
        return ops.reduce(function (pr, o) { return pr.then(function () { return rest('PATCH', '/rest/v1/participants?id=eq.' + o.id, { admin: true, body: o.body, prefer: 'return=minimal' }); }); }, Promise.resolve());
      });
    }
    return chain.then(function () { return loadOne(id); }).then(function (v) { return withStats({ ok: true, registration: v }); }).then(function (d) { return { status: 200, data: d }; });
  }

  function findRegOfParticipant(pid) {
    var r = cache.regs.find(function (x) { return x.participants.some(function (p) { return p.id === pid; }); });
    return r ? Promise.resolve(r) : loadAll().then(function () {
      var r2 = cache.regs.find(function (x) { return x.participants.some(function (p) { return p.id === pid; }); });
      if (!r2) throw HttpErr(404, 'Participante não encontrado.');
      return r2;
    });
  }

  function route(m, p, b, signal) {
    /* --- público --- */
    if (p === '/api/status' && m === 'GET') return rpc('camp_status', {}, false, signal).then(function (d) { return { status: 200, data: d }; });
    if (p === '/api/registrations' && m === 'POST') return rpc('camp_register', { payload: b }).then(function (d) { return { status: 201, data: d }; });
    if (p === '/api/voucher' && m === 'POST') {
      return rpc('camp_voucher_lookup', { q: b.q == null ? '' : String(b.q) }).then(function (d) {
        if (!d || !d.found) throw HttpErr(404, 'Não encontramos uma inscrição com esses dados. Confira o CPF ou o código e tente de novo.');
        delete d.found; return { status: 200, data: d };
      });
    }
    if (p === '/api/voucher/checkin' && m === 'POST') {
      return rpc('camp_voucher_checkin', { p_code: b.code == null ? '' : String(b.code) }).then(function (d) {
        if (d && d.found === false) throw HttpErr(404, 'Voucher não encontrado.');
        return { status: 200, data: d };
      });
    }

    /* --- painel --- */
    if (p === '/api/admin/login' && m === 'POST') {
      var email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
      if (!email || !password) throw HttpErr(401, 'Informe o e-mail e a senha.');
      return nativeFetch(BASE + '/auth/v1/token?grant_type=password', { method: 'POST', headers: headers(), body: JSON.stringify({ email: email, password: password }) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { r: r, d: d }; }); })
        .then(function (o) {
          if (o.r.status === 429) throw HttpErr(429, 'Muitas tentativas. Aguarde um pouco e tente de novo.');
          if (!o.r.ok || !o.d.access_token) throw HttpErr(401, 'E-mail ou senha incorretos.');
          keepSession(o.d);
          return rpc('is_admin', {}, true).then(function (ok) {
            if (ok !== true) { setSession(null); throw HttpErr(403, 'Este usuário não tem acesso ao painel.'); }
            return { status: 200, data: { ok: true } };
          });
        });
    }
    if (p === '/api/admin/logout' && m === 'POST') {
      var s = getSession(); setSession(null); cache = { regs: [], settings: null };
      if (s && s.access_token) nativeFetch(BASE + '/auth/v1/logout', { method: 'POST', headers: headers(s.access_token) }).catch(function () { /* sem rede: a sessão local já foi apagada */ });
      return Promise.resolve({ status: 200, data: { ok: true } });
    }
    if (p === '/api/admin/data' && m === 'GET') {
      return loadAll().then(function () {
        return { status: 200, data: { stats: stats(), registrations: cache.regs.slice().sort(function (a, c) { return a.createdAt < c.createdAt ? 1 : -1; }), settings: cache.settings } };
      });
    }
    if (p === '/api/admin/settings' && m === 'PUT') {
      var int = function (v, lo, hi, label) { var n = parseInt(v, 10); if (!(n >= lo && n <= hi)) throw HttpErr(400, label + ' inválido.'); return n; };
      var upd = { capacity: int(b.capacity, 1, 10000, 'Número de vagas'), age_min: int(b.ageMin, 0, 99, 'Idade mínima') };
      upd.age_max = int(b.ageMax, upd.age_min, 120, 'Idade máxima');
      var price = round2(Number(b.price)); if (!(price >= 0 && price <= 100000)) throw HttpErr(400, 'Valor inválido.');
      upd.price = price; upd.count_pending = !!b.countPending; upd.open = !!b.open;
      if (typeof b.selfCheckin === 'boolean') upd.self_checkin = b.selfCheckin;
      return rest('PATCH', '/rest/v1/settings?id=eq.1', { admin: true, body: upd, prefer: 'return=representation' }).then(function (rows) {
        cache.settings = settingsView((rows || [])[0]);
        return loadAll().then(function () { return { status: 200, data: { ok: true, settings: cache.settings, stats: stats() } }; });
      });
    }
    if (p === '/api/admin/registrations' && m === 'POST') {
      return rpc('camp_admin_create', { payload: b }, true).then(function (d) {
        return loadOne(d.id).then(function (v) { return withStats({ ok: true, registration: v }); });
      }).then(function (d) { return { status: 201, data: d }; });
    }
    var mm = p.match(/^\/api\/admin\/registrations\/([0-9a-f-]{36})(?:\/payments(?:\/([0-9a-f-]{36}))?)?$/);
    if (mm) {
      var id = mm[1], isPay = p.indexOf('/payments') > 0;
      if (!isPay && m === 'PATCH') return patchRegistration(id, b);
      if (!isPay && m === 'DELETE') {
        return rest('DELETE', '/rest/v1/registrations?id=eq.' + id, { admin: true, prefer: 'return=representation' }).then(function (rows) {
          if (!rows || !rows.length) throw HttpErr(404, 'Inscrição não encontrada.');
          cache.regs = cache.regs.filter(function (x) { return x.id !== id; });
          return withStats({ ok: true });
        }).then(function (d) { return { status: 200, data: d }; });
      }
      if (isPay && !mm[2] && m === 'POST') {
        var cur = cache.regs.find(function (x) { return x.id === id; });
        var amount = round2(Number(b.amount != null ? b.amount : (cur ? Math.max(0, cur.amount - cur.paid) : 0)));
        if (!(amount > 0) || amount > 100000) throw HttpErr(400, 'Informe um valor de pagamento válido.');
        var body = { registration_id: id, amount: amount, method: METHODS.indexOf(b.method) >= 0 ? b.method : 'Pix', paid_on: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? b.date : today(), note: clean(b.note, 200) };
        return rest('POST', '/rest/v1/payments', { admin: true, body: body, prefer: 'return=minimal' })
          .then(function () { return loadOne(id); }).then(function (v) { return withStats({ ok: true, registration: v }); })
          .then(function (d) { return { status: 201, data: d }; });
      }
      if (isPay && mm[2] && m === 'DELETE') {
        return rest('DELETE', '/rest/v1/payments?id=eq.' + mm[2] + '&registration_id=eq.' + id, { admin: true, prefer: 'return=representation' }).then(function (rows) {
          if (!rows || !rows.length) throw HttpErr(404, 'Pagamento não encontrado.');
          return loadOne(id);
        }).then(function (v) { return withStats({ ok: true, registration: v }); }).then(function (d) { return { status: 200, data: d }; });
      }
    }
    if (p === '/api/admin/vouchers/find' && m === 'POST') {
      return loadAll().then(function () {
        var found = findLocal(b.q);
        return { status: 200, data: { ok: true, matches: found.map(function (x) { return { registration: x.reg, participantId: x.p.id }; }), stats: stats() } };
      });
    }
    if (p === '/api/admin/vouchers/checkin' && m === 'POST') {
      var pid = String(b.participantId || '');
      return rpc('camp_admin_checkin', { p_id: pid, p_undo: b.undo === true, p_force: b.force === true }, true)
        .then(function () { return findRegOfParticipant(pid); })
        .then(function (r) { return loadOne(r.id); })
        .then(function (v) { return withStats({ ok: true, registration: v, participantId: pid }); })
        .then(function (d) { return { status: 200, data: d }; });
    }
    throw HttpErr(404, 'Não encontrado.');
  }

  window.ccFetch = function (path, init) {
    init = init || {};
    var u; try { u = new URL(path, location.href); } catch (e) { return nativeFetch(path, init); }
    if (u.pathname.indexOf('/api/') !== 0) return nativeFetch(path, init);
    var m = String(init.method || 'GET').toUpperCase(), b = {};
    if (typeof init.body === 'string' && init.body) { try { b = JSON.parse(init.body) || {}; } catch (e) { return Promise.resolve(respond(400, { error: 'JSON inválido.' })); } }
    return Promise.resolve().then(function () { return route(m, u.pathname, b, init.signal); })
      .then(function (r) { return respond(r.status, r.data); })
      .catch(function (e) {
        if (!e || !e.status) return respond(503, { error: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' });
        return respond(e.status, Object.assign({ error: e.message }, e.extra || {}));
      });
  };
})();

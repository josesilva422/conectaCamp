'use strict';
/* ============================================================
   CONECTAcamp — servidor (Node 20+, sem dependências)
   - Serve o site (index.html, css, js, img)
   - API pública: /api/status (vagas) e /api/registrations (inscrição)
   - Painel do organizador em /admin/ (protegido por senha)
   - Dados em ./data (registrations.json, settings.json, backups/)
   Uso:  node server.js        (veja o README para variáveis de ambiente)
   ============================================================ */
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3002;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const RATE_OFF = process.env.DISABLE_RATE_LIMIT === '1';
const SESSION_HOURS = 12;

const FILES = {
  regs: path.join(DATA_DIR, 'registrations.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  secret: path.join(DATA_DIR, 'secret.key'),
  password: path.join(DATA_DIR, 'admin-password.txt'),
  backups: path.join(DATA_DIR, 'backups')
};
/* selfCheckin: no dia do acampamento, quem está confirmado "destaca" o voucher no próprio celular e a entrada é registrada */
const DEFAULTS = { capacity: 100, price: 150, ageMin: 15, ageMax: 25, countPending: true, open: true, selfCheckin: false };
const PAY_METHODS = ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'];
/* Forma de pagamento ESCOLHIDA pela inscrição: Pix e cartão = um único pagamento; crediário = várias parcelas */
const PAY_PLANS = { pix: 'Pix', cartao: 'Cartão de crédito', crediario: 'Crediário' };
const isPlan = function (v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAY_PLANS, v); };

let regs = [];
let settings = { ...DEFAULTS };
let secret = '';
let adminPassword = '';
let passwordWasGenerated = false;

/* ---------- utilidades ---------- */
function httpErr(status, message, extra) { const e = new Error(message); e.status = status; e.extra = extra; return e; }
function clean(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function nowIso() { return new Date().toISOString(); }
function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = ''; for (const b of crypto.randomBytes(14)) out += alphabet[b % alphabet.length];
  return out;
}
function send(res, status, body, headers) {
  if (res.headersSent) return;
  res.writeHead(status, headers || {});
  res.end(body);
}
function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
}
async function readJson(req, limit) {
  const ct = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (ct !== 'application/json') throw httpErr(415, 'Envie os dados em JSON.');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > (limit || 64 * 1024)) throw httpErr(413, 'Dados grandes demais.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { throw httpErr(400, 'JSON inválido.'); }
}
function clientIp(req) {
  if (TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || 'unknown';
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(function (p) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const hits = new Map();
function rate(ip, key, max, windowMs) {
  if (RATE_OFF) return;
  const k = key + ':' + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter(function (t) { return now - t < windowMs; });
  if (arr.length >= max) throw httpErr(429, 'Muitas tentativas. Aguarde um pouco e tente de novo.');
  arr.push(now); hits.set(k, arr);
}
setInterval(function () { const now = Date.now(); for (const [k, v] of hits) if (!v.some(function (t) { return now - t < 3600e3; })) hits.delete(k); }, 600e3).unref();

/* ---------- armazenamento (arquivo JSON, gravação atômica) ---------- */
let writeQueue = Promise.resolve();
function writeAtomic(file, data) {
  writeQueue = writeQueue.then(async function () {
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
  }).catch(function (e) { console.error('Erro ao salvar', file, e); });
  return writeQueue;
}
const persistRegs = function () { return writeAtomic(FILES.regs, JSON.stringify({ registrations: regs }, null, 2)); };
const persistSettings = function () { return writeAtomic(FILES.settings, JSON.stringify(settings, null, 2)); };

async function backup() {
  try {
    await fsp.mkdir(FILES.backups, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, '-');
    await fsp.copyFile(FILES.regs, path.join(FILES.backups, 'registrations-' + stamp + '.json'));
    const list = (await fsp.readdir(FILES.backups)).filter(function (f) { return f.startsWith('registrations-'); }).sort();
    for (const old of list.slice(0, Math.max(0, list.length - 30))) await fsp.unlink(path.join(FILES.backups, old));
  } catch (e) { console.error('Backup falhou:', e.message); }
}

async function init() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try { regs = JSON.parse(await fsp.readFile(FILES.regs, 'utf8')).registrations || []; }
  catch (e) { if (e.code !== 'ENOENT') throw e; regs = []; await persistRegs(); }
  if (migrate()) { await backup(); await persistRegs(); }   /* cadastros antigos ganham código de voucher (com cópia de segurança antes) */
  try { settings = Object.assign({}, DEFAULTS, JSON.parse(await fsp.readFile(FILES.settings, 'utf8'))); }
  catch (e) { if (e.code !== 'ENOENT') throw e; await persistSettings(); }
  try { secret = (await fsp.readFile(FILES.secret, 'utf8')).trim(); }
  catch (e) { secret = crypto.randomBytes(32).toString('hex'); await fsp.writeFile(FILES.secret, secret); }
  adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword) {
    try { adminPassword = (await fsp.readFile(FILES.password, 'utf8')).trim(); }
    catch (e) { adminPassword = randomPassword(); await fsp.writeFile(FILES.password, adminPassword + '\n'); passwordWasGenerated = true; }
  }
  await backup();
  setInterval(backup, 6 * 3600e3).unref();
}

/* ---------- regras de negócio ---------- */
const isActive = function (r) { return r.status !== 'cancelada'; };
const paidOf = function (r) { return (r.payments || []).reduce(function (s, p) { return s + (Number(p.amount) || 0); }, 0); };
function payStatus(r) {
  if (!isActive(r)) return 'cancelado';
  const paid = paidOf(r);
  if (r.amount > 0 && paid >= r.amount) return 'pago';
  return paid > 0 ? 'parcial' : 'pendente';
}
function takenSpots() {
  let n = 0;
  for (const r of regs) { if (!isActive(r)) continue; if (settings.countPending || paidOf(r) > 0) n += r.participants.length; }
  return n;
}
function publicStatus() {
  const taken = takenSpots();
  return { capacity: settings.capacity, taken, remaining: Math.max(0, settings.capacity - taken), price: settings.price, ageMin: settings.ageMin, ageMax: settings.ageMax, open: !!settings.open };
}
function view(r) { return Object.assign({}, r, { payPlan: r.payPlan || '', paid: paidOf(r), paymentStatus: payStatus(r) }); }
function stats() {
  const s = publicStatus();
  const out = Object.assign({}, s, { registrations: 0, participants: 0, pago: 0, parcial: 0, pendente: 0, cancelado: 0, received: 0, toReceive: 0, minors: 0, authPending: 0, expected: 0, checkedIn: 0 });
  for (const r of regs) {
    const st = payStatus(r);
    out[st] += 1;
    if (!isActive(r)) continue;
    out.registrations += 1; out.participants += r.participants.length;
    if (st === 'pago') out.expected += r.participants.length;
    out.checkedIn += r.participants.filter(function (p) { return p.checkin; }).length;
    const paid = paidOf(r);
    out.received += paid; out.toReceive += Math.max(0, r.amount - paid);
    const minors = r.participants.filter(function (p) { return p.idade < 18; }).length;
    out.minors += minors;
    if (minors && r.accompanied === 'nao' && !r.authReceived) out.authPending += 1;
  }
  return out;
}
function protocolNew() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = 'CC-'; for (const x of crypto.randomBytes(6)) s += A[x % A.length];
    if (!regs.some(function (r) { return r.protocol === s; })) return s;
  }
}
/* ---------- CPF e voucher ---------- */
const onlyDigits = function (s) { return String(s == null ? '' : s).replace(/\D/g, ''); };
function validCpf(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0; for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}
const maskCpf = function (d) { return d && d.length === 11 ? '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**' : ''; };
const keyOf = function (s) { return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, ''); };
const plain = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
function voucherSet() { const s = new Set(); for (const r of regs) for (const p of r.participants) if (p.voucher) s.add(p.voucher); return s; }
function voucherNew(taken) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let s = ''; for (const x of crypto.randomBytes(8)) s += A[x % A.length];
    const code = 'CCV-' + s.slice(0, 4) + '-' + s.slice(4);
    if (!taken.has(code)) { taken.add(code); return code; }
  }
}
function giveVouchers(list) { const taken = voucherSet(); list.forEach(function (p) { if (!p.voucher) p.voucher = voucherNew(taken); }); return list; }
/* Garante cpf/voucher/entrada em cadastros antigos (feitos antes do voucher existir) */
function migrate() {
  let changed = false;
  const taken = voucherSet();
  for (const r of regs) for (const p of r.participants) {
    if (p.cpf === undefined) { p.cpf = ''; changed = true; }
    if (p.checkin === undefined) { p.checkin = null; changed = true; }
    if (!p.voucher) { p.voucher = voucherNew(taken); changed = true; }
  }
  return changed;
}
/* Um CPF só pode ter uma inscrição ativa (e não pode repetir dentro da mesma inscrição) */
function assertCpfsFree(list, exceptRegId) {
  const seen = new Set();
  for (const p of list) {
    if (!p.cpf) continue;
    if (seen.has(p.cpf)) throw httpErr(400, 'O mesmo CPF foi informado para mais de um participante.');
    seen.add(p.cpf);
    for (const r of regs) {
      if (r.id === exceptRegId || !isActive(r)) continue;
      if (r.participants.some(function (x) { return x.cpf === p.cpf; })) throw httpErr(409, 'Já existe uma inscrição com o CPF de ' + p.nome + '. Use “Minha inscrição” no site para ver o voucher.');
    }
  }
}

function parseParticipant(p, enforceAge, requireCpf) {
  const nome = clean(p && p.nome, 100);
  const idade = Number.parseInt(p && p.idade, 10);
  const tel = clean(p && p.tel, 30);
  const igreja = clean(p && p.igreja, 100);
  const obs = clean(p && p.obs, 200);
  const cpf = onlyDigits(p && p.cpf);
  if (nome.split(' ').filter(Boolean).length < 2) return { error: 'Informe nome e sobrenome de cada participante.' };
  if (!Number.isInteger(idade) || idade < 0 || idade > 120) return { error: 'Idade inválida para ' + nome + '.' };
  if (enforceAge && (idade < settings.ageMin || idade > settings.ageMax)) return { error: 'O CONECTAcamp é para jovens de ' + settings.ageMin + ' a ' + settings.ageMax + ' anos (' + nome + ').' };
  if (tel.replace(/\D/g, '').length < 10) return { error: 'Informe um WhatsApp com DDD para ' + nome + '.' };
  if ((cpf || requireCpf) && !validCpf(cpf)) return { error: (cpf ? 'CPF inválido' : 'Informe o CPF') + ' para ' + nome + '.' };
  return { value: { id: crypto.randomUUID(), nome, idade, tel, igreja, obs, cpf, voucher: '', checkin: null } };
}
function parseParticipants(list, enforceAge, requireCpf) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 20) throw httpErr(400, 'Informe de 1 a 20 participantes.');
  return list.map(function (p) { const r = parseParticipant(p, enforceAge, requireCpf); if (r.error) throw httpErr(400, r.error); return r.value; });
}
function parsePayment(b, fallbackAmount) {
  const amount = Math.round(Number(b && b.amount != null ? b.amount : fallbackAmount) * 100) / 100;
  if (!(amount > 0) || amount > 100000) throw httpErr(400, 'Informe um valor de pagamento válido.');
  const method = PAY_METHODS.includes(b && b.method) ? b.method : 'Pix';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b && b.date)) ? b.date : nowIso().slice(0, 10);
  return { id: crypto.randomUUID(), amount, method, date, note: clean(b && b.note, 200), createdAt: nowIso() };
}

const money = function (n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); };
/* Regras: sem forma escolhida não há pagamento; Pix/cartão = 1 pagamento no valor total; crediário = várias parcelas até quitar */
function assertCanPay(reg, amount) {
  if (!isPlan(reg.payPlan)) throw httpErr(400, 'Escolha a forma de pagamento antes de registrar pagamentos.');
  const paid = paidOf(reg);
  if (reg.payPlan !== 'crediario') {
    if (reg.payments.length >= 1) throw httpErr(409, PAY_PLANS[reg.payPlan] + ' permite um único pagamento, e ele já foi registrado.');
    if (Math.abs(amount - reg.amount) > 0.001) throw httpErr(400, PAY_PLANS[reg.payPlan] + ' é pago de uma vez só: ' + money(reg.amount) + '.');
  } else if (paid + amount > reg.amount + 0.001) {
    throw httpErr(400, 'O pagamento passa do valor da inscrição (falta ' + money(Math.max(0, reg.amount - paid)) + ').');
  }
}

/* ---------- API pública ---------- */
async function handleRegister(req, res, ip) {
  rate(ip, 'reg', 8, 3600e3);
  const b = await readJson(req);
  if (clean(b.hp, 50)) return json(res, 200, { ok: true, protocol: 'CC-000000' }); // campo-isca: robô
  if (!settings.open) throw httpErr(403, 'As inscrições estão fechadas no momento.');
  const participants = parseParticipants(b.participants, true, true);
  assertCpfsFree(participants, null);
  const hasMinor = participants.some(function (p) { return p.idade < 18; });
  let accompanied = '', authAck = false;
  if (hasMinor) {
    accompanied = b.accompanied === 'sim' ? 'sim' : b.accompanied === 'nao' ? 'nao' : '';
    if (!accompanied) throw httpErr(400, 'Informe se os menores de 18 anos vão com o responsável.');
    if (accompanied === 'nao') { if (b.authAck !== true) throw httpErr(400, 'Confirme que levará a autorização assinada dos responsáveis.'); authAck = true; }
  }
  if (b.agree !== true || b.imgAck !== true) throw httpErr(400, 'Aceite as duas confirmações para continuar.');
  if (!isPlan(b.payPlan)) throw httpErr(400, 'Escolha a forma de pagamento: Pix, cartão de crédito ou crediário.');
  const payPlan = b.payPlan;
  const st = publicStatus();
  if (participants.length > st.remaining) throw httpErr(409, st.remaining > 0 ? 'Restam apenas ' + st.remaining + ' vagas.' : 'As vagas se esgotaram.', { remaining: st.remaining });
  const now = nowIso();
  giveVouchers(participants);
  const reg = { id: crypto.randomUUID(), protocol: protocolNew(), createdAt: now, updatedAt: now, source: 'site', participants, accompanied, authAck, authReceived: false, payPlan, consent: { data: true, image: true, at: now }, amount: Math.round(participants.length * settings.price * 100) / 100, payments: [], status: 'ativa', adminNote: '' };
  regs.push(reg);
  await persistRegs();
  json(res, 201, { ok: true, protocol: reg.protocol, amount: reg.amount, remaining: publicStatus().remaining });
}

/* ---------- consulta pública do voucher (CPF, protocolo ou código do voucher) ---------- */
const STATUS_KEY = { pago: 'confirmado', parcial: 'parcial', pendente: 'pre', cancelado: 'cancelada' };
/* Devolve [{ reg, p }]: um participante (por CPF ou código do voucher) ou todos de uma inscrição (por protocolo) */
function findByQuery(q) {
  const raw = String(q == null ? '' : q).trim().slice(0, 60);
  const dig = onlyDigits(raw), key = keyOf(raw);
  const out = [];
  if (/^[\d.\-\s]+$/.test(raw) && dig.length === 11) {
    for (const r of regs) for (const p of r.participants) if (p.cpf && p.cpf === dig) out.push({ reg: r, p });
    const live = out.filter(function (x) { return isActive(x.reg); });
    return live.length ? live : out;
  }
  if (key.length === 11 && key.startsWith('CCV')) {
    for (const r of regs) for (const p of r.participants) if (keyOf(p.voucher) === key) out.push({ reg: r, p });
  } else if (key.length === 8 && key.startsWith('CC')) {
    const r = regs.find(function (x) { return keyOf(x.protocol) === key; });
    if (r) r.participants.forEach(function (p) { out.push({ reg: r, p }); });
  }
  return out;
}
/* O que o público pode ver: nunca telefone, alergias nem CPF completo */
function publicVoucher(reg, p) {
  return { code: p.voucher, nome: p.nome, idade: p.idade, igreja: p.igreja || '', cpf: maskCpf(p.cpf), minor: p.idade < 18,
    auth: p.idade < 18 && reg.accompanied === 'nao' ? (reg.authReceived ? 'recebida' : 'pendente') : '',
    checkin: p.checkin ? { at: p.checkin.at } : null };
}
/* Entrada pelo celular: a pessoa destaca o próprio voucher. Só com a chave ligada no painel e inscrição paga. */
async function handleSelfCheckin(req, res, ip) {
  rate(ip, 'selfck', 300, 600e3); /* limite folgado: no dia, todo mundo usa o mesmo Wi-Fi */
  const b = await readJson(req, 2048);
  const key = keyOf(b.code);
  let reg = null, part = null;
  if (key.length === 11 && key.startsWith('CCV')) {
    for (const r of regs) { const x = r.participants.find(function (y) { return keyOf(y.voucher) === key; }); if (x) { reg = r; part = x; break; } }
  }
  if (!part) { rate(ip, 'voucher-miss', 6, 600e3); throw httpErr(404, 'Voucher não encontrado.'); }
  if (part.checkin) return json(res, 200, { ok: true, at: part.checkin.at, already: true });
  if (!settings.selfCheckin) throw httpErr(403, 'A entrada pelo celular ainda não foi liberada. Procure a organização na chegada.');
  if (!isActive(reg)) throw httpErr(409, 'Inscrição cancelada: procure a organização.');
  if (payStatus(reg) !== 'pago') throw httpErr(409, 'Pagamento ainda não confirmado. Procure a organização na chegada.');
  part.checkin = { at: nowIso(), unpaid: false, self: true };
  reg.updatedAt = nowIso(); await persistRegs();
  json(res, 200, { ok: true, at: part.checkin.at });
}
async function handleVoucherLookup(req, res, ip) {
  rate(ip, 'voucher', 200, 600e3); /* folgado por causa do Wi-Fi compartilhado; quem segura adivinhação é o limite de erros abaixo */
  const b = await readJson(req, 2048);
  const found = findByQuery(b.q);
  if (!found.length) {
    rate(ip, 'voucher-miss', 6, 600e3); /* limita tentativas de adivinhar CPF/código */
    throw httpErr(404, 'Não encontramos uma inscrição com esses dados. Confira o CPF ou o código e tente de novo.');
  }
  const reg = found[0].reg;
  /* a tela pública mostra só o voucher: protocolo, valores e forma de pagamento não saem do servidor */
  json(res, 200, {
    ok: true,
    registration: { status: STATUS_KEY[payStatus(reg)] },
    selfCheckin: !!settings.selfCheckin,
    vouchers: found.filter(function (x) { return x.reg === reg; }).map(function (x) { return publicVoucher(x.reg, x.p); })
  });
}

/* ---------- autenticação do painel ---------- */
function sign(payload) { return crypto.createHmac('sha256', secret).update(payload).digest('base64url'); }
function makeToken() { const p = String(Date.now() + SESSION_HOURS * 3600e3); return p + '.' + sign(p); }
function validToken(t) {
  if (!t || t.indexOf('.') < 0) return false;
  const i = t.indexOf('.'), p = t.slice(0, i), s = t.slice(i + 1);
  const a = Buffer.from(s), b = Buffer.from(sign(p));
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Number(p) > Date.now();
}
const isAdmin = function (req) { return validToken(parseCookies(req).cc_admin); };
function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function isHttps(req) { return !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'); }
function cookie(req, value, maxAge) {
  return 'cc_admin=' + encodeURIComponent(value) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (isHttps(req) ? '; Secure' : '');
}

/* ---------- API do painel ---------- */
function csvCell(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function exportCsv() {
  const head = ['Protocolo', 'Data da inscrição', 'Situação', 'Forma de pagamento', 'Participante', 'CPF', 'Idade', 'WhatsApp', 'Igreja/grupo', 'Alergias/observações', 'Menores: responsável', 'Autorização recebida', 'Valor da inscrição (R$)', 'Pago (R$)', 'Observação do organizador', 'Código do voucher', 'Entrada registrada em'];
  const rows = [head];
  const sorted = regs.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
  for (const r of sorted) {
    r.participants.forEach(function (p, i) {
      rows.push([r.protocol, r.createdAt.slice(0, 10), payStatus(r), PAY_PLANS[r.payPlan] || '', p.nome, p.cpf ? p.cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : '', p.idade, p.tel, p.igreja, p.obs,
        p.idade < 18 ? (r.accompanied === 'sim' ? 'com responsável' : 'sem responsável') : '', p.idade < 18 && r.accompanied === 'nao' ? (r.authReceived ? 'sim' : 'não') : '',
        i === 0 ? r.amount.toFixed(2).replace('.', ',') : '', i === 0 ? paidOf(r).toFixed(2).replace('.', ',') : '', i === 0 ? r.adminNote : '', p.voucher || '', p.checkin ? p.checkin.at : '']);
    });
  }
  return '﻿' + rows.map(function (row) { return row.map(csvCell).join(';'); }).join('\r\n') + '\r\n';
}
function findReg(id) { const r = regs.find(function (x) { return x.id === id; }); if (!r) throw httpErr(404, 'Inscrição não encontrada.'); return r; }

async function adminApi(req, res, url, ip) {
  const p = url.pathname, m = req.method;

  if (p === '/api/admin/login' && m === 'POST') {
    rate(ip, 'login', 8, 600e3);
    const b = await readJson(req, 2048);
    const ok = crypto.timingSafeEqual(sha(b.password), sha(adminPassword));
    if (!ok) { await new Promise(function (r) { setTimeout(r, 600); }); throw httpErr(401, 'Senha incorreta.'); }
    return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, makeToken(), SESSION_HOURS * 3600) });
  }
  if (p === '/api/admin/logout' && m === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
  if (!isAdmin(req)) throw httpErr(401, 'Faça login para continuar.');

  if (p === '/api/admin/data' && m === 'GET') {
    const list = regs.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }).map(view);
    return json(res, 200, { stats: stats(), registrations: list, settings });
  }
  if (p === '/api/admin/export.csv' && m === 'GET') {
    return send(res, 200, exportCsv(), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="conectacamp-inscricoes-' + nowIso().slice(0, 10) + '.csv"', 'Cache-Control': 'no-store' });
  }
  /* Validação do voucher na chegada: busca por código/QR, CPF, protocolo ou nome */
  if (p === '/api/admin/vouchers/find' && m === 'POST') {
    const b = await readJson(req, 2048);
    const q = String(b.q == null ? '' : b.q).trim().slice(0, 80);
    let found = findByQuery(q);
    if (!found.length && plain(q).length >= 3) {
      const words = plain(q).split(/\s+/).filter(Boolean);
      for (const r of regs) for (const x of r.participants) {
        const name = plain(x.nome);
        if (words.every(function (w) { return name.indexOf(w) >= 0; })) found.push({ reg: r, p: x });
      }
    }
    found = found.slice(0, 20);
    return json(res, 200, { ok: true, matches: found.map(function (x) { return { registration: view(x.reg), participantId: x.p.id }; }), stats: stats() });
  }
  if (p === '/api/admin/vouchers/checkin' && m === 'POST') {
    const b = await readJson(req, 2048);
    let reg = null, part = null;
    for (const r of regs) { const x = r.participants.find(function (y) { return y.id === b.participantId; }); if (x) { reg = r; part = x; break; } }
    if (!part) throw httpErr(404, 'Participante não encontrado.');
    if (b.undo === true) {
      part.checkin = null;
    } else {
      if (!isActive(reg)) throw httpErr(409, 'Inscrição cancelada: entrada não liberada.');
      if (part.checkin) throw httpErr(409, 'A entrada de ' + part.nome + ' já foi registrada.', { already: true, at: part.checkin.at });
      const paid = payStatus(reg) === 'pago';
      if (!paid && b.force !== true) throw httpErr(409, 'Pagamento ainda não confirmado (' + money(paidOf(reg)) + ' de ' + money(reg.amount) + ').', { canForce: true });
      part.checkin = { at: nowIso(), unpaid: !paid };
    }
    reg.updatedAt = nowIso(); await persistRegs();
    return json(res, 200, { ok: true, registration: view(reg), participantId: part.id, stats: stats() });
  }
  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readJson(req, 4096);
    const next = Object.assign({}, settings);
    const int = function (v, lo, hi, label) { const n = Number.parseInt(v, 10); if (!Number.isInteger(n) || n < lo || n > hi) throw httpErr(400, label + ' inválido.'); return n; };
    next.capacity = int(b.capacity, 1, 10000, 'Número de vagas');
    next.ageMin = int(b.ageMin, 0, 99, 'Idade mínima');
    next.ageMax = int(b.ageMax, next.ageMin, 120, 'Idade máxima');
    const price = Math.round(Number(b.price) * 100) / 100;
    if (!(price >= 0) || price > 100000) throw httpErr(400, 'Valor inválido.');
    next.price = price; next.countPending = !!b.countPending; next.open = !!b.open;
    if (typeof b.selfCheckin === 'boolean') next.selfCheckin = b.selfCheckin;
    settings = next; await persistSettings();
    return json(res, 200, { ok: true, settings, stats: stats() });
  }
  if (p === '/api/admin/registrations' && m === 'POST') {
    const b = await readJson(req);
    const participants = parseParticipants(b.participants, !b.force, false);
    assertCpfsFree(participants, null);
    giveVouchers(participants);
    const hasMinor = participants.some(function (x) { return x.idade < 18; });
    const payPlan = isPlan(b.payPlan) ? b.payPlan : '';
    const st = publicStatus();
    if (!b.force && participants.length > st.remaining) throw httpErr(409, 'Passa do limite de vagas (restam ' + st.remaining + ').', { remaining: st.remaining, canForce: true });
    const now = nowIso();
    const reg = { id: crypto.randomUUID(), protocol: protocolNew(), createdAt: now, updatedAt: now, source: 'admin', participants, accompanied: hasMinor ? (b.accompanied === 'nao' ? 'nao' : 'sim') : '', authAck: false, authReceived: false, payPlan, consent: { data: true, image: true, at: now, byAdmin: true }, amount: Math.round(participants.length * settings.price * 100) / 100, payments: [], status: 'ativa', adminNote: clean(b.adminNote, 2000) };
    if (b.payment && Number(b.payment.amount) > 0) { const pay = parsePayment(b.payment); assertCanPay(reg, pay.amount); reg.payments.push(pay); }
    regs.push(reg); await persistRegs();
    return json(res, 201, { ok: true, registration: view(reg), stats: stats() });
  }

  const mm = p.match(/^\/api\/admin\/registrations\/([0-9a-f-]{36})(?:\/payments(?:\/([0-9a-f-]{36}))?)?$/);
  if (mm) {
    const reg = findReg(mm[1]);
    const isPay = p.indexOf('/payments') > 0;
    if (!isPay && m === 'PATCH') {
      const b = await readJson(req);
      if (typeof b.adminNote === 'string') reg.adminNote = clean(b.adminNote, 2000);
      if (typeof b.authReceived === 'boolean') reg.authReceived = b.authReceived;
      if (typeof b.payPlan === 'string') {
        if (b.payPlan !== '' && !isPlan(b.payPlan)) throw httpErr(400, 'Forma de pagamento inválida.');
        if (b.payPlan === 'pix' || b.payPlan === 'cartao') {
          if (reg.payments.length > 1) throw httpErr(409, 'Há mais de um pagamento registrado. Remova até sobrar um, ou use Crediário.');
          if (reg.payments.length === 1 && Math.abs(reg.payments[0].amount - reg.amount) > 0.001) throw httpErr(409, 'O pagamento registrado não cobre o valor total. Remova-o ou use Crediário.');
        }
        reg.payPlan = b.payPlan;
      }
      if (b.status === 'cancelada' || b.status === 'ativa') {
        if (b.status === 'ativa' && reg.status === 'cancelada') assertCpfsFree(reg.participants, reg.id);
        if (b.status === 'ativa' && reg.status === 'cancelada' && !b.force) {
          const st = publicStatus();
          if (reg.participants.length > st.remaining) throw httpErr(409, 'Reativar passa do limite de vagas (restam ' + st.remaining + ').', { remaining: st.remaining, canForce: true });
        }
        reg.status = b.status;
      }
      if (Array.isArray(b.participants)) {
        /* valida tudo antes de gravar qualquer campo */
        const updates = [];
        for (const edit of b.participants) {
          const target = reg.participants.find(function (x) { return x.id === edit.id; });
          if (!target) continue;
          const r = parseParticipant(Object.assign({}, target, edit), false, false);
          if (r.error) throw httpErr(400, r.error);
          updates.push({ target, v: r.value });
        }
        const next = reg.participants.map(function (x) { const u = updates.find(function (y) { return y.target === x; }); return u ? Object.assign({}, x, { cpf: u.v.cpf, nome: u.v.nome }) : x; });
        assertCpfsFree(next, reg.id);
        for (const u of updates) Object.assign(u.target, { nome: u.v.nome, idade: u.v.idade, tel: u.v.tel, igreja: u.v.igreja, obs: u.v.obs, cpf: u.v.cpf });
      }
      reg.updatedAt = nowIso(); await persistRegs();
      return json(res, 200, { ok: true, registration: view(reg), stats: stats() });
    }
    if (!isPay && m === 'DELETE') {
      regs = regs.filter(function (x) { return x.id !== reg.id; }); await persistRegs();
      return json(res, 200, { ok: true, stats: stats() });
    }
    if (isPay && !mm[2] && m === 'POST') {
      const b = await readJson(req, 4096);
      const pay = parsePayment(b, Math.max(0, reg.amount - paidOf(reg)));
      assertCanPay(reg, pay.amount);
      reg.payments.push(pay);
      reg.updatedAt = nowIso(); await persistRegs();
      return json(res, 201, { ok: true, registration: view(reg), stats: stats() });
    }
    if (isPay && mm[2] && m === 'DELETE') {
      const before = reg.payments.length;
      reg.payments = reg.payments.filter(function (x) { return x.id !== mm[2]; });
      if (reg.payments.length === before) throw httpErr(404, 'Pagamento não encontrado.');
      reg.updatedAt = nowIso(); await persistRegs();
      return json(res, 200, { ok: true, registration: view(reg), stats: stats() });
    }
  }
  throw httpErr(404, 'Não encontrado.');
}

async function api(req, res, url, ip) {
  const p = url.pathname, m = req.method;
  if (p === '/api/status' && m === 'GET') return json(res, 200, publicStatus());
  if (p === '/api/registrations' && m === 'POST') return handleRegister(req, res, ip);
  if (p === '/api/voucher' && m === 'POST') return handleVoucherLookup(req, res, ip);
  if (p === '/api/voucher/checkin' && m === 'POST') return handleSelfCheckin(req, res, ip);
  if (p.startsWith('/api/admin/')) return adminApi(req, res, url, ip);
  throw httpErr(404, 'Não encontrado.');
}

/* ---------- arquivos estáticos ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC_DIRS = new Set(['css', 'js', 'img', 'admin']);
const ADMIN_CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

async function serveStatic(req, res, pathname) {
  if (pathname === '/admin') return send(res, 301, '', { Location: '/admin/' });
  if (pathname === '/robots.txt') return send(res, 200, 'User-agent: *\nDisallow: /admin/\nDisallow: /api/\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch (e) { throw httpErr(400, 'Endereço inválido.'); }
  if (decoded.indexOf('\0') >= 0) throw httpErr(400, 'Endereço inválido.');
  let parts = decoded.split('/').filter(Boolean);
  if (parts.length === 0) parts = ['index.html'];
  else if (decoded.endsWith('/')) parts.push('index.html');
  if (parts.some(function (s) { return s.startsWith('.') || s === '..'; })) throw httpErr(404, 'Não encontrado.');
  if (!(parts.length === 1 && parts[0] === 'index.html') && !PUBLIC_DIRS.has(parts[0])) throw httpErr(404, 'Não encontrado.');
  const full = path.join(ROOT, ...parts);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw httpErr(404, 'Não encontrado.');
  let st;
  try { st = await fsp.stat(full); } catch (e) { throw httpErr(404, 'Não encontrado.'); }
  if (!st.isFile()) throw httpErr(404, 'Não encontrado.');
  const headers = { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' };
  if (parts[0] === 'admin') Object.assign(headers, { 'Content-Security-Policy': ADMIN_CSP, 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

/* ---------- servidor ---------- */
const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url, clientIp(req));
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpErr(405, 'Método não permitido.');
    return await serveStatic(req, res, url.pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (req.url && req.url.startsWith('/api/')) json(res, status, Object.assign({ error: status === 500 ? 'Erro interno.' : e.message }, e.extra || {}));
    else send(res, status, status === 404 ? 'Página não encontrada.' : (status === 500 ? 'Erro interno.' : e.message), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

init().then(function () {
  server.listen(PORT, HOST, function () {
    console.log('\nCONECTAcamp rodando em  http://' + (HOST === '127.0.0.1' ? 'localhost' : HOST) + ':' + PORT + '/');
    console.log('Painel do organizador   http://' + (HOST === '127.0.0.1' ? 'localhost' : HOST) + ':' + PORT + '/admin/');
    if (process.env.ADMIN_PASSWORD) console.log('Senha do painel: definida pela variável ADMIN_PASSWORD.');
    else console.log((passwordWasGenerated ? 'Senha do painel gerada e salva em: ' : 'Senha do painel salva em: ') + FILES.password);
    console.log('Dados das inscrições em: ' + DATA_DIR + '\n');
  });
}).catch(function (e) { console.error('Não foi possível iniciar:', e); process.exit(1); });

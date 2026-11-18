// auth.js – Admin-Anmeldung: Microsoft Entra ID (OpenID Connect, Code-Flow mit PKCE) und optional ein Notfall-Passwort
'use strict';
const crypto = require('crypto');
const net = require('net');
const { sha256, randomToken, now } = require('./db');

const SESSION_HOURS = 10;
const b64url = buf => Buffer.from(buf).toString('base64url');

// Passwort-Hash im Format scrypt$<salt>$<hash> (erzeugen mit: npm run passwort)
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}
function checkPassword(pw, stored) {
  if (!stored || !pw) return false;
  if (!stored.startsWith('scrypt$')) {                 // Klartext aus .env (nur zum Ausprobieren)
    const a = Buffer.from(sha256(pw)), b = Buffer.from(sha256(stored));
    return crypto.timingSafeEqual(a, b);
  }
  const [, salt, hash] = stored.split('$');
  const calc = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64url'), 64, { N: 16384, r: 8, p: 1 });
  const exp = Buffer.from(hash, 'base64url');
  return exp.length === calc.length && crypto.timingSafeEqual(calc, exp);
}

/* ---------- Zweiter Faktor (1.14): TOTP wie in Authenticator-Apps, gleiche Rechnung wie app/auth.php ---------- */
function b32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of String(s || '').toUpperCase().replace(/[\s=-]/g, '')) {
    const v = alpha.indexOf(ch);
    if (v < 0) return Buffer.alloc(0);
    bits += v.toString(2).padStart(5, '0');
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
function totpCode(key, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
/** Zeitschritt des passenden Codes (±30 Sekunden Spielraum) oder -1 */
function totpStep(secret, code, nowSec = Math.floor(Date.now() / 1000)) {
  const key = b32Decode(secret), c = String(code || '').replace(/\s/g, '');
  if (key.length < 10 || !/^\d{6}$/.test(c)) return -1;
  const t = Math.floor(nowSec / 30);
  for (const d of [0, -1, 1]) { const x = totpCode(key, t + d); if (crypto.timingSafeEqual(Buffer.from(x), Buffer.from(c))) return t + d; }
  return -1;
}
/** Adresse in der Freigabeliste? Einträge: einzelne Adressen oder Netze (203.0.113.0/24, 2001:db8::/32) */
function ipAllowed(ip, list) {
  const bl = new net.BlockList();
  for (const e of list) {
    const [addr, len] = String(e).trim().split('/');
    const type = net.isIPv6(addr) ? 'ipv6' : net.isIPv4(addr) ? 'ipv4' : null;
    if (!type) continue;
    if (len === undefined) bl.addAddress(addr, type); else bl.addSubnet(addr, Number(len), type);
  }
  const a = String(ip || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  const type = net.isIPv6(a) ? 'ipv6' : net.isIPv4(a) ? 'ipv4' : null;
  return !!type && bl.check(a, type);
}

function createAuth({ cfg, store, log }) {
  const entraOn = !!(cfg.entra.tenant && cfg.entra.clientId && cfg.entra.clientSecret);
  const localOn = !!cfg.adminPassword && (cfg.localLogin || !entraOn);
  const admins = new Set(cfg.adminUsers.map(u => u.toLowerCase()));
  const secure = cfg.publicUrl.startsWith('https://');
  const cookieOpts = maxAgeSec => ({ path: '/', httpOnly: true, sameSite: 'lax', secure, signed: true, maxAge: maxAgeSec });

  function createSession(reply, user, name, via, hours = SESSION_HOURS) {
    const id = randomToken(32), csrf = randomToken(24);
    store.run('INSERT INTO sessions (id, user, name, via, csrf, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sha256(id), user, name || user, via, csrf, now(), now() + hours * 3600e3);
    reply.setCookie('sz_sess', id, cookieOpts(hours * 3600));
    store.audit(user, 'login', via);
  }
  function session(req) {
    const raw = req.cookies && req.cookies.sz_sess;
    if (!raw) return null;
    const u = req.unsignCookie(raw);
    if (!u.valid) return null;
    const s = store.get('SELECT * FROM sessions WHERE id = ? AND expires > ?', sha256(u.value), now());
    return s || null;
  }
  function logout(req, reply) {
    const s = session(req);
    if (s) { store.run('DELETE FROM sessions WHERE id = ?', s.id); store.audit(s.user, 'logout'); }
    reply.clearCookie('sz_sess', { path: '/' });
  }

  /* ---------- Entra ID ---------- */
  const authority = () => `https://login.microsoftonline.com/${cfg.entra.tenant}`;
  function entraStart(req, reply) {
    const state = randomToken(18), nonce = randomToken(18), verifier = randomToken(48);
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    reply.setCookie('sz_oidc', JSON.stringify({ state, nonce, verifier, t: now() }), cookieOpts(600));
    const p = new URLSearchParams({
      client_id: cfg.entra.clientId, response_type: 'code', redirect_uri: cfg.publicUrl + '/auth/callback', response_mode: 'query',
      scope: 'openid profile email', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
    });
    return reply.redirect(`${authority()}/oauth2/v2.0/authorize?${p}`);
  }
  async function entraCallback(req, reply) {
    const fail = (msg, extra = '') => { log.warn('Entra-Anmeldung abgelehnt: ' + msg + ' ' + extra); return reply.redirect('/admin/?fehler=' + encodeURIComponent(msg)); };
    const raw = req.cookies && req.cookies.sz_oidc;
    reply.clearCookie('sz_oidc', { path: '/' });
    if (!raw) return fail('Anmeldung abgelaufen, bitte noch einmal.');
    const u = req.unsignCookie(raw);
    if (!u.valid) return fail('Ungültiges Anmelde-Cookie.');
    let st; try { st = JSON.parse(u.value); } catch { return fail('Ungültiges Anmelde-Cookie.'); }
    if (req.query.error) return fail('Microsoft meldet: ' + String(req.query.error_description || req.query.error).slice(0, 200));
    if (!req.query.code || req.query.state !== st.state || now() - st.t > 600e3) return fail('Anmeldung ungültig oder abgelaufen.');
    const body = new URLSearchParams({
      client_id: cfg.entra.clientId, client_secret: cfg.entra.clientSecret, grant_type: 'authorization_code',
      code: String(req.query.code), redirect_uri: cfg.publicUrl + '/auth/callback', code_verifier: st.verifier, scope: 'openid profile email'
    });
    let tok;
    try {
      const r = await fetch(`${authority()}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
      tok = await r.json();
      if (!r.ok || !tok.id_token) return fail('Token-Abruf fehlgeschlagen.', JSON.stringify(tok).slice(0, 300));
    } catch (e) { return fail('Microsoft nicht erreichbar.', e.message); }
    // Das ID-Token kommt direkt per TLS vom Token-Endpunkt → Signaturprüfung nach OIDC Core 3.1.3.7 entbehrlich; Inhalt wird geprüft
    let c;
    try { c = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()); } catch { return fail('ID-Token unlesbar.'); }
    const tid = cfg.entra.tenant;
    const issOk = c.tid === tid && c.iss === `https://login.microsoftonline.com/${tid}/v2.0`;
    if (!issOk || c.aud !== cfg.entra.clientId || c.nonce !== st.nonce || (c.exp || 0) * 1000 < now()) return fail('ID-Token passt nicht.');
    const user = String(c.preferred_username || c.email || c.upn || '').toLowerCase();
    const groups = Array.isArray(c.groups) ? c.groups : [];
    const allowed = admins.has(user) || (cfg.adminGroup && groups.includes(cfg.adminGroup));
    if (!allowed) { store.audit(user, 'login_denied', 'entra'); return fail(`${user || 'Dieses Konto'} ist kein Admin der Sudo-Zentrale.`); }
    createSession(reply, user, c.name, 'entra');
    return reply.redirect('/admin/');
  }

  /* ---------- Notfall-Zugang (1.14): zweiter Faktor, Adressfreigabe, Sperre pro Adresse und für alle ---------- */
  // Unterschied zur PHP-Version: Das Passwort steht in der .env (nicht im Web-Ordner), ein Klartext-Passwort ist hier weiter erlaubt.
  const LOCAL_SESSION_HOURS = 2;
  const totpOk = !!cfg.adminTotp && b32Decode(cfg.adminTotp).length >= 10;
  const security = () => ({ local: localOn, totp: totpOk, hashed: String(cfg.adminPassword || '').startsWith('scrypt$'), ips: cfg.localLoginIps.length > 0 });
  const tries = new Map();
  let all = { n: 0, at: now() };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function localLogin(req, reply) {
    if (!localOn) return reply.code(404).send({ message: 'Passwort-Anmeldung ist ausgeschaltet.' });
    const ip = req.ip;
    if (cfg.localLoginIps.length && !ipAllowed(ip, cfg.localLoginIps)) { store.audit(ip, 'login_denied', 'notfall: adresse'); return reply.code(403).send({ message: 'Notfall-Zugang von dieser Adresse nicht erlaubt.' }); }
    if (now() - all.at > 3600e3) all = { n: 0, at: now() };
    if (++all.n > 30) return reply.code(429).send({ message: 'Notfall-Zugang vorübergehend gesperrt (zu viele Versuche). In einer Stunde noch mal.' });
    const t = tries.get(ip) || { n: 0, at: now() };
    if (now() - t.at > 15 * 60e3) { t.n = 0; t.at = now(); }
    if (++t.n > 5) { tries.set(ip, t); return reply.code(429).send({ message: 'Zu viele Versuche. In 15 Minuten noch mal.' }); }
    tries.set(ip, t);
    if (cfg.adminTotp && !totpOk) return reply.code(403).send({ message: 'Der zweite Faktor (admin_totp) ist ungültig eingetragen.' });
    const b = req.body || {};
    let ok = checkPassword(String(b.password || ''), cfg.adminPassword), step = -1;
    if (ok && totpOk) {
      step = totpStep(cfg.adminTotp, b.code);
      ok = step > Number(store.settings().totp_last || 0);           // jeder Code nur einmal
    }
    if (!ok) {
      await sleep(700);                                                // bremst automatisches Durchprobieren
      store.audit(ip, 'login_failed', 'notfall');
      return reply.code(401).send({ message: totpOk ? 'Passwort oder Code falsch.' : 'Passwort falsch.' });
    }
    if (totpOk) store.setSetting('totp_last', String(step));
    createSession(reply, 'admin', 'Admin (Notfall-Zugang)', 'passwort', LOCAL_SESSION_HOURS);
    return { ok: true };
  }

  return { entraOn, localOn, totpOn: localOn && totpOk, security, session, logout, entraStart, entraCallback, localLogin };
}

module.exports = { createAuth, hashPassword, checkPassword, totpStep, b32Decode, ipAllowed };

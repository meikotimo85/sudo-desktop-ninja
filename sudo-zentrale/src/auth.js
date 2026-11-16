// auth.js – Admin-Anmeldung: Microsoft Entra ID (OpenID Connect, Code-Flow mit PKCE) und optional ein Notfall-Passwort
'use strict';
const crypto = require('crypto');
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

function createAuth({ cfg, store, log }) {
  const entraOn = !!(cfg.entra.tenant && cfg.entra.clientId && cfg.entra.clientSecret);
  const localOn = !!cfg.adminPassword && (cfg.localLogin || !entraOn);
  const admins = new Set(cfg.adminUsers.map(u => u.toLowerCase()));
  const secure = cfg.publicUrl.startsWith('https://');
  const cookieOpts = maxAgeSec => ({ path: '/', httpOnly: true, sameSite: 'lax', secure, signed: true, maxAge: maxAgeSec });

  function createSession(reply, user, name, via) {
    const id = randomToken(32), csrf = randomToken(24);
    store.run('INSERT INTO sessions (id, user, name, via, csrf, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
      sha256(id), user, name || user, via, csrf, now(), now() + SESSION_HOURS * 3600e3);
    reply.setCookie('sz_sess', id, cookieOpts(SESSION_HOURS * 3600));
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

  /* ---------- Notfall-Passwort ---------- */
  const tries = new Map();
  function localLogin(req, reply) {
    if (!localOn) return reply.code(404).send({ message: 'Passwort-Anmeldung ist ausgeschaltet.' });
    const ip = req.ip, t = tries.get(ip) || { n: 0, at: now() };
    if (now() - t.at > 15 * 60e3) { t.n = 0; t.at = now(); }
    if (t.n >= 8) return reply.code(429).send({ message: 'Zu viele Versuche. In 15 Minuten noch mal.' });
    const ok = checkPassword(String((req.body || {}).password || ''), cfg.adminPassword);
    if (!ok) { t.n++; tries.set(ip, t); store.audit(ip, 'login_failed', 'passwort'); return reply.code(401).send({ message: 'Passwort falsch.' }); }
    tries.delete(ip);
    createSession(reply, 'admin', 'Admin (Passwort)', 'passwort');
    return { ok: true };
  }

  return { entraOn, localOn, session, logout, entraStart, entraCallback, localLogin };
}

module.exports = { createAuth, hashPassword, checkPassword };

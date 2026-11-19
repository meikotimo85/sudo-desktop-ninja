// mail.js – schlanker SMTP-Versand ohne zusätzliche Pakete (1.15, für das Ideen-Board)
// SMTP_URL=smtps://benutzer:passwort@mail.example.com:465   (TLS von Anfang an)
// SMTP_URL=smtp://benutzer:passwort@mail.example.com:587    (STARTTLS, Pflicht – ohne Verschlüsselung wird nicht angemeldet)
// MAIL_FROM=sudo-zentrale@example.com   (Absender; Standard: sudo-zentrale@<Host von PUBLIC_URL>)
// MAIL_DIR=<Ordner>                     (nur für Tests: Mails als .eml-Datei ablegen statt versenden)
// Zugangsdaten gehören nur in die .env, nie in den Code.
'use strict';
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const enc = s => /^[\x20-\x7E]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
const noBreak = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();

function createMailer({ url, from, dir, publicUrl }) {
  let u = null;
  try { u = url ? new URL(url) : null; } catch { u = null; }
  if (u && !['smtp:', 'smtps:'].includes(u.protocol)) u = null;
  const host = (() => { try { return new URL(publicUrl).hostname; } catch { return 'localhost'; } })();
  const sender = noBreak(from) || 'sudo-zentrale@' + host;
  const ready = !!(dir || u);

  function message({ to, subject, text, replyTo }) {
    const head = [`From: Sudo-Zentrale <${sender}>`, `To: ${noBreak(to)}`, `Subject: ${enc(noBreak(subject))}`, `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', 'X-Mailer: Sudo-Zentrale'];
    if (replyTo) head.push('Reply-To: ' + noBreak(replyTo));
    const body = Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
    return head.join('\r\n') + '\r\n\r\n' + body;
  }

  // Ein SMTP-Gespräch: Zeilen lesen, auf Antwortcodes warten, Befehle schicken
  function smtp(to, data) {
    return new Promise((resolve, reject) => {
      const port = Number(u.port) || (u.protocol === 'smtps:' ? 465 : 587);
      let sock = u.protocol === 'smtps:' ? tls.connect({ host: u.hostname, port, servername: u.hostname }) : net.connect({ host: u.hostname, port });
      let buf = '', waiting = null;
      const timer = setTimeout(() => { sock.destroy(); reject(new Error('Zeitüberschreitung beim Mailserver')); }, 20000);
      const onData = d => {
        buf += d.toString('utf8');
        let m;
        while ((m = buf.match(/^(\d{3})([ -])(.*)\r?\n/m)) && buf.indexOf(m[0]) === 0) {
          buf = buf.slice(m[0].length);
          if (m[2] === ' ' && waiting) { const w = waiting; waiting = null; w(Number(m[1]), m[3]); }
        }
      };
      const expect = (cmd, ok) => new Promise((res, rej) => {
        waiting = (code, txt) => (ok.includes(code) ? res(code) : rej(new Error(`Mailserver: ${code} ${txt}`)));
        if (cmd !== null) sock.write(cmd + '\r\n');
      });
      const attach = s => { s.on('data', onData); s.on('error', e => { clearTimeout(timer); reject(e); }); };
      attach(sock);
      (async () => {
        await expect(null, [220]);
        await expect('EHLO ' + host, [250]);
        if (u.protocol === 'smtp:') {
          await expect('STARTTLS', [220]);
          sock.removeListener('data', onData);
          sock = await new Promise((res, rej) => { const t = tls.connect({ socket: sock, servername: u.hostname }, () => res(t)); t.on('error', rej); });
          attach(sock);
          await expect('EHLO ' + host, [250]);
        }
        if (u.username) {
          await expect('AUTH LOGIN', [334]);
          await expect(Buffer.from(decodeURIComponent(u.username)).toString('base64'), [334]);
          await expect(Buffer.from(decodeURIComponent(u.password)).toString('base64'), [235]);
        }
        await expect(`MAIL FROM:<${sender}>`, [250]);
        await expect(`RCPT TO:<${noBreak(to)}>`, [250, 251]);
        await expect('DATA', [354]);
        await expect(data.replace(/^\./gm, '..') + '\r\n.', [250]);
        sock.write('QUIT\r\n'); sock.end();
        clearTimeout(timer); resolve(true);
      })().catch(e => { clearTimeout(timer); sock.destroy(); reject(e); });
    });
  }

  async function send(m) {
    const data = message(m);
    if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `idee-${m.id || Date.now()}.eml`), data); return true; }
    if (!u) return false;
    return smtp(m.to, data);
  }
  return { ready, send };
}

module.exports = { createMailer };

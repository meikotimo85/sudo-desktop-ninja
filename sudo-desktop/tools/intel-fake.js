// intel-fake.js – Testdaten für die IT-Lage (nur mit SUDO_INTEL_FAKE=1, nicht im Build enthalten)
'use strict';
let round = 0, feedRound = 0;
const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => JSON.parse(body), text: async () => body });
const svc = (n, st, t = '', m = '') => ({ ServiceDisplayName: n, ServiceWorkloadName: n.replace(/\W/g, ''), Status: st, Title: t, Message: m, LastUpdatedTime: new Date().toISOString() });
exports.fetch = async url => {
  url = String(url);
  if (url.includes('m365Consumer')) {
    round++;
    return res(JSON.stringify([
      svc('Microsoft 365 (Consumer)', 'Operational'), svc('Microsoft Copilot', 'Operational'),
      svc('Outlook.com', round > 1 ? 'Service degradation' : 'Operational', 'Users may be unable to send email', 'We are investigating reports that some users can\'t send emails from Outlook.com.'),
      svc('OneDrive', 'Operational'), svc('Microsoft Teams Free', 'Investigating', 'Delays in chat messages', 'Messages may be delayed.'), svc('Phone Link', 'Operational')]));
  }
  if (url.includes('azure.status')) return res(`<?xml version="1.0"?><rss version="2.0"><channel><title>Azure Status</title>
    <item><title>Active - Networking issues in West Europe</title><link>https://azure.status.microsoft/en-us/status</link><description>&lt;p&gt;Starting at 14:05 UTC a subset of customers may experience connectivity issues.&lt;/p&gt;</description><pubDate>Mon, 02 Nov 2026 14:20:00 GMT</pubDate><guid>az1</guid></item></channel></rss>`);
  if (url.includes('securityAdvisory')) {
    feedRound++;
    const it = (n, sev, t, st = 'NEU') => `<item><title>[${st}] [${sev}] ${t}</title><link>https://wid.cert-bund.de/portal/wid/securityadvisory?name=WID-SEC-2026-${n}</link><description>Ein entfernter, anonymer Angreifer kann mehrere Schwachstellen in ${t.split(':')[0]} ausnutzen.</description><category>${sev}</category><pubDate>Mon, 02 Nov 2026 ${10 + n % 10}:17:57 GMT</pubDate></item>`;
    const items = [it(4287, 'mittel', 'QT: Mehrere Schwachstellen ermöglichen Denial of Service'), it(4286, 'hoch', 'Microsoft Azure, Entra und Exchange: Mehrere Schwachstellen'),
      it(4280, 'niedrig', 'Linux Kernel: Schwachstelle ermöglicht Informationsoffenlegung'), it(4279, 'hoch', 'Mozilla Firefox: Mehrere Schwachstellen', 'UPDATE')];
    if (feedRound > 1) items.unshift(it(4299, 'kritisch', 'Fortinet FortiOS: Schwachstelle ermöglicht Codeausführung'), it(4298, 'hoch', 'Microsoft Windows: Mehrere Schwachstellen'));
    return res(`<?xml version="1.0"?><rss version="2.0"><channel><title>CERT-Bund WID</title>${items.join('')}</channel></rss>`);
  }
  if (url.includes('latestbreach')) return res(JSON.stringify({ Name: 'ExampleShop', Title: 'Example Shop', Domain: 'example-shop.com', BreachDate: '2026-10-12', AddedDate: '2026-11-01T08:00:00Z', PwnCount: 2380114, DataClasses: ['Email addresses', 'Passwords', 'Names', 'Phone numbers'], IsVerified: true, Description: 'In October 2026, the online store <a href="#">Example Shop</a> suffered a data breach exposing 2.4M customer records.' }));
  if (url.includes('breachedaccount')) return url.includes('sauber') ? res('', 404) : res(JSON.stringify([
    { Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', PwnCount: 152445165, DataClasses: ['Email addresses', 'Password hints', 'Passwords', 'Usernames'], Description: 'In October 2013, 153 million Adobe accounts were breached.' },
    { Name: 'LinkedIn', Title: 'LinkedIn', Domain: 'linkedin.com', BreachDate: '2012-05-05', PwnCount: 164611595, DataClasses: ['Email addresses', 'Passwords'], Description: 'In May 2016, LinkedIn had 164 million email addresses and passwords exposed.' }]));
  if (url.includes('pwnedpasswords')) return res('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0\r\n');
  return res('', 404);
};

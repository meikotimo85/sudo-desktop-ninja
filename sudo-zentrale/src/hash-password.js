// hash-password.js – erzeugt den Hash für ADMIN_PASSWORD in der .env (npm run passwort)
'use strict';
const readline = require('readline');
const { hashPassword } = require('./auth');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Neues Admin-Passwort (mind. 12 Zeichen): ', pw => {
  rl.close();
  if (String(pw).length < 12) { console.error('Zu kurz.'); process.exit(1); }
  console.log('\nIn die .env eintragen:\nADMIN_PASSWORD=' + hashPassword(pw));
});

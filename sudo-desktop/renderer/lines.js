// lines.js – Sudos Sprüche. Hier kannst du gefahrlos eigene Texte ergänzen.
// \n = Zeilenumbruch in der Sprechblase. Pro Zeile höchstens etwa 22 Zeichen.
window.SudoLines = {
  // Begrüßung beim Start, je nach Tageszeit und Wochentag
  greet: {
    morning:   ['Moin! Kaffee\nschon da?', 'Guten Morgen!\nRoot-Rechte hab ich.', 'Moin! Erst mal\nTickets sichten?'],
    noon:      ['Mahlzeit!\nIch bin wieder da.', 'Moin! Ich bin Sudo.\nRoot-Rechte hab ich schon.'],
    afternoon: ['Na, gut voran-\ngekommen heute?', 'Sudo meldet sich\nzum Dienst.'],
    evening:   ['Noch fleißig?\nIch leiste Gesellschaft.', 'Abendschicht?\nIch bin dabei.'],
    night:     ['Nachtschicht?\nIch hol Kaffee.', 'Es ist spät …\nnur noch ein Commit?'],
    monday:    ['Montag. Ich brauch\nmehr Kaffee.', 'Neue Woche,\nneue Tickets.'],
    friday:    ['Freitag! Heute\nkein Deploy, ja?', 'Fast Wochenende.\nNichts kaputt machen!']
  },

  // Einmal pro Tag zu bestimmten Zeiten
  clock: {
    lunch:    ['Mahlzeit!', 'Mittagspause?\nDer Server wartet.', 'Zeit für\nCurrywurst?'],
    friday:   ['Wochenende in Sicht!', 'Freitagnachmittag:\nnur noch lesen,\nnichts ändern.'],
    patchday: ['Patchday!\nUpdates verteilen.', 'Zweiter Dienstag:\nMicrosoft liefert.']
  },

  // Zufällige IT-Weisheiten, wenn gerade nichts los ist
  wisdom: [
    'Schon aus- und wieder\neingeschaltet?',
    'Es ist immer DNS.',
    'It\'s not a bug,\nit\'s a feature.',
    'Backup ist gut.\nRestore ist besser.',
    'Läuft auf\nmeinem Rechner.',
    'Never touch a\nrunning system.',
    'Kein Deploy\nam Freitag.',
    'Passwort123 ist\nkein Passwort.',
    'MFA an?\nSehr gut.',
    'Ein Server ohne Backup\nist nur ein Gerücht.',
    'Patchen ist wie\nZähneputzen.',
    'Phishing-Mail?\nNicht klicken!',
    'Least Privilege –\nauch für Ninjas.',
    'Zero Trust,\nvolle Tasse.',
    'git commit -m "fix"?\nEcht jetzt?',
    'Doku ist ein Brief\nan dein Zukunfts-Ich.',
    'Ping ist kein\nMonitoring.',
    'Cache leeren\nhilft fast immer.',
    'Es gibt 10 Arten\nvon Menschen …',
    'Erst Ticket,\ndann Arbeit.',
    'Wer loggt,\ngewinnt.',
    'sudo make me\na sandwich.'
  ],

  // Kleine Selbstbeschäftigungen
  ping:    ['ping 8.8.8.8\n64 Bytes: 12 ms', 'ping localhost\n… ich bin da.', 'tracert zur\nKaffeemaschine …'],
  stretch: ['Streeetch …', 'Rücken knackt.\nWie ein alter Server.'],
  lookout: ['Alles ruhig\nim Netzwerk.', 'Keine Bugs\nin Sicht.', 'Firewall hält.'],
  // 1.9: Jonglieren, Tagesmomente, Jahreszeiten
  juggle: ['Multitasking.', 'Drei Tickets\ngleichzeitig.', 'Load Balancing.', 'Round Robin!'],
  monday: ['Montag.\nErst mal Kaffee.', 'Neue Woche,\nneue Tickets.', 'Montag. Ich lade\nnoch …'],
  lunch: ['Mahlzeit!', 'Mittagspause?\nDer Server wartet.', 'Hunger.\nZeit für Pizza-Patch.'],
  friday: ['Fast Wochenende!', 'Freitag!\nHeute nichts deployen.', 'Freitag-Modus:\naktiviert.'],
  weekend: ['Wochenende –\nund trotzdem hier?', 'Samstagsschicht?\nRespekt.', 'Ruhig heute.\nNur wir zwei.'],
  late: ['Noch am Rechner?\nDenk an den Feierabend.', 'Es ist spät.\nMorgen ist auch\nnoch ein Tag.'],
  heat: ['Puh, warm heute.\nDenk ans Trinken!', 'Ventilator-Modus:\nan.', 'Heiß hier.\nDer Serverraum lacht.'],

  // Arbeitstag und Pausen
  care: {
    workstart: ['Moin!', 'Guten Morgen!', 'Los geht\'s!'],
    stand:     ['Zeit zum Aufstehen!\nStehtisch hoch?', 'Lange gesessen.\nKurz die Beine\nvertreten!', 'Aufstehen, strecken,\nweiterhacken!'],
    eyesStart: ['Augenpause! 20 Sek.\nin die Ferne schauen.', 'Bildschirmpause:\nkurz aus dem Fenster\ngucken.'],
    eyesEnd:   ['Danke! Augen\nwieder frisch.', 'Weiter geht\'s.'],
    water:     ['Schluck Wasser?\nDer Kopf braucht\nKühlung.', 'Trinken nicht\nvergessen!'],
    end:       ['{h} Stunden geschafft.\nFeierabend?', 'Soll erfüllt!\nCommit, Push,\nFeierabend.'],
    // 1.10: Sperr-Erinnerung, Kurze Frage, Start-Checkliste
    lockhint:  ['Du warst {min} Min. weg –\nder Bildschirm war offen.\nWin+L sperrt ihn.', 'Willkommen zurück!\nNächstes Mal: Win+L.\nDann liest keiner mit.'],
    locked:    ['Gesperrt beim Weggehen.\nVorbildlich!', 'Win+L-Profi!\nSo bleibt alles sicher.'],
    pulse:     ['Kurze Frage deiner IT?\nDauert 10 Sekunden.', 'Wie läuft dein PC?\nDeine IT fragt kurz.'],
    pulseThanks: ['Danke fürs Feedback!', 'Notiert. Danke!'],
    onboardDone: ['Start-Checkliste komplett!\nWillkommen an Bord.', 'Alles eingerichtet.\nDu bist startklar!']
  },

  // System-Wächter ({…} wird ersetzt)
  sys: {
    offline:      ['Internet weg!\nIch prüf die Kabel.', 'Kein Netz.\nEs ist bestimmt DNS.', 'Offline!\nRouter neu starten?'],
    online:       ['Internet ist zurück!', 'Wieder online.\n{minutes} Min. Funkstille.'],
    vpn_down:     ['VPN getrennt!\nVorsicht im\nKundennetz.', 'Tunnel zu.\nVPN ist weg.'],
    vpn_up:       ['VPN steht.\nTunnel offen.', 'VPN verbunden:\n{name}'],
    disk:         ['Laufwerk {drive} fast voll!\nNur noch {gb} GB frei.', '{drive} läuft voll.\nZeit zum Aufräumen!'],
    cpu:          ['CPU bei {pct} %!\nDer Lüfter weint.', 'Wer rechnet hier\nso viel? CPU {pct} %'],
    ram:          ['RAM bei {pct} %!\nZu viele Tabs?', 'Arbeitsspeicher voll.\nChrome wieder?'],
    reboot:       ['Windows will neu\nstarten. Updates\nwarten!', 'Neustart ausstehend.\nPatchen wir das?'],
    uptime:       ['PC läuft seit {days}\nTagen. Mal neu\nstarten?', 'Uptime {days} Tage.\nRespekt – aber\nneu starten hilft.'],
    battery_low:  ['Akku bei {pct} %!\nNetzteil?', 'Strom wird knapp:\n{pct} %'],
    battery_crit: ['Akku {pct} %!\nGleich ist Schluss!', 'Notstrom! {pct} %\nSchnell speichern!'],
    charging:     ['Danke für\nden Strom!', 'Akku lädt.\nPuh.'],
    // IT-Lage: öffentlicher Microsoft-/Azure-Status und Datenlecks
    cloud_down:   ['Störung bei Microsoft:\n{name}', '{name} hakt gerade.\nNicht dein PC!', 'Microsoft meldet:\n{name} – {status}'],
    cloud_ok:     ['{name} läuft\nwieder rund.', 'Entwarnung:\n{name} ist zurück.'],
    azure:        ['Azure-Störung:\n{title}', 'Azure meldet:\n{title}'],
    azure_many:   ['Azure hat gerade\n{count} Störungen!', 'Viel los bei Azure:\n{count} Meldungen.'],
    breach_new:   ['Neues Datenleck:\n{title}', 'Leak bei {title}!\nPasswort dort ändern?'],
    advisory:     ['Neue Warnung ({sev}):\n{title}', 'Sicherheitslücke!\n{title}', 'CERT meldet ({sev}):\n{title}'],
    advisory_crit:['KRITISCH!\n{title}', 'Kritische Lücke!\n{title}\nSchnell patchen!'],
    advisory_many:['{count} neue\nSicherheitswarnungen!', 'Viel los beim CERT:\n{count} Warnungen.'],
    leak:         ['Achtung! {mail}\nsteckt in einem Leak:\n{title}', 'Deine Adresse {mail}\nist geleakt!\nPasswort ändern!'],
    // Gerätezustand (1.5)
    health_bitlocker:      ['Dein Laufwerk C:\nist nicht verschlüsselt!\nBitte der IT melden.', 'BitLocker ist aus.\nGeht der Laptop verloren,\nsind die Daten offen.'],
    health_bitlocker_wait: ['BitLocker wartet\nauf Aktivierung.\nKurz die IT fragen?'],
    health_av:             ['Kein Virenschutz aktiv!\nBitte sofort\nder IT melden.', 'Virenschutz aus!\nDas ist gar nicht gut.'],
    health_av_old:         ['Virenschutz hat\nalte Signaturen.\nWindows-Sicherheit\nprüfen?'],
    health_fw:             ['Die Firewall ist aus!\nBitte der IT melden.'],
    health_updates:        ['Seit {days} Tagen\nkein Windows-Update.\nMal nachsehen?', 'Windows ist {days} Tage\nnicht aktualisiert.\nUpdates prüfen?']
  },

  // Frag Sudo (Claude): nachdenken und fertig
  askThink: ['Hmm …\nich frag mein\nNinja-Gehirn.', 'Moment …\nich denke nach.', 'Recherche läuft …', 'Kurz meditieren …\nAntwort kommt.'],
  askDone:  ['Antwort ist da!', 'Bitte schön!', 'Erledigt. Ninja-Wissen!'],

  // Webseiten im Browser (Erkennung über den Fenstertitel, nur lokal) – Sprüche zu den Aktivitäten
  site: {
    video:  ['Fernsehabend!\nIch hol Popcorn.', 'Ooh, ein Video!\nIch guck mit.', 'Nur eine Folge,\nversprochen?'],
    music:  ['Musik an!\nNinja-Dance!', 'Der Beat ist gut.\nIch tanz mal.', 'Ohrwurm-Alarm!'],
    shop:   ['Shopping?\nIch nehm das Paket!', 'In den Warenkorb …\noder doch nicht?', 'Paket für dich!\nFast.'],
    ai:     ['Grüß die KI\nvon mir!', 'Wir KIs müssen\nzusammenhalten.', 'Ich tipp mal mit.\nKollegial.'],
    news:   ['Extrablatt!\nWas gibt\'s Neues?', 'News-Zeit.\nIch les mit.', 'Patch-News?\nHer damit.'],
    social: ['Nur kurz scrollen,\nja?', 'Doomscrolling?\nIch zähl mit.'],
    maps:   ['Wohin geht\'s?\nIch komm mit!', 'Route berechnet.\nNinja-Style.'],
    wiki:   ['Wikipedia-Loch?\nNoch ein Artikel …', 'Wissen tanken!']
  },

  // Besuche von Kollegen-Sudos (1.4); {from} = Absender, {to} = besuchter Kollege
  visit: {
    tag:       'Sudo von {from}',
    hello:     ['Moin! Grüße von {from}!', 'Klopf klopf!\n{from} schickt mich.', 'Hallo Nachbar!\nSchöne Grüße von {from}.'],
    welcome:   ['Oh, Besuch!', 'Huch! Hallo!', 'Ein Kollege!'],
    note:      ['Hab dir was hingeklebt!', 'Post-it für dich!'],
    gift:      { coffee: ['Kaffee für dich!\nFrisch gebrüht.', 'Koffein-Lieferung!'], duck: ['Eine Gummiente!\nFür Rubber-Duck-Debugging.', 'Quietsch!'], pizza: ['Pizza-Lieferdienst!', 'Ein Stück für dich!'] },
    party:     ['Party!', 'Konfetti-Alarm!'],
    partyHost: ['Juhu!', 'Party im Büro!'],
    bug:       ['Viel Spaß beim Jagen!\nHehe.', 'Ups … die sind\nmir entwischt.'],
    duelStart: ['Duell!\nZieh dein Katana!', 'Ich fordere dich\nheraus!'],
    duelWon:   ['Gewonnen gegen\nden Sudo von {from}!\n+10 XP', 'Sieg! {from} schuldet\nmir einen Kaffee.'],
    duelLost:  ['Verloren …\nRevanche, {from}!', 'Autsch.\nNächstes Mal!'],
    duelGuestWon:  ['Ninja-Sieg!', 'Zu langsam!'],
    duelGuestLost: ['Argh!\nRevanche!', 'Gut gekämpft!'],
    bye:       ['Tschüss!', 'Bis bald!', 'Ninja-Abgang!'],
    away:      ['Bin mal kurz\nbei {to}!', 'Auf zu {to}!\nGleich zurück.'],
    resultWon: ['Duell bei {to}\ngewonnen! +10 XP', 'Sieg bei {to}!\nShuriken-Profi.'],
    resultLost:['Duell bei {to}\nverloren …', '{to} war\nheute stärker.'],
    resultDone:['{to} hat sich\ngefreut!', 'Mission bei {to}\nerfüllt.'],
    keepTip:   'Von {from} – Klick zum Wegräumen',
    keepThanks:['Danke!', 'Lecker!', 'Nett von dir!']
  },

  // Nach einem Meeting
  deck: {
    go:    ['{name}?\nKommt sofort!', 'Ninja-Sprint\nzu {name}!', 'Ausführen!', 'sudo start {name}'],
    admin: ['Mit Admin-Rechten!\nBitte bestätigen.', 'Root-Modus!\nUAC abnicken.'],
    fail:  ['Hm, {name} will\nnicht starten.', '{name}?\nNicht gefunden …'],
    hint:  ['Tipp: Mausrad auf\nmich drücken =\nNinja-Leiste!']
  },
  quiz: {
    offer: ['Kurzes Security-Quiz?\n30 Sekunden!', 'Lust auf eine\nSicherheitsfrage?', 'Ninja-Prüfung:\nErkennst du Phishing?'],
    pushed: ['Deine IT hat eine\nQuizfrage für dich!'],
    right: ['Richtig!\nSecurity-Ninja!', 'Korrekt!\nPhisher hassen dich.', 'Stark! +10 XP'],
    wrong: ['Knapp daneben.\nNächstes Mal!', 'Gut, dass es\nnur ein Quiz war.']
  },
  meetingEnd: ['Meeting vorbei!\nKaffee?', 'Geschafft!\nWer schreibt Protokoll?', 'Und? Hätte das\neine Mail sein können?'],

  // Kommentare zu Programmen (Stichwort kommt aus main.js)
  apps: {
    vscode:        ['VS Code!\nJetzt wird\'s ernst.', 'Ich halt dir\nden Linter warm.', 'Code-Zeit.\nIch bin leise.'],
    jetbrains:     ['PhpStorm!\nMein Element.', 'Indizieren …\nwir warten alle.'],
    terminal:      ['Konsole auf!\nIch schau nur zu.', 'Kein rm -rf,\nversprochen?', 'Get-Help ist\ndein Freund.'],
    outlook:       ['Postfach-Zeit.\nIch warte draußen.', 'Inbox Zero?\nIch glaub an dich.'],
    teams:         ['Meeting?\nIch bin auf stumm.', 'Kamera aus,\nHoodie an.'],
    excel:         ['SVERWEIS oder\nXVERWEIS?', 'Pivot-Tabellen!\nRespekt.'],
    word:          ['Doku schreiben?\nHeldenhaft.'],
    rdp:           ['Grüß den Server\nvon mir!', 'Remote-Session.\nFinger weg vom\nHerunterfahren!'],
    taskmgr:       ['Wer frisst hier\ndie CPU?'],
    regedit:       ['Registry …\nganz vorsichtig.', 'Vorher Backup\ngemacht?'],
    ftp:           ['FTP? Retro!', 'Dateien schubsen.\nIch mag das.'],
    ssh:           ['SSH-Tunnel.\nNinja-Style.'],
    notepad:       ['Notepad?\nMutig.'],
    steam:         ['Feierabend?\nIch spiel mit!'],
    music:         ['Musik an,\nFokus an.'],
    mmc:           ['Snap-ins!\nOldschool-Admin.'],
    claude:        ['Grüß Claude\nvon mir!'],
    stackoverflow: ['Stack Overflow?\nIch sag nix.', 'Copy & Paste\nmit Verstand!'],
    github:        ['GitHub!\nPush it.'],
    youtube:       ['Nur ein Video,\nversprochen?'],
    m365admin:     ['Admin-Center?\nIch halt die Rechte.', 'Bitte erst testen,\ndann für alle.'],
    powerpoint:    ['Folien bauen?\nMax. 3 Bulletpoints!', 'Präsi-Zeit.\nIch mach den Laserpointer.'],
    onenote:       ['OneNote!\nNotizen sind Gold.'],
    access:        ['Access?\nRespekt, Veteran.'],
    visio:         ['Visio!\nNetzplan oder Kunst?'],
    project:       ['Projektplan?\nPuffer einplanen!'],
    powerbi:       ['Power BI!\nZahlen werden schön.'],
    copilot:       ['Copilot?\nKollege KI ist da.', 'Copilot fragen,\ndann selbst prüfen.'],
    onedrive:      ['OneDrive.\nSync läuft?'],
    sharepoint:    ['SharePoint!\nBerechtigungen prüfen\nnicht vergessen.', 'Wo war die Datei\nnoch mal …?'],
    todo:          ['To-do-Liste!\nIch hak mit ab.'],
    planner:       ['Planner!\nWer hat welche Karte?'],
    loop:          ['Loop!\nModerne Zettelwirtschaft.'],
    forms:         ['Umfrage? Ich klick\nimmer „sehr gut“.'],
    bookings:      ['Bookings!\nTermine ohne\nPing-Pong-Mails.'],
    powerautomate: ['Power Automate!\nRoboter-Kollegen.', 'Flow kaputt?\nIst immer der Trigger.'],
    powerapps:     ['Power Apps!\nLow-Code-Ninja.'],
    exchangeadmin: ['Exchange-Admin!\nPostfachrechte?', 'Transportregel?\nVorsichtig testen.'],
    intuneadmin:   ['Intune! iPhones\nim Griff?', 'Richtlinie ändern?\nErst Testgruppe!'],
    entraadmin:    ['Entra! MFA und\nConditional Access?', 'Gastkonten mal\naufräumen?'],
    defender:      ['Defender!\nAlles grün?', 'Vorfälle? Ich zieh\ndas Katana.'],
    purview:       ['Purview!\nCompliance-Ninja.', 'Aufbewahrung\nrichtig eingestellt?'],
    teamsadmin:    ['Teams-Admin!\nRichtlinien-Zeit.'],
    spadmin:       ['SharePoint-Admin!\nFreigaben extern?'],
    azure:         ['Azure!\nKosten im Blick?', 'Ressourcengruppe\nrichtig benannt?'],
    zoom:          ['Zoom?\nKamera-Check!'],
    phpmyadmin:    ['phpMyAdmin!\nWHERE nicht vergessen.'],
    browser:       ['Nur kurz googeln,\nja?'],
    aws:           ['AWS?\nFremdgehen bei\nder Cloud?', 'Kosten-Explorer\nim Blick?']
  }
};

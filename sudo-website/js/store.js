// store.js – Skin-Galerie (1.14): zeigt die Skins aus skins/katalog.js mit der Stand-Pose.
// „Im Sudo ansehen“ öffnet über den Link sudo-ninja://store/<id> den Skin-Store im installierten Sudo – gekauft wird dort mit XP.
(() => {
  'use strict';
  const grid = document.getElementById('store-grid');
  const list = Array.isArray(window.SUDO_SKINS) ? window.SUDO_SKINS : [];
  if (!grid || !list.length) return;
  const CELL = [48, 52];          // Standard-Raster der Sudo-Grafik, Stand-Pose oben links
  for (const s of list) {
    const li = document.createElement('li');
    const c = document.createElement('canvas');
    c.width = CELL[0]; c.height = CELL[1];
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Sudo als ' + s.name);
    const img = new Image();
    img.onload = () => { const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, CELL[0], CELL[1], 0, 0, CELL[0], CELL[1]); };
    img.src = 'skins/' + encodeURIComponent(s.id) + '.png';
    const name = document.createElement('b'); name.textContent = s.name;
    const price = document.createElement('span'); price.className = 'price';
    price.textContent = s.price ? s.price + ' XP' : 'kostenlos';
    const a = document.createElement('a'); a.className = 'btn';
    if (s.download) { a.href = 'skins/' + encodeURIComponent(s.download); a.setAttribute('download', ''); a.textContent = 'Herunterladen'; }
    else { a.href = 'sudo-ninja://store/' + encodeURIComponent(s.id); a.textContent = 'Im Sudo ansehen'; }
    li.append(c, name, price, a);
    grid.append(li);
  }
})();

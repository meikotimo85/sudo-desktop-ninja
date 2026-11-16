// sprite.js – Sudo als Pixel-Grafik (24 × 26 Raster), wird per Code gezeichnet.
// Funktioniert im Browser (globales SudoSprite) und in Node (module.exports) für die Icon-Erzeugung.
(function (root) {
  'use strict';
  const C = {OL:'#0b0d12',HD:'#2a2f3b',HDs:'#1c2029',HDl:'#3c4456',SK:'#f0c49a',SKd:'#cf9d73',MK:'#16181f',
    TE:'#25d3d0',TEd:'#13908d',TEl:'#9af6f3',GR:'#8a93a3',GRd:'#555d6b',EY:'#ffffff',PU:'#0b0d12',
    PA:'#171a21',PAd:'#101217',ST:'#cfd5df',LAP:'#3a404c',SCR:'#5ef0ff',KAT:'#9ff9ff',KATd:'#1fa6ba'};
  const TAILS = [
    [[3,5],[2,5],[1,4],[0,4],[3,6],[2,7],[1,7],[0,8]],
    [[3,5],[2,4],[1,4],[0,5],[3,6],[2,6],[1,7],[0,7]],
    [[3,5],[2,5],[1,5],[0,4],[3,6],[2,7],[1,8],[0,8]],
    [[3,5],[2,4],[1,5],[0,5],[3,6],[2,6],[1,6],[0,7]]];
  const SITTING = new Set(['type','book','snake','meditate','sleep']);
  const DEF_EYES = {facepalm:'closed',thumb:'happy',victory:'happy',alarm:'wide',throw:'determined',coffee:'happy',
    snake:'determined',meditate:'closed',sleep:'closed',carried:'wide',sus:'side',crouch:'determined',jump:'open'};

  function create(g) {
    const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    function eyes(o, e) {
      switch (e) {
        case 'closed': R(11,8+o,2,1,C.PU); R(14,8+o,2,1,C.PU); break;
        case 'happy': R(10,8+o,1,1,C.PU); R(11,7+o,1,1,C.PU); R(12,8+o,1,1,C.PU);
                      R(14,8+o,1,1,C.PU); R(15,7+o,1,1,C.PU); R(16,8+o,1,1,C.PU); break;
        case 'wide': R(10,6+o,3,3,C.EY); R(11,7+o,1,1,C.PU); R(14,6+o,3,3,C.EY); R(15,7+o,1,1,C.PU); break;
        case 'side': R(11,7+o,2,2,C.EY); R(11,7+o,1,2,C.PU); R(14,7+o,2,2,C.EY); R(14,7+o,1,2,C.PU);
                     R(11,7+o,2,1,C.SKd); R(14,7+o,2,1,C.SKd); break;
        case 'determined': R(11,7+o,2,2,C.EY); R(12,7+o,1,2,C.PU); R(14,7+o,2,2,C.EY); R(15,7+o,1,2,C.PU);
                     R(11,6+o,2,1,C.OL); R(14,6+o,2,1,C.OL); break;
        default: R(11,7+o,2,2,C.EY); R(12,7+o,1,2,C.PU); R(14,7+o,2,2,C.EY); R(15,7+o,1,2,C.PU);
      }
    }
    function head(o, e, tf) {
      TAILS[tf % 4].forEach(([x, y], i) => R(x, y + o, 1, 1, i % 4 === 3 ? C.TEd : C.TE));
      R(4,5+o,2,2,C.TEd);
      R(7,2+o,10,1,C.OL); R(6,3+o,1,1,C.OL); R(17,3+o,1,1,C.OL);
      R(5,4+o,1,9,C.OL); R(18,4+o,1,9,C.OL); R(6,13+o,1,1,C.OL); R(17,13+o,1,1,C.OL);
      R(7,3+o,10,1,C.HD); R(6,4+o,12,9,C.HD); R(7,13+o,10,1,C.HD);
      R(8,3+o,5,1,C.HDl); R(7,4+o,1,2,C.HDl);
      R(9,6+o,1,6,C.OL); R(10,12+o,7,1,C.OL);
      R(10,6+o,7,3,C.SK); R(10,9+o,7,3,C.MK); R(11,10+o,4,1,'#23262f');
      R(6,5+o,12,1,C.TE); R(7,5+o,3,1,C.TEl);
      R(8,1+o,6,1,C.GRd); R(8,2+o,1,3,C.GRd);
      R(4,7+o,1,4,C.OL); R(5,6+o,3,1,C.OL); R(5,11+o,3,1,C.OL); R(8,7+o,1,4,C.OL);
      R(5,7+o,3,4,C.GR); R(6,8+o,1,2,C.GRd);
      eyes(o, e);
    }
    function torso(b, belt) {
      R(7,14+b,1,6,C.OL); R(16,14+b,1,6,C.OL); R(8,14+b,8,6,C.HD); R(8,14+b,8,1,C.HDs);
      R(8,18+b,8,1,C.HDs); R(8,19+b,8,1,belt); R(11,15+b,1,2,C.ST); R(13,15+b,1,2,C.ST); R(10,17+b,4,1,C.HDs);
    }
    function legs(p, f) {
      const P = C.PA, D = C.PAd, O = C.OL;
      switch (p) {
        case 'walk': {
          const k = f % 4;
          if (k === 0 || k === 2) { const a = k === 0 ? P : D, b = k === 0 ? D : P;
            R(8,20,2,3,b); R(14,20,2,3,a); R(8,23,3,1,O); R(14,23,3,1,O); }
          else if (k === 1) { R(10,20,2,3,P); R(12,20,2,2,D); R(10,23,3,1,O); R(12,22,3,1,O); }
          else { R(12,20,2,3,P); R(10,20,2,2,D); R(12,23,3,1,O); R(10,22,3,1,O); }
          break; }
        case 'jump': R(9,20,2,2,D); R(13,20,2,2,P); R(9,22,3,1,O); R(13,22,3,1,O); break;
        case 'carried': { const w = f % 2;
          R(8,20,2,3,D); R(14,20,2,3,P); R(7-w,23,3,1,O); R(15+w,23,3,1,O); break; }
        case 'crouch': R(8,22,3,1,P); R(13,22,3,1,P); R(7,23,4,1,O); R(13,23,4,1,O); break;
        case 'throw': R(7,20,2,3,D); R(15,20,2,3,P); R(6,23,3,1,O); R(15,23,3,1,O); break;
        case 'sit': R(6,22,12,2,P); R(8,23,8,1,D); R(5,23,1,1,O); R(18,23,1,1,O); break;
        default: R(9,20,2,3,D); R(13,20,2,3,P); R(9,23,3,1,O); R(13,23,3,1,O);
      }
    }
    function armsUp(b, lo) {
      const y = lo ? 2 : 0;
      R(5,14+b,2,2,C.HDs); R(17,14+b,2,2,C.HD);
      R(3,9+b+y,2,6-y,C.HDs); R(3,7+b+y,2,2,C.MK);
      R(19,9+b+y,2,6-y,C.HD); R(19,7+b+y,2,2,C.MK);
    }
    const backArm = b => { R(5,15+b,1,4,C.OL); R(6,15+b,2,4,C.HDs); R(6,19+b,2,1,C.MK); };
    const frontArm = b => { R(17,15+b,1,4,C.OL); R(15,15+b,2,4,C.HD); R(15,19+b,2,1,C.MK); };

    function draw(p, f, tf, belt, eye) {
      if (g.clearRect) g.clearRect(0, 0, 24, 26);
      const sit = SITTING.has(p);
      let b = sit || p === 'crouch' ? 2 : 0;
      if (p === 'walk' && f % 2 === 1) b = -1;
      const ho = b + (p === 'sleep' ? 1 : 0);
      const e = eye || DEF_EYES[p] || 'open';
      R(2,10+b,2,1,C.KAT); R(3,11+b,2,2,C.KATd); R(4,13+b,1,1,C.KATd);
      const up = p === 'victory' || p === 'alarm' || p === 'carried' || p === 'jump';
      if (!up && p !== 'throw' && p !== 'meditate') backArm(b);
      legs(sit ? 'sit' : p, f);
      torso(b, belt);
      if (p === 'throw') { R(3,15,4,2,C.HDs); R(2,15,1,2,C.MK); }
      head(ho, e, tf);
      switch (p) {
        case 'type':
          R(15,22,8,1,C.LAP); R(22,15,1,8,C.LAP); R(21,16,1,5,C.SCR);
          R(14,20,5,2,C.HD); R(19,21-(f%2),2,1,C.MK); R(17,21-((f+1)%2),2,1,'#0f1116'); break;
        case 'book': R(14,20,3,2,C.HD); R(16,16,5,6,'#d6453d'); R(16,16,1,6,'#9e2f29'); R(17,18,3,1,'#f5e6c8'); R(15,21,2,1,C.MK); break;
        case 'snake': R(14,20,3,2,C.HD); R(16,17,3,4,'#23302a'); R(16,18,3,2,'#9be15d'); R(16+(f%3),18,1,1,'#2d4a1a'); R(15,21,2,1,C.MK); break;
        case 'meditate': R(5,20,2,2,C.HDs); R(4,21,2,1,C.MK); R(17,20,2,2,C.HD); R(18,21,2,1,C.MK); break;
        case 'facepalm': R(16,10,2,6,C.HD); R(18,10,1,6,C.OL); R(11,7,6,2,C.MK); R(15,9,2,1,C.MK); break;
        case 'thumb': R(17,11,2,5,C.HD); R(19,11,1,5,C.OL); R(17,9,3,2,C.MK); R(18,7,1,2,C.MK); break;
        case 'throw': R(16,15,6,2,C.HD); R(22,15,2,2,C.MK); break;
        case 'coffee': R(15,16,3,2,C.HD); R(17,13,3,4,'#eef0f3'); R(17,13,3,1,'#6b4226'); R(20,14,1,2,'#eef0f3'); R(16,15,1,2,C.MK); break;
        case 'sus': R(15,14,2,3,C.HD); R(14,12,3,2,C.MK); break;
        case 'crouch': R(15,18,4,2,C.HD); R(19,18,2,2,C.MK); break;
        case 'victory': case 'alarm': case 'carried': armsUp(b, false); break;
        case 'jump': armsUp(b, true); break;
        default: frontArm(b);
      }
    }
    return { draw };
  }

  const api = { create, DEF_EYES, W: 24, H: 26 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SudoSprite = api;
})(typeof window !== 'undefined' ? window : globalThis);

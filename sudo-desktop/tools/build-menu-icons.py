# build-menu-icons.py – zeichnet die Pixel-Icons für das Tray-Menü (assets/menu/*.png, 16 px und @2x 32 px).
# Aufruf: python tools/build-menu-icons.py   (braucht Pillow)
# Jedes Icon ist 12 × 12 Pixel mit 2 Pixel Rand. Dunkler Umriss + farbige Füllung, damit es im hellen
# und im dunklen Windows-Menü erkennbar bleibt. Keine Emojis.
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'menu')
PAL = {'K': (31, 36, 48), 'T': (37, 211, 208), 'D': (21, 127, 125), 'Y': (244, 208, 63), 'O': (232, 169, 58), 'R': (229, 72, 77),
       'G': (60, 207, 122), 'B': (91, 141, 239), 'N': (47, 111, 214), 'S': (184, 194, 207), 'W': (238, 241, 245), 'P': (241, 196, 160),
       'M': (120, 130, 148), 'V': (156, 110, 230)}

ICONS = {
  'screen': ['KKKKKKKKKKKK', 'KBBBBBBBBBBK', 'KBWWBBBBBBBK', 'KBWBBBBBBBBK', 'KBBBBBBBBBBK', 'KBBBBBBBBBBK', 'KBBBBBBBBBBK',
             'KKKKKKKKKKKK', '.....KK.....', '.....KK.....', '...KKKKKK...', '...KSSSSK...'],
  'note':   ['KKKKKKKKKK..', 'KYYYYYYYYK..', 'KYKKKKKKYK..', 'KYYYYYYYYK..', 'KYKKKKKYYK..', 'KYYYYYYYYK..', 'KYKKKKKKYK..',
             'KYYYYYYYYK..', 'KYKKKYYYOK..', 'KYYYYYYOOK..', 'KKKKKKKKK...', '............'],
  'ask':    ['..KKKKKKKK..', '.KTTTTTTTTK.', 'KTTTWWWWTTTK', 'KTTWTTTTWTTK', 'KTTTTTTWTTTK', 'KTTTTTWTTTTK', 'KTTTTTTTTTTK',
             '.KTTTTWTTTK.', '..KKTTKKKK..', '..KTTK......', '.KTK........', '.KK.........'],
  'visit':  ['..KKKKKKKK..', '..KOOOOOOK..', '..KODDDDOK..', '..KODOODOK..', '..KODOODOK..', '..KOOOOOOK..', '..KOOOOYYK..',
             '..KOOOOYYK..', '..KOOOOOOK..', '..KOOOOOOK..', 'KKKKKKKKKKKK', 'KSSSSSSSSSSK'],
  'lage':   ['.KKKKKKKKKK.', 'KTTTTTTTTTTK', 'KTTTTWWTTTTK', 'KTTTTWWTTTTK', 'KTWWWWWWWWTK', 'KTWWWWWWWWTK', 'KTTTTWWTTTTK',
             '.KTTTWWTTTK.', '.KTTTTTTTTK.', '..KTTTTTTK..', '...KTTTTK...', '....KKKK....'],
  'quiz':   ['..KKKKKKKK..', '.KYYYYYYYYK.', 'KYYYKKKKYYYK', 'KYYKYYYYKYYK', 'KYYYYYYYKYYK', 'KYYYYYYKYYYK', 'KYYYYYKYYYYK',
             'KYYYYYKYYYYK', 'KYYYYYYYYYYK', 'KYYYYYKYYYYK', '.KYYYYYYYYK.', '..KKKKKKKK..'],
  'help':   ['............', '.KKKKKKKKKK.', 'KWWWWRRWWWWK', 'KWWWWRRWWWWK', 'KWWWWRRWWWWK', 'KWRRRRRRRRWK', 'KWRRRRRRRRWK',
             'KWWWWRRWWWWK', 'KWWWWRRWWWWK', 'KWWWWRRWWWWK', '.KKKKKKKKKK.', '............'],
  'bell':   ['.....KK.....', '....KYYK....', '...KYYYYK...', '..KYYYYYYK..', '..KYYWYYYK..', '..KYYWYYYK..', '..KYYYYYYK..',
             '.KYYYYYYYYK.', 'KYYYYYYYYYYK', 'KKKKKKKKKKKK', '....KOOK....', '.....KK.....'],
  'tools':  ['....KKKK....', '...KK..KK...', '...K....K...', 'KKKKKKKKKKKK', 'KRRRRRRRRRRK', 'KRRRRRRRRRRK', 'KKKKKSSKKKKK',
             'KRRRRSSRRRRK', 'KRRRRRRRRRRK', 'KRRRRRRRRRRK', 'KRRRRRRRRRRK', 'KKKKKKKKKKKK'],
  'music':  ['......KKKKKK', '......KVVVVK', '......KVKKKK', '......KVK...', '......KVK...', '......KVK...', '......KVK...',
             '...KKKKVK...', '..KVVVVVK...', '..KVVVVVK...', '..KVVVVK....', '...KKKK.....'],
  'history': ['.KKKKKKKKKK.', 'KWWWWWWWWWWK', 'KWKKKKKKKKWK', 'KWWWWWWWWWWK', 'KWKKKKKKWWWK', 'KWWWWWWWWWWK', 'KWKKKKKWWWWK',
             'KWWWWWWWWWWK', '.KKKWWKKKKK.', '...KWK......', '...KK.......', '...K........'],
  'book':   ['............', 'KKKKK..KKKKK', 'KBBBBKKTTTTK', 'KBWWBBKTWWTK', 'KBBBBBKTTTTK', 'KBWWWBKTWWTK', 'KBBBBBKTTTTK',
             'KBWWBBKTWWTK', 'KBBBBBKTTTTK', 'KKKKKKKKKKKK', '.....KK.....', '............'],
  'skin':   ['....KKKKK...', '..KKYYYYYKK.', '.KYYRRYYYYYK', 'KYYRRYYTTYYK', 'KYYYYYYTTYYK', 'KYGGYYYYYYK.', 'KYGGYYYKKK..',
             'KYYYYYK.....', 'KYYBBYYK....', '.KYBBYYYK...', '..KKYYYYK...', '....KKKK....'],
  'stats':  ['............', '........KKK.', '........KGK.', '........KGK.', '....KKK.KGK.', '....KGK.KGK.', '....KGK.KGK.',
             'KKK.KGK.KGK.', 'KGK.KGK.KGK.', 'KGK.KGK.KGK.', 'KKKKKKKKKKKK', '............'],
  'work':   ['...KKKKKK...', '..KSSSSSSK..', '.KSSSSKSSSK.', 'KSSSSSKSSSSK', 'KSSSSSKSSSSK', 'KSSSSSKSSSSK', 'KSSSSSKKKKSK',
             'KSSSSSSSSSSK', 'KSSSSSSSSSSK', '.KSSSSSSSSK.', '..KSSSSSSK..', '...KKKKKK...'],
  'wardrobe': ['............', '...KKKKKK...', '..KTTTTTTK..', '..KTTTTTTK..', '..KTTTTTTK..', '..KTTTTTTK..', '..KTTTTTTK..',
             '..KDDDDDDK..', 'KKKKKKKKKKKK', 'KTTTTTTTTTTK', 'KKKKKKKKKKKK', '............'],
  'play':   ['...KKKKKK...', '..KOOOOOOK..', '.KOOWWOOOOK.', 'KOOWOOOOOOOK', 'KOOOOOOOOOOK', 'KRRRRRRRRRRK', 'KRRRRRRRRRRK',
             'KOOOOOOOOOOK', 'KOOOOOOOOOOK', '.KOOOOOOOOK.', '..KOOOOOOK..', '...KKKKKK...'],
  'home':   ['.....KK.....', '....KRRK....', '...KRRRRK...', '..KRRRRRRK..', '.KRRRRRRRRK.', 'KKKKKKKKKKKK', '.KSSSSSSSSK.',
             '.KSBBSSSSSK.', '.KSBBSKKKSK.', '.KSSSSKOKSK.', '.KSSSSKOKSK.', '.KKKKKKKKKK.'],
  'gear':   ['....KKKK....', '.KK.KSSK.KK.', '.KSKKSSKKSK.', '..KSSSSSSK..', 'KKKSSKKSSKKK', 'KSSSK..KSSSK', 'KSSSK..KSSSK',
             'KKKSSKKSSKKK', '..KSSSSSSK..', '.KSKKSSKKSK.', '.KK.KSSK.KK.', '....KKKK....'],
  'privacy': ['....KKKK....', '...KMMMMK...', '..KMK..KMK..', '..KMK..KMK..', '..KMK..KMK..', 'KKKKKKKKKKKK', 'KYYYYYYYYYYK',
             'KYYYYKKYYYYK', 'KYYYYKKYYYYK', 'KYYYYYKYYYYK', 'KYYYYYYYYYYK', 'KKKKKKKKKKKK'],
  'info':   ['...KKKKKK...', '..KBBBBBBK..', '.KBBBWWBBBK.', 'KBBBBWWBBBBK', 'KBBBBBBBBBBK', 'KBBBWWWBBBBK', 'KBBBBWWBBBBK',
             'KBBBBWWBBBBK', 'KBBBBWWBBBBK', '.KBBWWWWBBK.', '..KBBBBBBK..', '...KKKKKK...'],
  'update': ['....KKKK....', '....KGGK....', '....KGGK....', '....KGGK....', '.KKKKGGKKKK.', '.KGGGGGGGGK.', '..KGGGGGGK..',
             '...KGGGGK...', '....KGGK....', 'KK...KK...KK', 'KSKKKKKKKKSK', 'KKKKKKKKKKKK'],
  'reload': ['...KKKKK.K..', '..KTTTTTKTK.', '.KTKKKKKTTK.', 'KTK....KTTK.', 'KTK...KKKKK.', 'KTK.........', 'KTK.........',
             'KTK....KTK..', '.KTKKKKKTK..', '..KTTTTTK...', '...KKKKK....', '............'],
  'quit':   ['.....KK.....', '..KK.KRK.KK.', '.KRK.KRK.KRK', 'KRK..KRK..KR', 'KRK..KRK..KR', 'KRK..KKK..KR', 'KRK.......KR',
             'KRK.......KR', '.KRK.....KRK', '..KRKKKKKRK.', '...KRRRRRK..', '....KKKKK...'],
}

def draw(rows, scale):
    im = Image.new('RGBA', (16 * scale, 16 * scale), (0, 0, 0, 0))
    px = im.load()
    for y, row in enumerate(rows):
        assert len(row) <= 12, (rows, row)
        for x, ch in enumerate(row):
            if ch in PAL:
                for dy in range(scale):
                    for dx in range(scale):
                        px[(x + 2) * scale + dx, (y + 2) * scale + dy] = PAL[ch] + (255,)
    return im

os.makedirs(OUT, exist_ok=True)
for name, rows in ICONS.items():
    assert len(rows) == 12, name
    draw(rows, 1).save(os.path.join(OUT, name + '.png'))
    draw(rows, 2).save(os.path.join(OUT, name + '@2x.png'))
# „Sudo rufen“: Sudos Kopf aus dem Tray-Symbol
tray = Image.open(os.path.join(os.path.dirname(__file__), '..', 'assets', 'tray.png')).convert('RGBA')
tray.resize((16, 16), Image.NEAREST).save(os.path.join(OUT, 'summon.png'))
tray.resize((32, 32), Image.NEAREST).save(os.path.join(OUT, 'summon@2x.png'))
# Übersicht zum Anschauen (hell und dunkel)
names = ['summon'] + list(ICONS)
sheet = Image.new('RGBA', (len(names) * 40 + 8, 88), (0, 0, 0, 0))
for bg, y0 in [((43, 43, 43, 255), 0), ((249, 249, 249, 255), 44)]:
    sheet.paste(Image.new('RGBA', (sheet.width, 44), bg), (0, y0))
    for i, n in enumerate(names):
        ic = Image.open(os.path.join(OUT, n + '@2x.png'))
        sheet.alpha_composite(ic, (8 + i * 40, y0 + 6))
sheet.save(os.path.join(OUT, '..', '..', 'tools', 'menu-icons-preview.png'))
print(len(names), 'Icons')

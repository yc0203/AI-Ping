from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1]
FONT = Path('C:/Windows/Fonts/msyhbd.ttc')
SCALE = 3
ITEMS = [
    ('explain', '解释这里', 'enemy_missing', '#f2c518'),
    ('plan', '给操作方案', 'assist_me', '#56d43c'),
    ('translate-screen', '截图翻译', 'need_vision', '#56d43c'),
    ('translate-selection', '划词翻译', 'omw', '#2e8bff'),
    ('capture', '仅截图', 'pingwheel_basicpingrender', '#2e8bff'),
]

def rgb(value):
    return tuple(bytes.fromhex(value.removeprefix('#')))

def label(text, color):
    w, h = 256*SCALE, 96*SCALE
    font = ImageFont.truetype(str(FONT), 29*SCALE)
    mask = Image.new('L', (w, h))
    draw = ImageDraw.Draw(mask)
    box = draw.textbbox((0, 0), text, font=font)
    x = (w - (box[2] - box[0])) / 2 - box[0]
    y = (h - (box[3] - box[1])) / 2 - box[1]
    draw.text((x, y), text, font=font, fill=255)
    c = rgb(color)
    out = Image.new('RGBA', (w, h))
    glow = Image.new('RGBA', (w, h), c + (0,))
    glow.putalpha(mask.filter(ImageFilter.GaussianBlur(4*SCALE)).point(lambda a: round(a*.65)))
    out.alpha_composite(glow)
    outline = Image.new('RGBA', (w, h), (5, 10, 15, 0))
    outline.putalpha(mask.filter(ImageFilter.MaxFilter(2*SCALE+1)))
    out.alpha_composite(outline)
    ink = Image.new('RGBA', (w, h))
    idraw = ImageDraw.Draw(ink)
    for py in range(h):
        t = max(0, min(1, (py-(y+box[1])) / (box[3]-box[1])))
        light = .87 - .40*t
        shade = tuple(round(v*(1-light) + 255*light) for v in c)
        idraw.line((0, py, w, py), fill=shade+(255,))
    ink.putalpha(mask)
    out.alpha_composite(ink)
    return out.resize((256, 96), Image.Resampling.LANCZOS)

ROOT.mkdir(parents=True, exist_ok=True)
records = []
sheet = Image.new('RGBA', (1400, 440), '#11191f')
sd = ImageDraw.Draw(sheet)
title_font = ImageFont.truetype(str(FONT), 30)
note_font = ImageFont.truetype(str(FONT), 16)
sd.text((42, 28), '原标记 + 功能文字', font=title_font, fill='#e7ddc2')
sd.text((42, 78), '透明 PNG · 图标保持原样 · 文字随标记出现和淡出', font=note_font, fill='#a7b6be')
for index, (slug, text, texture, color) in enumerate(ITEMS):
    image = label(text, color)
    image.save(ROOT / f'{slug}.png')
    cx = 140 + index*280
    # Preview renders the original asset unchanged, with a separate text layer beneath.
    icon = Image.open(SOURCE / 'assets' / 'textures' / f'{texture}.png').convert('RGBA')
    icon.thumbnail((100, 100), Image.Resampling.LANCZOS)
    sheet.alpha_composite(icon, (cx-icon.width//2, 162+(100-icon.height)//2))
    sheet.alpha_composite(image, (cx-128, 270))
    records.append(dict(id=slug, text=text, texture=texture, color=color, label=f'{slug}.png'))
sheet.convert('RGB').save(ROOT / 'preview.png')
(ROOT / 'manifest.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')

css = (SOURCE / 'src' / 'renderer' / 'overlay' / 'overlay.css').read_text(encoding='utf-8')
cards = ''.join(f'''<button class="card" data-index="{i}" aria-label="预览{r['text']}"><span>{r['text']}</span><div class="stage"></div><small>点击重播</small></button>''' for i, r in enumerate(records))
html = '''<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>标记文字预览</title><style>''' + css + '''
html,body{overflow:auto;background:#11191f;color:#e7ddc2;height:auto;font-family:"Microsoft YaHei","Segoe UI",sans-serif}
main{max-width:1400px;margin:48px auto;padding:0 24px}h1{font-size:28px;margin:0 0 12px}p{color:#a7b6be;line-height:1.8}
.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;margin-top:36px}.card{color:inherit;background:#18232b;border:1px solid #77664466;border-radius:12px;padding:20px 4px 16px;cursor:pointer;font:inherit}.card:hover{border-color:#c8aa6e}.card:focus-visible{outline:2px solid #1fa9e0;outline-offset:4px}.card small{color:#a7b6be}.stage{height:260px;position:relative;overflow:hidden}.action-label{position:absolute;left:-128px;top:38px;width:256px;height:96px;animation:labelIn .25s ease-out both,life var(--dur) linear forwards;}.ping .art img{object-fit:contain}
@keyframes labelIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(prefers-reduced-motion:reduce){.ping *{animation:none!important}.ping .ground,.ping .ring{display:none}.ping .pop{opacity:1}}
</style><main><h1>原标记 + 功能文字</h1><p>图标保持原样，文字作为独立透明图片显示在下方。点击任意卡片可重播动画。<br>这是外观预览，尚未接入 AI 功能。</p><div class="grid">''' + cards + '''</div></main><script>
const items=''' + json.dumps(records, ensure_ascii=False) + ''';
function play(card){const item=items[Number(card.dataset.index)],stage=card.querySelector('.stage');stage.replaceChildren();const root=document.createElement('div');root.className='ping';root.style.cssText=`left:50%;top:125px;--size:100px;--dur:3.2s;--c:${item.color}`;for(const cls of ['ground','ring','ring r2','ring r3']){const d=document.createElement('div');d.className=cls;root.append(d)}const art=document.createElement('div');art.className='art';const pop=document.createElement('div');pop.className='pop';const img=document.createElement('img');img.src='../../assets/textures/'+item.texture+'.png';pop.append(img);art.append(pop);root.append(art);const caption=document.createElement('img');caption.className='action-label';caption.src=item.label;caption.alt=item.text;root.append(caption);stage.append(root);setTimeout(()=>root.remove(),3400)}
document.querySelectorAll('.card').forEach(card=>{card.addEventListener('click',()=>play(card));play(card)});
</script></html>'''
(ROOT / 'preview.html').write_text(html, encoding='utf-8')
print('Generated 5 transparent PNG labels, manifest, static preview and animated preview.')

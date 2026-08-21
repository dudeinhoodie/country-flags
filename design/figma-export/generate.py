#!/usr/bin/env python3
"""Generate the html.to.design export bundle for country-flags."""
import json
import pathlib

ROOT = pathlib.Path('/Users/dudeinthehoodie/projects/country-flags')
OUT = ROOT / 'design' / 'figma-export'
OUT.mkdir(parents=True, exist_ok=True)

# --- continent silhouettes from the app's own geometry
sil = json.load(open(ROOT / 'ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Resources/ContinentSilhouettes.json'))

def continent_svg(code, opacity=0.55, extra=''):
    rings = sil[code]
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    w, h = x1 - x0, y1 - y0
    parts = []
    # Geographic y grows north, SVG y grows down: flip vertically.
    for ring in rings:
        pts = [f"{round(p[0]-x0,1)},{round(y1-p[1],1)}" for p in ring]
        parts.append('M' + 'L'.join(pts) + 'Z')
    return (f'<svg viewBox="0 0 {w:.0f} {h:.0f}" {extra} '
            f'style="display:block" xmlns="http://www.w3.org/2000/svg">'
            f'<path d="{"".join(parts)}" fill="#ffffff" fill-opacity="{opacity}"/></svg>')

# --- shared visual language (from DesignTokens.swift / Palette.xcassets)
CSS = """
  * { box-sizing:border-box; margin:0; }
  body { background:#0a0a0f; font:17px/1.4 -apple-system,'SF Pro Text',system-ui,sans-serif;
    color:#fff; -webkit-font-smoothing:antialiased; width:393px; }
  .phone { width:393px; height:852px; position:relative; overflow:hidden; background:#0a0a0f; }
  .scene { position:absolute; inset:0;
    background:
      radial-gradient(420px 420px at 20% 12%, rgba(43,99,255,.21), transparent 70%),
      radial-gradient(420px 420px at 85% 30%, rgba(224,16,47,.17), transparent 70%),
      radial-gradient(380px 380px at 50% 100%, rgba(43,99,255,.11), transparent 70%); }
  .content { position:relative; height:100%; padding:59px 24px 24px; display:flex;
    flex-direction:column; gap:16px; }
  .glass { background:rgba(255,255,255,.065); border:1px solid rgba(255,255,255,.13);
    border-radius:20px; padding:16px; }
  .cta { background:#fff; color:#000; border-radius:999px; height:56px; display:flex;
    align-items:center; justify-content:center; font-weight:700; font-size:17px; }
  .glassbtn { background:rgba(255,255,255,.09); border:1px solid rgba(255,255,255,.16);
    border-radius:999px; height:50px; display:flex; align-items:center; justify-content:center;
    font-weight:600; font-size:16px; }
  .label { font-size:12px; font-weight:650; letter-spacing:1.2px; text-transform:uppercase;
    color:rgba(255,255,255,.5); }
  .title { font-size:34px; font-weight:700; letter-spacing:-.4px; }
  .section { font-size:17px; font-weight:600; }
  .cap { font-size:13px; color:rgba(255,255,255,.55); }
  .hero { font:900 34px/1 'SF Pro Rounded',-apple-system,system-ui; letter-spacing:-.5px;
    font-variant-numeric:tabular-nums; }
  .track { position:relative; height:6px; border-radius:4px; background:rgba(255,255,255,.15); }
  .track i { position:absolute; inset:0 auto 0 0; border-radius:4px; }
  .row { display:flex; align-items:center; gap:8px; min-height:44px; }
  .chev { color:rgba(255,255,255,.4); font-size:14px; }
  .tab { display:flex; flex-direction:column; align-items:center; gap:3px; flex:1;
    font-size:10px; color:rgba(255,255,255,.55); }
  .tab.on { color:#fff; }
  .tabbar { position:absolute; left:16px; right:16px; bottom:20px; height:64px;
    background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.14);
    border-radius:999px; display:flex; align-items:center; padding:0 10px;
    backdrop-filter:blur(20px); }
  .flag { border-radius:5px; line-height:1; display:flex; align-items:center;
    justify-content:center; }
"""

def page(title, body, width=393, height=852):
    # Bare -apple-system falls back to serif in some engines: give every
    # shorthand a full chain.
    body = body.replace("-apple-system;", "-apple-system,system-ui,sans-serif;")
    body = body.replace('-apple-system"', '-apple-system,system-ui,sans-serif"')
    return (f'<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title>'
            f'<style>{CSS}</style></head><body>{body}</body></html>')

def tabbar(active):
    items = [('Сегодня', '☀️'), ('Каталог', '🗺'), ('Прогресс', '📊'), ('Награды', '🏅')]
    tabs = ''.join(
        f'<div class="tab{" on" if name == active else ""}">'
        f'<span style="font-size:20px">{icon}</span>{name}</div>'
        for name, icon in items)
    return f'<div class="tabbar">{tabs}</div>'

REGIONS = [('EUROPE', 'Европа', 52, 44, .6), ('AFRICA', 'Африка', 54, 12, .3),
           ('ASIA', 'Азия', 49, 4, .15), ('AMERICAS', 'Америки', 57, 9, .2),
           ('OCEANIA', 'Океания', 27, 11, .4)]

# ---------------------------------------------------------------- 01 home
fan = ''.join(f'<span class="flag" style="font-size:34px;margin-left:{-10 if i else 0}px;'
              f'transform:rotate({(i-1)*7}deg)">{f}</span>'
              for i, f in enumerate(['🇫🇷', '🇯🇵', '🇧🇷']))
queue_rows = ''.join(
    f'<div class="row">{continent_svg(c, .5, "width=\'44\' height=\'32\'")}'
    f'<span class="section" style="flex:1">{n}</span>'
    f'<span class="cap">{due}</span><span class="chev">›</span></div>'
    + ('<div style="height:1px;background:rgba(255,255,255,.12)"></div>' if i < 4 else '')
    for i, (c, n, total, due, frac) in enumerate(REGIONS))
home = f'''<div class="phone"><div class="scene"></div><div class="content">
  <div class="title">Сегодня</div>
  <div class="glass" style="display:flex;flex-direction:column;gap:14px">
    <div class="label">К повторению</div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span class="hero" style="font-size:44px">8</span>
      <span style="display:flex">{fan}</span>
    </div>
    <div class="cta">Повторить</div>
    <div style="height:1px;background:rgba(255,255,255,.12)"></div>
    <div class="row" style="min-height:0">
      <span class="cap" style="flex:1">Занятие в процессе · Африка · 4/10</span>
      <span style="font-weight:600;font-size:15px">Продолжить</span><span class="chev">›</span>
    </div>
  </div>
  <div class="glass">{queue_rows}</div>
</div>{tabbar('Сегодня')}</div>'''

# ---------------------------------------------------------------- 02 catalog
region_rows = ''.join(f'''
  <div class="glass" style="display:flex;gap:16px;align-items:center">
    {continent_svg(c, .55, "width='64' height='48'")}
    <div style="flex:1;display:flex;flex-direction:column;gap:5px">
      <span class="section">{n}</span>
      <span class="cap">{t} карточек · Выучено: {l}</span>
      <div class="track"><i style="width:{int(f*100*1.6)}%;background:rgba(255,255,255,.4)"></i>
        <i style="width:{int(f*100)}%;background:#fff"></i></div>
    </div>
  </div>''' for c, n, t, l, f in REGIONS)
catalog = f'''<div class="phone"><div class="scene"></div><div class="content" style="gap:12px">
  <div class="title">Каталог</div>
  <div style="background:rgba(255,255,255,.08);border-radius:12px;height:38px;display:flex;
    align-items:center;padding:0 12px;color:rgba(255,255,255,.45);font-size:16px">🔍&nbsp;Поиск</div>
  <div class="glass" style="display:flex;gap:16px;align-items:center">
    <div style="flex:1;display:flex;flex-direction:column;gap:5px">
      <span class="section" style="font-weight:700">Все страны</span>
      <span class="cap">250 карточек · Выучено: 34</span>
      <div class="track"><i style="width:30%;background:rgba(255,255,255,.4)"></i>
        <i style="width:14%;background:#fff"></i></div>
    </div>
    <span style="display:flex">{fan}</span>
  </div>
  {region_rows}
</div>{tabbar('Каталог')}</div>'''

# ---------------------------------------------------------------- 03 progress
PLACE = [('AMERICAS', 0.00, 0.10, 0.78, .2), ('EUROPE', 0.40, 0.00, 0.36, .6),
         ('AFRICA', 0.42, 0.38, 0.58, .3), ('ASIA', 0.62, 0.04, 0.54, .15),
         ('OCEANIA', 0.80, 0.66, 0.30, .4)]
MAPW, MAPH = 297, 156
world = ''.join(
    f'<div style="position:absolute;left:{int(MAPW*x)}px;top:{int(MAPH*y)}px;height:{int(MAPH*h)}px">'
    + continent_svg(c, 0.15 + 0.85 * b, f"height='{int(MAPH*h)}'") + '</div>'
    for c, x, y, h, b in PLACE)
prog_rows = ''.join(
    f'<div class="row">{continent_svg(c, 0.15+0.85*frac, "width=\'44\' height=\'32\'")}'
    f'<span class="section" style="flex:1">{n}</span>'
    + ('<span style="font-size:12px;background:rgba(255,255,255,.12);border-radius:999px;'
       'padding:4px 8px">🏵 Бронза</span>' if c == 'EUROPE' else '')
    + f'<span class="section" style="color:rgba(255,255,255,.7)">{l}/{t}</span>'
    f'<span class="chev">›</span></div>'
    + ('<div style="height:1px;background:rgba(255,255,255,.12)"></div>' if i < 4 else '')
    for i, (c, n, t, l, frac) in enumerate(REGIONS))
progress = f'''<div class="phone"><div class="scene"></div><div class="content">
  <div class="title">Прогресс</div>
  <div class="glass" style="padding:24px;display:flex;flex-direction:column;gap:16px">
    <div style="position:relative;width:{MAPW}px;height:{MAPH}px">{world}</div>
    <div style="display:flex;flex-direction:column;gap:2px">
      <div class="label">Выучено</div>
      <div style="display:flex;align-items:baseline;gap:4px;white-space:nowrap">
        <span class="hero">34</span><span class="section" style="color:rgba(255,255,255,.55)">/ 250</span>
      </div>
      <span class="cap" style="font-size:12px;color:rgba(255,255,255,.45)">Мир загорается по мере учёбы</span>
    </div>
  </div>
  <div class="glass" style="padding:8px 16px">{prog_rows}</div>
</div>{tabbar('Прогресс')}</div>'''

# ---------------------------------------------------------------- 04 deck details
def shelf(label, items, dim=False):
    tiles = ''.join(f'''<div style="display:flex;flex-direction:column;gap:4px;width:132px;
      flex-shrink:0;{'opacity:.55;filter:saturate(.25)' if dim else ''}">
      <div class="flag" style="width:132px;height:99px;font-size:64px;
        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px">{f}</div>
      <span style="font-size:13px">{n}</span>
      {f'<span class="cap" style="font-size:13px">{s}</span>' if s else ''}</div>'''
      for f, n, s in items)
    return f'''<div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px;align-items:baseline"><span class="label">{label[0]}</span>
      <span class="cap" style="font-variant-numeric:tabular-nums">{label[1]}</span></div>
      <div style="display:flex;gap:8px;overflow:hidden">{tiles}</div></div>'''
deck = f'''<div class="phone"><div class="scene"></div><div class="content" style="gap:20px">
  <div style="text-align:center" class="section">Африка</div>
  <div class="cta">Начать занятие</div>
  {shelf(('Выучено', '12'), [('🇪🇬', 'Египет', 'через 3 дн.'), ('🇳🇬', 'Нигерия', 'через нед.'), ('🇰🇪', 'Кения', 'к повторению')])}
  {shelf(('В процессе', '8'), [('🇲🇦', 'Марокко', 'через 10 мин.'), ('🇹🇳', 'Тунис', 'через час'), ('🇬🇭', 'Гана', 'к повторению')])}
  {shelf(('Не начато', '34'), [('🇸🇳', 'Сенегал', ''), ('🇨🇲', 'Камерун', ''), ('🇹🇿', 'Танзания', '')], dim=True)}
</div></div>'''

# ---------------------------------------------------------------- 05 session front
sess_front = f'''<div class="phone"><div class="scene" style="background:
    radial-gradient(420px 420px at 20% 12%, rgba(0,85,164,.5), transparent 70%),
    radial-gradient(420px 420px at 85% 30%, rgba(239,65,53,.42), transparent 70%),
    radial-gradient(380px 380px at 50% 100%, rgba(0,85,164,.26), transparent 70%)"></div>
  <div class="content" style="align-items:center;justify-content:center;gap:20px">
    <div style="position:absolute;top:59px;left:24px;right:24px;display:flex;align-items:center">
      <div class="glassbtn" style="width:40px;height:40px;border-radius:50%;font-size:15px">✕</div>
      <span class="cap" style="flex:1;text-align:center">Африка · 3 / 10</span>
      <div style="width:40px"></div>
    </div>
    <div style="position:relative;width:329px;height:247px">
      <div style="position:absolute;inset:0;transform:translateY(28px) scale(.92) rotate(3deg);
        background:#141322;border:1px solid rgba(255,255,255,.12);border-radius:20px"></div>
      <div style="position:absolute;inset:0;transform:translateY(14px) scale(.96) rotate(-2deg);
        background:#181628;border:1px solid rgba(255,255,255,.12);border-radius:20px"></div>
      <div class="flag" style="position:absolute;inset:0;font-size:150px;border-radius:20px;
        background:linear-gradient(160deg,rgba(255,255,255,.1),transparent 40%,rgba(0,0,0,.12));
        border:1px solid rgba(255,255,255,.12);box-shadow:0 12px 24px rgba(0,0,0,.35)">🇫🇷</div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;color:rgba(255,255,255,.5);font-size:13px">
      <span style="color:#FF7D75">‹ не помню</span><span style="font-size:20px">✋</span>
      <span style="color:#6EDF8A">помню ›</span>
    </div>
    <div class="glassbtn" style="align-self:stretch;position:absolute;bottom:24px;left:24px;right:24px">
      ⟲&nbsp; Показать ответ</div>
  </div></div>'''

# ---------------------------------------------------------------- 06 session back
sess_back = f'''<div class="phone"><div class="scene" style="background:
    radial-gradient(420px 420px at 20% 12%, rgba(0,85,164,.5), transparent 70%),
    radial-gradient(420px 420px at 85% 30%, rgba(239,65,53,.42), transparent 70%)"></div>
  <div class="content" style="align-items:center;justify-content:center;gap:24px">
    <div style="position:relative;width:329px;height:247px;border-radius:20px;overflow:hidden;
      background:linear-gradient(150deg,rgba(0,85,164,.55),rgba(20,19,34,.9) 55%,rgba(239,65,53,.35));
      border:1px solid rgba(255,255,255,.14);display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:6px">
      <div style="position:absolute;right:-20px;bottom:-14px;height:150px;opacity:.6">
        {continent_svg('EUROPE', 0.1, "height='150'")}</div>
      <span style="font:800 28px/1 -apple-system">Франция</span>
      <span class="cap">Французская Республика</span>
      <div style="margin-top:10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);
        border-radius:999px;padding:8px 18px;font-size:14px;font-weight:600">Подробнее</div>
    </div>
    <div class="glass" style="position:absolute;bottom:24px;left:24px;right:24px;border-radius:999px;
      padding:6px;display:flex;text-align:center;font-size:14px;font-weight:600">
      <span style="flex:1;color:#FF7D75;padding:10px 0">Не помню</span>
      <span style="flex:1;color:#FFBC54;padding:10px 0">Трудно</span>
      <span style="flex:1;background:#fff;color:#000;border-radius:999px;padding:10px 0">Помню</span>
      <span style="flex:1;color:#6EDF8A;padding:10px 0">Легко</span>
    </div>
  </div></div>'''

# ---------------------------------------------------------------- 07 drawer
facts = ''.join(f'''<div class="glass" style="flex:1;padding:12px;display:flex;
    flex-direction:column;gap:3px"><span class="label" style="font-size:10px">{k}</span>
    <span style="font-size:15px;font-weight:600">{v}</span></div>'''
    for k, v in [('Столица', 'Ломе'), ('Валюта', 'Франк КФА')])
facts2 = ''.join(f'''<div class="glass" style="flex:1;padding:12px;display:flex;
    flex-direction:column;gap:3px"><span class="label" style="font-size:10px">{k}</span>
    <span style="font-size:15px;font-weight:600">{v}</span></div>'''
    for k, v in [('Население', '8,6 млн'), ('Язык', 'Французский')])
drawer = f'''<div class="phone" style="background:#000"><div class="scene" style="opacity:.4"></div>
  <div style="position:absolute;left:0;right:0;top:80px;bottom:0;background:#131120;
    border-radius:24px 24px 0 0;border:1px solid rgba(255,255,255,.1);padding:14px 20px 20px;
    display:flex;flex-direction:column;gap:14px;overflow:hidden">
    <div style="width:36px;height:5px;border-radius:3px;background:rgba(255,255,255,.25);align-self:center"></div>
    <div style="display:flex;align-items:flex-start">
      <div style="flex:1;display:flex;flex-direction:column;gap:2px">
        <span style="font:800 26px/1.1 -apple-system">Того</span>
        <span class="cap">Тоголезская Республика</span></div>
      <div class="glassbtn" style="width:32px;height:32px;border-radius:50%;font-size:13px">✕</div>
    </div>
    <div style="display:flex;gap:12px">
      <div class="flag" style="width:200px;height:150px;font-size:96px;border-radius:14px;
        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)">🇹🇬</div>
      <div class="glass" style="flex:1;display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        {continent_svg('AFRICA', .5, "height='64'")}
        <span class="label" style="font-size:10px">Регион</span>
        <span style="font-size:15px;font-weight:600">Африка</span></div>
    </div>
    <span class="cap">Также известна как: Того­лезия</span>
    <div style="display:flex;gap:12px">{facts}</div>
    <div style="display:flex;gap:12px">{facts2}</div>
    <div style="height:220px;border-radius:16px;background:
      linear-gradient(140deg,#101726,#0c1220 60%,#101a2c);border:1px solid rgba(255,255,255,.1);
      display:flex;align-items:center;justify-content:center">
      {continent_svg('AFRICA', .25, "height='120'")}</div>
  </div></div>'''

# ---------------------------------------------------------------- 08 finish
def wave_path(width, amp, ybase, phase, wl):
    import math
    pts = []
    x = 0
    while x <= width + 4:
        y = ybase + math.sin(x / wl * 2 * math.pi + phase) * amp
        pts.append(f"{x},{round(y,1)}")
        x += 4
    return pts
import math
W, H = 393, 852
level_y = H * 0.30 * 0 + H - H * 0.63  # 7/10 * 0.9 = 63%
green_pts = wave_path(W, 5, 0, 0.6, W / 1.5)
grey_pts = wave_path(W, 6.7, -4, 2.0, W / 1.5)
def wave_svg(pts, height, gid, color, stops, line):
    top = 'L'.join(pts)
    stop_svg = ''.join(
        f'<stop offset="{off}" stop-color="{color}" stop-opacity="{op}"/>'
        for off, op in stops)
    return (f'<svg width="{W}" height="{height}" viewBox="0 -14 {W} {height+14}" '
            f'xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">'
            f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">{stop_svg}'
            f'</linearGradient></defs>'
            f'<path d="M{top}L{W},{height} L0,{height}Z" fill="url(#{gid})"/>'
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="{line}" stroke-width="1"/></svg>')
wh = int(H * 0.63)
finish_flags = ''.join(
    f'<div style="display:flex;flex-direction:column;align-items:center;gap:3px">'
    f'<span class="flag" style="font-size:30px;{"opacity:.45;filter:saturate(.5)" if miss else ""}">{f}</span>'
    + ('' if miss else '<span style="width:20px;height:3px;border-radius:2px;background:#7AE096"></span>')
    + '</div>'
    for f, miss in [('🇪🇬', 0), ('🇳🇬', 0), ('🇲🇦', 1), ('🇰🇪', 0), ('🇹🇿', 0),
                    ('🇨🇲', 1), ('🇩🇿', 0), ('🇹🇳', 0), ('🇿🇦', 1), ('🇸🇳', 0)])
finish = f'''<div class="phone"><div class="scene"></div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:{wh+8}px">
    <div style="position:absolute;left:0;right:0;top:0">{wave_svg(grey_pts, wh+8, 'wgrey', '#c7c7c7', [(0, .16), (.4, .05), (1, .03)], 'rgba(158,158,158,.85)')}</div>
    <div style="position:absolute;left:0;right:0;top:0">{wave_svg(green_pts, wh+8, 'wgreen', '#7AE096', [(0, .26), (.65, .08), (1, .05)], '#7AE096')}</div>
  </div>
  <div class="content" style="gap:20px">
    <div style="display:flex;align-items:baseline;gap:4px;justify-content:center;margin-top:24px">
      <span style="font:900 46px/1 'SF Pro Rounded',-apple-system;font-variant-numeric:tabular-nums">7</span>
      <span style="font:600 30px/1 'SF Pro Rounded',-apple-system;color:rgba(255,255,255,.5)">/ 10</span>
    </div>
    <div style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-radius:20px;
      padding:16px;display:grid;grid-template-columns:repeat(5,1fr);gap:10px 6px;justify-items:center">
      {finish_flags}</div>
    <div class="cta" style="position:absolute;left:24px;right:24px;bottom:24px">Отлично!</div>
  </div></div>'''

# ---------------------------------------------------------------- 09 awards
award_rows = ''.join(f'''<div class="row" style="gap:16px">
    <span style="font-size:22px">🏵</span>
    <div style="flex:1;display:flex;flex-direction:column;gap:2px">
      <span style="font-size:16px">{code}</span><span class="cap" style="font-size:13px">{date}</span></div>
    <span style="font-size:12px;background:rgba(255,255,255,.12);border-radius:999px;padding:4px 10px">{tier}</span>
  </div>''' + ('<div style="height:1px;background:rgba(255,255,255,.12)"></div>' if i < 2 else '')
  for i, (code, date, tier) in enumerate([
      ('Европа освоена', '12 авг. 2026', 'Бронза'),
      ('Первая колода', '3 авг. 2026', '—'),
      ('Семь дней подряд', '9 авг. 2026', '—')]))
awards = f'''<div class="phone"><div class="scene"></div><div class="content">
  <div class="title">Награды</div>
  <div class="glass" style="display:flex;gap:24px">
    <div style="flex:1;display:flex;flex-direction:column;gap:2px">
      <span class="label">Начато</span><span class="hero">46</span></div>
    <div style="flex:1;display:flex;flex-direction:column;gap:2px">
      <span class="label">Выучено</span><span class="hero">34</span></div>
  </div>
  <div class="glass">{award_rows}</div>
</div>{tabbar('Награды')}</div>'''

# ---------------------------------------------------------------- 10 ui kit
COLORS = [
    ('Scene Base', '#0A0A0F', 'фон всех экранов: чёрный 94% поверх системного', '#0A0A0F'),
    ('Scene Accent', '#2B63FF', 'фирменная лампа сцены (SceneAccent), в фоне 21%', '#2B63FF'),
    ('Scene Ember', '#E0102F', 'вторая лампа сцены (SceneEmber), в фоне 17%', '#E0102F'),
    ('Glass Fill', '#FFFFFF 6.5%', 'заливка стеклянных панелей', 'rgba(255,255,255,.065)'),
    ('Glass Edge', '#FFFFFF 13%', 'кайма стекла, 1px', 'rgba(255,255,255,.13)'),
    ('Card Border', '#FFFFFF 12%', 'волосяная кромка флагов и карт', 'rgba(255,255,255,.12)'),
    ('Text Primary', '#FFFFFF', 'основной текст', '#FFFFFF'),
    ('Text Dim', '#FFFFFF 70%', 'вторичный текст', 'rgba(255,255,255,.7)'),
    ('Text Faint', '#FFFFFF 50–55%', 'подписи, знаменатели', 'rgba(255,255,255,.5)'),
    ('Rating · Again', '#FF7D75', 'не помню (red + 30% white)', '#FF7D75'),
    ('Rating · Hard', '#FFBC54', 'трудно (orange + 30% white)', '#FFBC54'),
    ('Rating · Good', '#FFFFFF', 'помню — белый, акцент сцены', '#FFFFFF'),
    ('Rating · Easy', '#6EDF8A', 'легко (green + 30% white)', '#6EDF8A'),
    ('Water Green', '#7AE096', 'вода финального экрана, отметки', '#7AE096'),
    ('Soft Green', '#8FD4A0', 'старший зелёный тинт семьи', '#8FD4A0'),
    ('Award Gold', '#F0D18C', 'золото наград и дельт', '#F0D18C'),
]
swatches = ''.join(f'''<div style="display:flex;gap:12px;align-items:center">
    <div style="width:56px;height:40px;border-radius:10px;background:{css};
      border:1px solid rgba(255,255,255,.15)"></div>
    <div style="display:flex;flex-direction:column">
      <span style="font-size:14px;font-weight:600">{n} · <span style="font-family:ui-monospace,monospace;font-weight:400">{c}</span></span>
      <span class="cap" style="font-size:12px">{u}</span></div></div>'''
    for n, c, u, css in COLORS)
type_rows = ''.join(f'''<div style="display:flex;align-items:baseline;gap:12px">
    <span style="{style}">{name}</span><span class="cap" style="font-size:12px">{spec}</span></div>'''
    for name, style, spec in [
        ('Screen Title', 'font:700 34px/1 -apple-system;letter-spacing:-.4px', 'Large Title Bold · 34'),
        ('Hero Number 34', "font:900 34px/1 'SF Pro Rounded',-apple-system", 'Large Title Rounded Heavy'),
        ('Card Answer', 'font:700 22px/1 -apple-system', 'Title 2 Bold · 22'),
        ('Section Title', 'font:600 17px/1 -apple-system', 'Headline · 17'),
        ('Body', 'font:400 17px/1 -apple-system', 'Body · 17'),
        ('Caption', 'font:400 13px/1 -apple-system;color:rgba(255,255,255,.7)', 'Footnote · 13'),
        ('LABEL', 'font:650 12px/1 -apple-system;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.5)', 'Uppercase · kerning 1.2'),
    ])
uikit_body = f'''<div style="width:820px;padding:32px;background:#0a0a0f;display:flex;
  flex-direction:column;gap:28px">
  <div class="title">Country Flags · UI Kit</div>

  <div class="label">Палитра</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 28px">{swatches}</div>

  <div class="label">Типографика · SF Pro / SF Pro Rounded</div>
  <div style="display:flex;flex-direction:column;gap:14px">{type_rows}</div>

  <div class="label">Отступы · 4 / 8 / 16 / 24 / 32 &nbsp;·&nbsp; Радиусы · 8 / 12 / 20 &nbsp;·&nbsp;
    Кнопка 56 &nbsp;·&nbsp; Касание ≥44 &nbsp;·&nbsp; Карта 4:3</div>

  <div class="label">Компоненты</div>
  <div style="display:flex;gap:16px;align-items:center">
    <div class="cta" style="width:200px">Primary Action</div>
    <div class="glassbtn" style="width:200px">Glass Action</div>
    <div class="glassbtn" style="width:40px;height:40px;border-radius:50%">✕</div>
  </div>
  <div style="display:flex;gap:16px">
    <div class="glass" style="width:260px"><div class="label" style="margin-bottom:8px">Glass Card</div>
      <span class="cap">Панель контента: white 6.5% + edge 13%, radius 20</span></div>
    <div class="glass" style="width:300px;border-radius:999px;padding:6px;display:flex;
      text-align:center;font-size:14px;font-weight:600;align-self:flex-start">
      <span style="flex:1;color:#FF7D75;padding:10px 0">Не помню</span>
      <span style="flex:1;color:#FFBC54;padding:10px 0">Трудно</span>
      <span style="flex:1;background:#fff;color:#000;border-radius:999px;padding:10px 0">Помню</span>
      <span style="flex:1;color:#6EDF8A;padding:10px 0">Легко</span></div>
  </div>
  <div style="display:flex;gap:24px;align-items:center">
    <div style="width:240px"><div class="label" style="margin-bottom:6px">Progress Track</div>
      <div class="track"><i style="width:60%;background:rgba(255,255,255,.4)"></i>
      <i style="width:30%;background:#fff"></i></div></div>
    <div style="width:240px"><div class="label" style="margin-bottom:6px">Delta Thread</div>
      <div class="track" style="background:rgba(255,255,255,.12)">
        <i style="width:40%;background:linear-gradient(90deg,rgba(255,255,255,.55),#F0D18C)"></i>
        <i style="width:33%;background:rgba(255,255,255,.55)"></i>
        <b style="position:absolute;left:40%;top:50%;width:9px;height:9px;border-radius:50%;
          background:#F0D18C;transform:translate(-50%,-50%)"></b></div></div>
    <div><div class="label" style="margin-bottom:6px">Segmented Picker</div>
      <div class="glass" style="border-radius:999px;padding:4px;display:flex;font-size:14px;width:220px">
        <span style="flex:1;text-align:center;padding:8px 0;color:rgba(255,255,255,.6)">10</span>
        <span style="flex:1;text-align:center;padding:8px 0;background:rgba(255,255,255,.2);
          border-radius:999px;font-weight:600">20</span>
        <span style="flex:1;text-align:center;padding:8px 0;color:rgba(255,255,255,.6)">Все</span></div></div>
  </div>
  <div style="display:flex;gap:24px;align-items:flex-end">
    <div><div class="label" style="margin-bottom:6px">Flag Tile</div>
      <div class="flag" style="width:132px;height:99px;font-size:56px;background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.12);border-radius:12px">🇯🇵</div></div>
    <div><div class="label" style="margin-bottom:6px">Continent Silhouette</div>
      {continent_svg('AFRICA', .55, "height='99'")}</div>
    <div style="flex:1"><div class="label" style="margin-bottom:6px">Water Bar (финал)</div>
      <div style="position:relative;height:60px;border-radius:12px;overflow:hidden;
        border:1px solid rgba(255,255,255,.1)">
        <div style="position:absolute;left:0;right:0;bottom:0;height:60%;
          background:linear-gradient(180deg,rgba(122,224,150,.36),rgba(122,224,150,.1));
          border-top:1px solid #7AE096"></div></div></div>
  </div>
</div>'''

FILES = {
    '01-home.html': ('Home · Сегодня', home),
    '02-catalog.html': ('Каталог · Атлас', catalog),
    '03-progress.html': ('Прогресс · Карта мира', progress),
    '04-deck-details.html': ('Колода · Полки', deck),
    '05-session-front.html': ('Сессия · Лицо', sess_front),
    '06-session-back.html': ('Сессия · Оборот и бар', sess_back),
    '07-country-drawer.html': ('Шторка страны', drawer),
    '08-deck-finish.html': ('Финал · Вода', finish),
    '09-awards.html': ('Награды', awards),
}
for name, (title, body) in FILES.items():
    (OUT / name).write_text(page(title, body))
(OUT / '10-ui-kit.html').write_text(
    page('UI Kit', uikit_body).replace('width:393px;', 'width:820px;'))

(OUT / 'README.md').write_text('''# Figma-экспорт Country Flags

Импорт в Figma через бесплатный плагин **html.to.design** (Import → HTML file):
каждый файл — один экран 393×852 (10-ui-kit.html — лист 820px). Флаги в макетах —
эмодзи-плейсхолдеры; в приложении это PNG из resvg. Силуэты континентов — реальная
геометрия приложения (ContinentSilhouettes.json).

Палитра, типографика, отступы и компоненты собраны в `10-ui-kit.html`.
''')
print('written:', sorted(p.name for p in OUT.iterdir()))

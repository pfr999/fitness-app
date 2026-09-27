"""Genera la base de alimentos estática de la app (carpeta foods/).

Entradas (se descargan aparte, ver tools/README.md):
  - off_spain.json  : salida de tools/off_filter.py (volcado de Open Food Facts filtrado a España)
  - ciqual_raw.json : CIQUAL 2025 extraído (código, nombres, grupo, macros por 100 g)
  - tools/data/ciqual_es.json : traducción al español de los nombres de CIQUAL {id: {n, a}} (versionada)
Salidas:
  - foods/generic.json  : [[id, nombre, alias|alias, kcal, p, c, g], ...]
  - foods/products.json : [[ean, nombre, marca, tiendas, cantidad, kcal, p, c, g, escaneos], ...]
  - foods/meta.json     : fecha, recuentos y licencias
Uso: python3 tools/build_foods.py <carpeta_entradas>
"""
import json, re, sys, glob, os, datetime

src = sys.argv[1]
MAX_PRODUCTS = 45000
ES = re.compile(r'mercadona|hacendado|deliplus|bosque verde|lidl|milbona|carrefour|\bdia\b|eroski|consum|aldi|alcampo|auchan|lupa|corte ingl|hipercor|ahorramas|gadis|bon preu|condis|caprabo|bm supermercados|froiz|masymas|supercor|simply|spar|covir[aá]n|hiperdino|family cash|vegalsa|mas y mas')

def r1(v):
    return None if v is None else (int(v) if float(v).is_integer() else round(v, 1))

def clean(s, n):
    s = re.sub(r'\s+', ' ', (s or '')).strip()
    return s[:n]

def stores(s):
    parts = [p.strip() for p in (s or '').split(',') if p.strip()]
    seen, out = set(), []
    for p in parts:
        k = p.lower()
        if k in seen or '.' in k:  # fuera duplicados y webs (carrefour.fr)
            continue
        seen.add(k); out.append(p)
    return ', '.join(out[:3])

# ---------- productos ----------
off = json.load(open(os.path.join(src, 'off_spain.json')))
spanish = [x for x in off if ES.search((x['stores'] + ' ' + x['brand']).lower())]
spanish_eans = {x['ean'] for x in spanish}
rest = [x for x in off if x['ean'] not in spanish_eans and x['scans'] >= 2]
chosen = sorted(spanish, key=lambda x: -x['scans']) + rest
chosen = chosen[:MAX_PRODUCTS]
seen, products = set(), []
for x in chosen:
    if x['ean'] in seen:
        continue
    seen.add(x['ean'])
    products.append([x['ean'], clean(x['name'], 90), clean(x['brand'].split(',')[0], 40), stores(x['stores']), clean(x['qty'], 24),
                     r1(x['kcal']), r1(x['p']), r1(x['c']), r1(x['f']), x['scans']])

# ---------- genéricos ----------
raw = json.load(open(os.path.join(src, 'ciqual_raw.json')))
# traducción al español (versionada en el repo; los nuevos alimentos de CIQUAL habría que traducirlos)
es = json.load(open(os.path.join(os.path.dirname(__file__), 'data', 'ciqual_es.json')))
for f in sorted(glob.glob(os.path.join(src, 'es_*.json'))):
    es.update(json.load(open(f)))
generic, missing = [], 0
for x in raw:
    t = es.get(x['id'])
    if not t:
        missing += 1
        continue
    generic.append([x['id'], t['n'].strip(), '|'.join(a.strip().lower() for a in t.get('a', []) if a.strip()), r1(x['kcal']), r1(x['p']), r1(x['c']), r1(x['f'])])

os.makedirs('foods', exist_ok=True)
json.dump(generic, open('foods/generic.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(products, open('foods/products.json', 'w'), ensure_ascii=False, separators=(',', ':'))
meta = {
    'built': datetime.date.today().isoformat(),
    'generic': len(generic), 'products': len(products), 'generic_missing_translation': missing,
    'sources': {
        'generic': 'CIQUAL 2025 (ANSES) — Licence Ouverte / Etalab 2.0 — nombres traducidos al español',
        'products': 'Open Food Facts — Open Database License (ODbL) — productos vendidos en España',
    },
}
json.dump(meta, open('foods/meta.json', 'w'), ensure_ascii=False, indent=2)
print(meta)
for f in ('generic', 'products'):
    print(f, os.path.getsize(f'foods/{f}.json') // 1024, 'KB')

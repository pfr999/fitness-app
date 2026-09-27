"""Extrae de CIQUAL 2025 (xlsx + alim.xml) los alimentos con macros por 100 g → ciqual_raw.json.
Uso: python3 tools/ciqual_extract.py <carpeta_con_ciqual.xlsx_y_alim.xml>   (requiere openpyxl)"""
import json, sys, os, xml.etree.ElementTree as ET
import openpyxl

src = sys.argv[1]
en = {a.findtext('alim_code').strip(): (a.findtext('alim_nom_eng') or '').strip() for a in ET.parse(os.path.join(src, 'alim.xml')).getroot()}
rows = openpyxl.load_workbook(os.path.join(src, 'ciqual.xlsx'), read_only=True).worksheets[0].iter_rows(values_only=True)
next(rows)

def val(x):
    if x is None: return None
    s = str(x).strip().replace(',', '.')
    if s in ('-', ''): return None
    if s.lower() == 'traces' or s.startswith('<'): return 0.0
    try: return round(float(s), 2)
    except ValueError: return None

out = []
for r in rows:
    grp = (r[3] or '').replace('\n', ' ').strip()
    kcal = val(r[10]) if val(r[10]) is not None else val(r[12])
    p = val(r[14]) if val(r[14]) is not None else val(r[15])
    c, f, fib = val(r[16]), val(r[17]), val(r[26])
    if None in (kcal, p, c, f) or 'infantile' in grp.lower():
        continue  # sin macros completos o alimentación infantil
    code = str(r[6]).strip()
    out.append({'id': code, 'fr': r[7].strip(), 'en': en.get(code, ''), 'grp': grp, 'kcal': kcal, 'p': p, 'c': c, 'f': f, 'fib': fib})
json.dump(out, open(os.path.join(src, 'ciqual_raw.json'), 'w'), ensure_ascii=False)
print(len(out), 'alimentos')

"""Filtra el volcado CSV de Open Food Facts (por stdin, gzip) → productos vendidos en España con
tabla nutricional coherente. Salida: foods/off_spain.json (lista ordenada por escaneos)."""
import csv, gzip, io, json, sys, time

csv.field_size_limit(10**9)
src = gzip.GzipFile(fileobj=sys.stdin.buffer)
reader = csv.reader(io.TextIOWrapper(src, encoding='utf-8', errors='replace', newline=''), delimiter='\t', quoting=csv.QUOTE_NONE)
h = next(reader)
ix = {k: i for i, k in enumerate(h)}
need = ['code', 'product_name', 'brands', 'stores', 'countries_tags', 'quantity', 'unique_scans_n',
        'energy-kcal_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g', 'last_modified_t',
        'serving_size', 'serving_quantity']
missing = [k for k in need if k not in ix]
print('columnas que faltan:', missing, file=sys.stderr)

def f(row, k):
    try:
        v = row[ix[k]].strip()
        return float(v) if v else None
    except (IndexError, ValueError):
        return None

out = []
n = kept = bad = 0
t0 = time.time()
for row in reader:
    n += 1
    if n % 500000 == 0:
        print(f'{n} filas · {kept} guardadas · {bad} incoherentes · {time.time()-t0:.0f}s', file=sys.stderr, flush=True)
    try:
        if 'en:spain' not in row[ix['countries_tags']]:
            continue
        name = row[ix['product_name']].strip()
    except IndexError:
        continue
    if not name:
        continue
    kcal, p, c, fat = f(row, 'energy-kcal_100g'), f(row, 'proteins_100g'), f(row, 'carbohydrates_100g'), f(row, 'fat_100g')
    if None in (kcal, p, c, fat):
        continue
    if not (0 <= kcal <= 950 and 0 <= p <= 100 and 0 <= c <= 100 and 0 <= fat <= 100 and p + c + fat <= 105):
        bad += 1
        continue
    est = 4 * p + 4 * c + 9 * fat
    # coherencia: kcal declaradas ≈ 4P + 4C + 9G (margen amplio por fibra, alcohol, polioles)
    if kcal > 20 and not (0.7 * est - 15 <= kcal <= 1.3 * est + 25):
        bad += 1
        continue
    scans = f(row, 'unique_scans_n') or 0
    out.append({
        'ean': row[ix['code']].strip(),
        'name': name[:120],
        'brand': row[ix['brands']].strip()[:80],
        'stores': row[ix['stores']].strip()[:80],
        'qty': row[ix['quantity']].strip()[:30],
        'scans': int(scans),
        'kcal': round(kcal, 1), 'p': round(p, 1), 'c': round(c, 1), 'f': round(fat, 1),
        'fib': (lambda v: None if v is None else round(v, 1))(f(row, 'fiber_100g')),
        # ración del fabricante (g), si es razonable
        'serv': (lambda v: round(v, 1) if v and 1 <= v <= 1000 else None)(f(row, 'serving_quantity')),
        'serv_label': row[ix['serving_size']].strip()[:30] if 'serving_size' in ix and len(row) > ix['serving_size'] else '',
    })
    kept += 1

out.sort(key=lambda x: -x['scans'])
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False)
print(f'FIN: {n} filas · {kept} productos España · {bad} descartados por incoherentes · {time.time()-t0:.0f}s', file=sys.stderr)

# Generar la base de alimentos (`foods/`)

La app usa una base estática: genéricos (CIQUAL) + productos vendidos en España (Open Food Facts).
Se regenera de vez en cuando; no hace falta para usar la app.

```sh
mkdir -p /tmp/foods && cd /tmp/foods
# 1. CIQUAL 2025 (ANSES, Licence Ouverte / Etalab 2.0)
curl -L -o ciqual.xlsx https://entrepot.recherche.data.gouv.fr/api/access/datafile/666260
curl -L -o alim.xml    https://entrepot.recherche.data.gouv.fr/api/access/datafile/666252
python3 <repo>/tools/ciqual_extract.py /tmp/foods          # necesita openpyxl
# 2. Open Food Facts (ODbL): el volcado (~1,3 GB) se filtra en streaming, sin guardarlo
curl -L https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz \
  | python3 <repo>/tools/off_filter.py /tmp/foods/off_spain.json
# 3. Construir foods/generic.json, foods/products.json y foods/meta.json
cd <repo> && python3 tools/build_foods.py /tmp/foods
```

- Los nombres de CIQUAL están traducidos al español en `tools/data/ciqual_es.json`. Si una
  versión nueva de CIQUAL trae alimentos nuevos, `build_foods.py` avisa de cuántos faltan.
- `off_filter.py` descarta productos sin macros o incoherentes (kcal ≠ 4P + 4C + 9G con margen).
- `build_foods.py` elige hasta 45.000 productos: primero los de tiendas/marcas españolas, luego los
  más escaneados.
- Tras regenerar, cambia `VERSION` y la fecha de `FOODS` en `sw.js` para que los móviles
  descarguen la base nueva.

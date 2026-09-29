# 04 · Motor de cálculo

Módulo de **funciones puras** (`engine/*.js`), sin dependencias, con tests. Entrada: `data.json`.
Salida: valores derivados. Nada de esto se persiste (decisión #4).

Convenciones: kg, cm, mm, kcal, días. Cada valor mostrado en la UI indica **qué método** lo
produce y, cuando aplica, **su incertidumbre**. Niveles de evidencia: **[MA]** meta-análisis/ensayos,
**[Exp]** práctica experta, **[Heur]** regla propia de la app.

Estado del arte revisado en septiembre de 2026 (fuentes al final).

---

## 1. Tendencia de peso

**Decisión:** filtro de Kalman de *tendencia lineal local* (nivel + pendiente). Como respaldo y
para explicarlo en la UI: EMA consciente del tiempo.

| Método | Problema |
|---|---|
| Media simple 7 días | Retraso de ~3 días, pesos iguales, se rompe con huecos, pendiente ruidosa |
| EMA clásica (Hacker's Diet, α = 0,1) | Retraso de ~9 días: infravalora el ritmo justo tras un cambio de dieta |
| **Kalman nivel + pendiente** | Sin sesgo de retraso, da la **pendiente y su varianza** (lo que necesita el TDEE), huecos gratis |

**Kalman** — estado `x = [nivel, pendiente]`, Δt en días entre pesadas:
```
F = [[1, Δt], [0, 1]]
Q = q · [[Δt³/3, Δt²/2], [Δt²/2, Δt]]        q ≈ 1e-4 kg²/día³ (ajustar)
H = [1, 0]        R = σ²,  σ ≈ 0,6 kg (ruido diario de agua)
```
- Hueco sin pesada → solo paso de predicción (la incertidumbre crece sola).
- Atípico (innovación > 3·√S) → inflar R ese día (comida salada, viaje, recarga).
- Varias pesadas el mismo día → media antes de filtrar.

**EMA temporal (respaldo):** `α = 1 − e^(−Δt/τ)`, `T = T_prev + α·(w − T_prev)`, τ = 7–10 días.

**Ritmo**: pendiente del Kalman × 7, expresado en **kg/sem y % peso/sem**. Nunca
`T_hoy − T_hace7días` sobre una EMA (hereda el retraso).

UI: línea de tendencia + banda ±1σ; puntos diarios en gris; no mostrar ritmo "fiable" hasta ~14 días de datos.

## 2. Gasto energético adaptativo (TDEE)

`TDEE ≈ ingesta media − ρ · (dW/dt)` sobre una ventana de 21–28 días.

**Densidad energética ρ del cambio de peso.** 7.700 kcal/kg asume ~87 % grasa. Modelo Hall/Forbes:
grasa 9.440 kcal/kg, tejido magro 1.816 kcal/kg; fracción magra `p = 10,4 / (10,4 + masa grasa kg)`.
- **Decisión [Heur]:** con entrenamiento de fuerza y proteína alta la pérdida es más grasa que lo
  que predice Forbes → `p_efectiva = 0,5·p`, y `ρ` acotado a **[5.500, 8.500]**. Sin dato de masa
  grasa: ρ = 7.000.

**Algoritmo (actualización diaria):**
1. Pendiente e incertidumbre ← Kalman (§1).
2. Ingesta del día:
   - Día con `meals_complete: true` → suma de lo registrado.
   - Día sin registrar o a medias (`meals_complete: null`) → **kcal del plan** de ese día
     (entreno/descanso). No registrar ≠ comer mal.
   - En el control semanal, una sola pregunta para los días SIN registro de los 7 revisados:
     según plan → kcal del plan · me pasé / me quedé corto con cifra semanal → plan + cifra
     repartida entre esos días · sin cifra o "no lo sé" → esos días se excluyen de la ventana.
   - Si > 50 % de la ventana son días asumidos, el TDEE se etiqueta "estimado con plan".
3. `E_obs = ingesta_media − ρ · pendiente`; varianza = ρ²·var(pendiente) + var(ingesta).
4. Suavizado bayesiano (Kalman escalar): `P += q_E` (q_E ≈ 20² kcal²/día);
   `K = P/(P + R_obs)`; `E = E + K·(E_obs − E)`.
5. Limitar el cambio diario mostrado a ±50 kcal (estabilidad).

**Prior (arranque):** `RMR × PAL`, PAL 1,4–1,8 según pasos/entreno, σ = 300 kcal.
- RMR con masa magra conocida → **Tinsley 2019** `25,9·FFM + 284` o **Cunningham** `500 + 22·FFM`.
- Sin masa magra → **ten Haaf 2014** `11,936·W + 587,728·H(m) − 8,129·edad + 191,027·(hombre) + 29,279`.
- Mifflin-St Jeor **no**: infravalora en hombres musculados (meta-análisis 2023).

Advertencias en UI: las 2 primeras semanas tras un cambio fuerte de carbohidratos generan saltos
de agua/glucógeno → se ponderan a la baja. Si se registra de menos de forma sistemática, el TDEE lo
absorbe: sirve para **dirigir la ingesta**, no como gasto "real".

## 3. Simulación "¿qué pasa si…?" y pronóstico

Modelo dinámico linealizado (regla de Hall, Lancet 2011); la regla estática de 7.700 kcal
sobreestima la pérdida a largo plazo ~2×.
```
ρ·dW/dt = I − E(W),   E(W) = E₀ + ε·(W − W₀),   ε ≈ 24 kcal/kg/día
ΔI = I_nueva − E₀ (TDEE actual),   τ = ρ/ε
W(t) = W₀ + (ΔI/ε)·(1 − e^(−t/τ))
t_objetivo = −τ · ln(1 − ε·(W_obj − W₀)/ΔI)     (argumento ≤ 0 → "no alcanzable con esa ingesta")
```
- Mostrar banda con ±1σ del TDEE.
- Uso en UI: al editar kcal → "ritmo previsto −0,31 kg/sem (−0,25 a −0,38)".
- Pronóstico de fecha para peso y para cintura (esta última por regresión lineal de las últimas
  6–8 medidas, sin modelo fisiológico).
- Horizontes largos poco fiables en gente delgada: re-proyectar siempre desde el TDEE vivo.

## 4. Objetivos de referencia (valores por defecto editables)

**Objetivo de la fase** (`targets.goal`): `loss` pérdida · `maintain` mantenimiento · `gain` volumen ·
`none` sin objetivo (solo registro). Un plan sin el campo es de pérdida (compatibilidad). El ritmo se trata
internamente como **cambio de peso con signo** (% peso/semana; negativo = bajar) y cada objetivo define
su franja (`rateBand` en `engine/targets.js`):

| Objetivo | Franja automática | Aviso (2 semanas seguidas fuera) | Kcal de más |
|---|---|---|---|
| Pérdida | según % graso (tabla de abajo) | demasiado rápido (masa magra) / demasiado lento | ámbar > +10 % |
| Mantenimiento | ±0,15 %/sem | subiendo o bajando | sin aviso |
| Volumen | +0,15–0,35 %/sem (Iraki 2019: principiantes/intermedios ≈ 0,25–1,5 %/mes) | demasiado rápido (grasa) / demasiado lento | sin aviso |
| Sin objetivo | — | ninguno; sin previsión | sin aviso |

Kcal y macros del plan son **opcionales** (null). Sin kcal, o con «Sin objetivo», los días sin registrar no
se suponen «según el plan»: el gasto (§2) usa solo los días registrados o validados.

| Parámetro | Valor por defecto | Fuente |
|---|---|---|
| Ritmo de pérdida (auto según % graso y sexo) | Hombres > 20 %: **0,7–1,0** · 13–20 %: **0,4–0,7** · < 13 %: **0,25–0,5** % peso/sem. Mujeres: mismos ritmos con cortes 9 puntos más altos (> 29 · 22–29 · < 22) por la mayor grasa esencial (~12 % vs ~3 %) | Helms 2014, Garthe 2011 [MA/RCT]; la prioridad de conservar músculo baja el ritmo cuanto más delgado |
| Recomposición | mantenimiento a −0,25 %/sem | Helms, Iraki 2019 [Exp] |
| Alerta ritmo alto | > 1 %/sem sostenido 2 semanas | Garthe 2011 |
| Proteína en déficit | **2,3–3,1 g/kg masa magra**; sin % graso: ~2,2 g/kg peso (mín. 1,6) | Helms 2014; Morton 2018; revisiones 2024–25 |

## 5. Composición corporal

**Decisión:** la métrica principal es la **suma de pliegues (mm)**; el % graso es secundario y se
muestra como **rango** con el nombre de la ecuación. Motivo: distintas ecuaciones dan, para la
misma persona, entre ~11 % y ~28 % (PMC7660690); la suma no tiene modelo detrás.

| Método | Fórmula (hombres) | Uso |
|---|---|---|
| **Σ5 pliegues** | tríceps + subescapular + abdominal + supraespinal + muslo frontal | Métrica principal |
| Faulkner (4 pliegues) | `%G = 0,153·Σ4 + 5,783` (tríceps, subesc., supraespinal/suprailíaco, abdominal) | %G secundario, compatible con plantillas en español. Sin error estándar publicado → rango ±4 |
| Yuhasz (6) | `%G = 0,1051·Σ6 + 2,585` | Solo si se añade pliegue de pantorrilla |
| Jackson-Pollock 3/7 | densidad → Siri `495/D − 450` | Opcional (requiere otros pliegues) |
| **US Navy** | `%G = 495 / (1,0324 − 0,19077·log10(cintura − cuello) + 0,15456·log10(altura)) − 450` | Semanas sin plicómetro. Infravalora ~2,6 pts vs DXA |
| RFM | `64 − 20·(altura/cintura)` | Alternativa sin cuello |
| Cintura/altura | `cintura / altura`; <0,5 sano, 0,5–0,59 elevado, ≥0,6 alto (NICE NG246) | Salud |
| Masa magra | `peso · (1 − %G/100)` | |
| FFMI | `FFM / altura²`; normalizado `+ 6,1·(1,8 − altura)` | |

**Reglas:**
- Guardar **qué sitio** se midió (supraespinal ≠ cresta ilíaca; cintura en ombligo ≠ punto medio
  OMS). Nunca cambiar de sitio a mitad de serie.
- Una ecuación fija para todo el histórico; si se cambia, se recalcula todo.
- **Cambio mínimo detectable** (MDC95 ≈ 2,77·TEM): ~2,5 cm en cintura, ~8 mm en Σ5. La UI
  marca un cambio como "real" solo si supera el MDC; si no, "dentro del margen de error".
- Tendencia de medidas = media móvil de 3–4 controles.
- Protocolo: por la mañana, en ayunas, tras orinar, sin entrenar en las 12 h previas, lado
  derecho, mismo instrumento. La cintura sube ~1,3 cm por la tarde.

## 6. Entrenamiento

**e1RM** — Epley ajustado por RIR: `reps_ef = reps + (10 − RPE)`, `e1RM = kg · (1 + reps_ef/30)`,
`reps_ef` limitado a 15. Solo series con RPE ≥ 7; RIR ≥ 4 = baja confianza. Métrica de
**tendencia por ejercicio**, nunca comparable entre ejercicios. (Marzagao 2026, fórmula dependiente
de la carga: pendiente de revisión por pares; candidata futura.)

**Volumen** — series duras (0–4 RIR) con **conteo fraccional**: directo 1, indirecto 0,5
(Pelland 2025 [MA]). Mapa en el catálogo de ejercicios. Rango por defecto **10–20 series
fraccionales/músculo/semana**; mostrar la curva de rendimientos decrecientes (√).

**Autorregulación semanal** (estilo RP [Exp]). Sustituye a la escala 0–3 de la plantilla antigua.
Por grupo muscular: **Agujetas** 1–4 (1 nunca, 2 curadas de sobra, 3 justo a tiempo, 4 aún con
agujetas) y **Rendimiento** 1–4 (1 superado con facilidad, 2 cumplido, 3 costó, 4 no igualé).
Opcional: bombeo 0–2.

| Condición | Próxima semana |
|---|---|
| Agujetas 1 y Rendimiento 1 | +2–3 series (+1 si avanzado) |
| Ambos ≤ 2 | +1 serie |
| Agujetas 3 con Rend. ≤ 2, o Rend. 3 con Agujetas ≤ 2 | Mantener |
| Agujetas 4, o Rend. 3 con el otro ≥ 3 | Mantener o −1 + sesión de recuperación |
| Rendimiento 4 | Recuperación/descarga de ese músculo |
| Rend. 4 dos semanas o ≥ 2 músculos en descarga | Descarga global |

El rendimiento pesa más que las agujetas (marcador débil que se habitúa).
**En déficit** [MA]: mantener cargas e intensidad; volumen ≥ 10 series si el rendimiento aguanta;
un e1RM **estable** cuenta como éxito.

**Progresión y estancamiento** [Exp/Heur]:
- Doble progresión: si todas las series llegan al tope del rango con RPE ≤ objetivo → sugerir
  +2,5 % (tren inferior) / +1–2,5 % (superior) o el menor salto disponible.
- Estancado: e1RM (mediana de las 3 últimas sesiones) sin subir ≥ 1–2 % en 3–4 exposiciones.
- Regresión: e1RM −3–5 % respecto al mejor reciente en 2 exposiciones.
- Se ignoran semanas de descarga.

## 7. Recuperación diaria

Marcadores subjetivos (1–5: sueño, fatiga, agujetas, estrés, motivación) son los más sensibles
(Saw 2016 [MA]). Pulso en reposo y VFC opcionales.
- Línea base = media y desviación de 28 días; alerta si |z| ≥ 1 (≥ 1,5 un solo día).
- Solo sugerir acción con ≥ 2 señales o ≥ 2 días seguidos. Nunca por un único valor de VFC.
- Pulso en reposo +5 lpm sostenido = señal [Heur]. Sueño ≤ 6 h afecta al rendimiento del día siguiente.

## 8. Fotos

Misma hora, luz difusa fija, fondo liso, trípode a la altura del ombligo a 2–3 m, marcas en el
suelo, misma ropa. Poses: frente, perfil y espalda relajados (+ serie opcional en tensión).
App: superposición "fantasma" de la anterior; comparar cada 4–8 semanas.

---

## Fuentes
- Tendencia: [Hacker's Diet](https://www.fourmilab.ch/hackdiet/e4/signalnoise.html) · [Libra](https://libra-app.eu/support/trend/) · [MacroFactor weight trend](https://help.macrofactorapp.com/en/articles/21-weight-trend)
- TDEE: [MacroFactor Expenditure V3](https://macrofactor.com/expenditure-v3/) · [SBS: algoritmos MacroFactor](https://www.strongerbyscience.com/macrofactor-algorithms-philosophy/) · [Hall 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC2266991/) · [Hall 2011 Lancet](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/)
- Ritmo y proteína: [Helms 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4033492/) · [Garthe 2011](https://pubmed.ncbi.nlm.nih.gov/21558571/) · [Iraki 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC7052702/) · [Morton 2018](https://pubmed.ncbi.nlm.nih.gov/28698222/) · [SBS proteína](https://www.strongerbyscience.com/protein-science/)
- RMR: [Tinsley 2019](https://cdnsciencepub.com/doi/abs/10.1139/apnm-2018-0412) · [Meta-análisis 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10687135/)
- Composición: [Dispersión entre ecuaciones](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7660690/) · [Faulkner/Yuhasz](https://www.researchgate.net/publication/26460946) · [Navy vs DXA](https://pmc.ncbi.nlm.nih.gov/articles/PMC9008774/) · [RFM](https://www.nature.com/articles/s41598-018-29362-1) · [NICE NG246](https://www.nice.org.uk/guidance/ng246/chapter/Identifying-and-assessing-overweight-obesity-and-central-adiposity) · [Kouri 1995](https://pubmed.ncbi.nlm.nih.gov/7496846/) · [IOC 2012](https://link.springer.com/article/10.2165/11597140-000000000-00000)
- Entrenamiento: [Pelland 2025](https://link.springer.com/article/10.1007/s40279-025-02344-w) · [Robinson 2024](https://link.springer.com/article/10.1007/s40279-024-02069-2) · [Zourdos 2016](https://pubmed.ncbi.nlm.nih.gov/26049792/) · [Refalo 2024](https://journals.lww.com/nsca-jscr/abstract/2024/03000/accuracy_of_intraset_repetitions_in_reserve.26.aspx) · [RP volume landmarks](https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth) · [Murphy & Koehler 2022](https://onlinelibrary.wiley.com/doi/10.1111/sms.14075) · [Roth 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9012799/)
- Recuperación: [Saw 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4789708/) · [Craven 2022](https://link.springer.com/article/10.1007/s40279-022-01706-y)

## Pendiente de verificar antes de implementar
- Constante de Forbes (10,4) y parámetros q/σ del Kalman: heurísticas de partida, calibrar con datos reales.
- Coeficientes exactos de Jackson-Pollock y de la fórmula de un solo sitio del Ejército de EE. UU. (fuentes primarias no accesibles).
- Redacción exacta de la escala RP (web 0–2 vs libro 0–3 para estímulo).

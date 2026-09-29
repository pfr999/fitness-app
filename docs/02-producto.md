# 02 · Producto

## Principios
1. **Registrar en segundos.** Lo diario (peso) en ~10 s; el control semanal en ~5 min.
2. **Todo editable desde el móvil**, incluido el plan. Cambiar el plan es tan fácil como registrar.
3. **Solo se guarda lo medido.** Todo lo derivado (% graso, tendencias, TDEE…) se calcula al vuelo.
4. **Tendencias antes que números sueltos.** Las fórmulas tienen error; la dirección importa más.
5. **Cada cambio de plan deja rastro** (versión + motivo) y aparece en las gráficas.
6. **Cliente y preparador son la misma persona**: la app no solo registra, también recomienda.

## El ciclo semanal
```
registrar (diario + domingo) → resumen calculado → decisión → ajuste del plan → "hoy toca"
```

## Pestañas (4)
| Pestaña | Rol | Contenido |
|---|---|---|
| **Hoy** | Cliente | Con **subpestañas** para evitar el scroll infinito: **Día** (peso protagonista, accesos rápidos, suplementos, aviso de domingo) · **Comidas** (anillo de kcal, gramos de P/C/G vs objetivo, tarjeta por comida) · **Entreno** (sesión del día con última carga y registro de series). |
| **Domingo** | Cliente → Preparador | Recorrido guiado con pasos **saltables**: medidas → fotos → cómo ha ido (incluye confirmar los días asumidos) → autorregulación (por defecto «normal», se toca solo lo que se sale) → nota → **resumen automático** → decisión → copiar para IA. |
| **Progreso** | Ambos | KPIs, gráfica de peso (diario + tendencia + fases + eventos), cintura, composición, TDEE, fuerza, comparador de fotos, analíticas, pronóstico. Cada número indica la fórmula usada. |
| **Plan** | Preparador | Rutina, dieta, suplementos/medicación, objetivos y alertas. Versionado. Ajustes rápidos con previsión. |

Perfil y ajustes (fórmulas, métricas registradas, token) se abren desde el encabezado.

## Ajuste rápido del plan
- Kcal: `+100`, `−150` o valor exacto → muestra **ritmo previsto** con el TDEE adaptativo.
- Ejercicio: sustituir (el catálogo conserva el historial de cada ejercicio).
- Series: subir/bajar por grupo muscular (sugerido por la autorregulación).
- Suplemento/medicación: alta, baja, dosis.
- Al guardar: motivo opcional → nueva versión del plan + evento en el timeline.

## Registro de comidas
- Por cada comida del plan: buscar alimento → gramos → se suman kcal, proteína, carbohidratos y grasas.
- Totales por comida y por día **frente al objetivo de ese día** (entreno o descanso) en gramos. El objetivo de cada comida se deriva de las porciones del plan.
- **Botón «Día completo ✓»** en Comidas: confirma que lo apuntado es todo lo que se comió ese día (`meals_complete`). Solo esos días usan lo registrado para el gasto; se puede desmarcar.
- **Un día sin registrar, o a medias, no significa que se comió mal**: se asume el plan hasta que el domingo se confirme (o no) la adherencia de esos días.
- Atajos: recientes/frecuentes, copiar comida de ayer, recetas guardadas, entrada manual de macros.
- Búsqueda local e instantánea sobre `alimentos.json` (sin conexión). Porciones del plan solo como ayuda visual.

## Registro diario
- Obligatorio: nada. Protagonista: peso en ayunas.
- Opcionales: pasos, sueño, pulso en reposo, energía/fatiga (1–5), notas.
- Campos adicionales configurables (catálogo de métricas).

## Diseño
- Mobile-first, controles ≥ 44 px, teclado numérico en campos numéricos.
- Tema claro/oscuro automático.
- Colores: un acento para "progreso/acción", otro para "eventos/avisos". Nunca solo rojo/verde.
- Vacíos útiles: las gráficas explican qué hace falta para aparecer (p. ej. "TDEE: 3 semanas de datos").
- Objetivo de ritmo por defecto **según % graso** (ver 04 §4); editable.
- Fecha del día en hora local (pesarse a las 00:30 no cae en ayer).

## Fases
1. **MVP:** peso diario, recorrido de domingo (medidas, fotos, resumen, decisión), progreso (peso, cintura, TDEE), plan editable. ✅
2. **Comidas:** base de alimentos, buscador, gramos, totales vs objetivo, alimentos propios, escáner, día completo. ✅ (recetas: pendiente)
3. **Entreno detallado:** catálogo de ejercicios, registro de series, e1RM, volumen, autorregulación. ✅
4. Analíticas, importación del Excel histórico, cola sin conexión.

Condición: **usar el MVP 2–3 semanas** antes de construir la fase 2. Ahí se verá qué sobra.

## Buscador de alimentos (detalle)
- Texto libre: `patata mercadona cocida bote` → *Patata cocida en conserva · Hacendado · Mercadona*.
- Sin acentos ni mayúsculas, palabras en cualquier orden, coincidencia por prefijo.
- Sinónimos: tienda ↔ marca blanca (mercadona → Hacendado, Deliplus, Bosque Verde; lidl → Milbona, Crownfield…),
  formato (bote ↔ frasco ↔ conserva ↔ lata), preparación (cocida ↔ cocido ↔ hervida).
- Sin texto: muestra tus frecuentes. Orden: frecuentes > coincidencia de marca/tienda > resto.
- Cada resultado indica su origen: **Genérico** (CIQUAL), **Producto** (Open Food Facts) o **Mío**.
- Tras elegir: cantidad en gramos (atajos 50/100/150/200) con macros en vivo → "Añadir a <comida>".
- Sin resultados → escanear código o **crear alimento** (valores de la etiqueta por 100 g).
- Atajo por comida vacía: "Copiar de ayer".

## Integraciones con dispositivos (reloj)
Principio: **la app no depende de ninguna integración**; todo se puede teclear. Las integraciones
son opcionales y se añaden solo si no exigen infraestructura.

| Fuente | Fase 1 (MVP) | Opción posterior | Descartado |
|---|---|---|---|
| Reloj (Samsung Health) | Pasos, sueño y pulso en reposo tecleados desde lo que muestra el reloj (~5 s). % graso por bioimpedancia del reloj como métrica semanal opcional. | Importar el export de Samsung Health (CSV) desde el móvil; o automatización Android (Tasker/MacroDroid + Health Connect → API de GitHub), sin verificar. | App nativa propia (Health Connect solo es accesible para apps nativas en primer plano). |

## Modelo actual (v0.7): Hoy · Semana · Progreso · Plan
- **Hoy → Día** es una lista del día (comidas, entreno, pasos, sueño, suplementos, nota) con estado y
  acceso directo; al final **«Revisar y cerrar el día»** abre la misma ventana que la revisión semanal.
- **Semana** (antes «Control»): tabla de los 7 días (tocar un día = revisarlo y validarlo: peso, pasos,
  sueño, entreno y dieta: lo apuntado es todo / según plan / me pasé ±kcal / me quedé corto / no lo sé),
  **balance de la semana** (kcal media vs objetivo con días registrados/estimados/sin validar, déficit,
  macros de los días registrados, pasos, sesiones, sueño, peso, series por músculo) y el control.
- **Control semanal** en 6 pasos: revisar los días → medidas → fotos → cómo ha ido → entreno
  (autorregulación) → balance y decisión. Pensado para hacerse con calma: de ahí salen las conclusiones.
- Un control pertenece a la semana del **día de control más cercano** (±3 días): hecho el lunes, cierra
  la semana que terminó el domingo. De lunes a miércoles la pantalla Semana muestra la semana por cerrar.
- El botón «atrás» del móvil navega dentro de la app (hoja → paso/subpestaña → pestaña).

## Ideas pedidas (hechas en v1.0–v1.3)
- **Ir a un día concreto:** icono de calendario para saltar a cualquier fecha y ver qué se hizo
  (comidas, entreno, peso, notas), sin ir día a día.
- **«Mis alimentos» explícito al añadir comida:** un apartado propio con los alimentos de siempre
  («sota, caballo y rey»: ~10 que dan adherencia) y guardar uno ahí en un toque. Todo lo que se repite
  debe costar lo mínimo (comidas guardadas, repetir de otro día…).

## v1 (sept. 2026): lo que cambió
Ver `docs/05-investigacion-apps.md` para el porqué.
- **Hoy:** tira de la semana con el estado de cada día (deslizar = día; en la tira = semana), icono de
  calendario (mes con estado, entrenos y controles; atajos Hoy/Ayer/−7), anillos de kcal y proteína, peso
  de tendencia y una frase del día.
- **Comidas:** «Sueles poner en…», Mis alimentos (⭐, con cantidad), comidas guardadas, recientes,
  bandeja con «cómo queda el día», última cantidad y habituales, calculadora inversa, añadido rápido,
  menú ⋯ (copiar a hoy/mañana/otro día, guardar, renombrar, borrar), copiar el día de ayer.
- **Entreno:** descanso a mano (botones 1 · 1,5 · 2 · 3 min), «Antes» por serie, objetivo en verde, RPE con
  botones, W de calentamiento, récords por reps, nota fija por ejercicio, cambiar ejercicio
  solo hoy o en la rutina.
- **Progreso:** gasto con confianza y porqué, balance de 30 días, línea de objetivo, fotos lado a lado /
  deslizar / superponer, constancia de 26 semanas.
- **Semana:** control rápido de 3 pasos cuando no hay incidencias.
- **v1.4:** mesociclos (Plan → Rutina: semanas con RIR objetivo y descarga; Entreno te dice qué toca),
  recetas con peso cocinado (Añadir → «+ Receta» o ⋯ de una comida), fotos sin conexión, estado de
  guardado solo si hay problema y ritmo objetivo según sexo.
- **v1.5:** Plan → Recetas (recetas con preparación, comidas guardadas y Mis alimentos, fuera del día);
  al apuntar una receta, «un plato» o «por ingredientes»; «Desglosar en ingredientes» en un plato ya
  apuntado; «Lo que más aporta» en Comidas.
- **v1.5.1:** Progreso con «Todas las medidas» (cada medida del control con su evolución), «Comparar dos
  datos» (medias semanales de dos series a elegir, con su correlación y la advertencia de que no es causa)
  y «Resumen del mes».
- **v1.6:** objetivo de la fase en Plan → Objetivos: **Pérdida · Mantenimiento · Volumen · Sin objetivo**.
  El ritmo, los avisos, la previsión, los colores y las frases del día dependen del objetivo; en
  mantenimiento y volumen pasarse de kcal no se marca. Kcal y macros del plan son opcionales: sin ellos,
  Comidas enseña lo que llevas y el gasto usa solo los días registrados.
- **v1.6.1:** Entreno: un día marcado como descanso enseña solo «Día de descanso» (sin pestañas ni
  ejercicios) con «Quitar descanso» para volver a la rutina si fue un error.

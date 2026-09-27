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
1. **MVP:** peso diario, recorrido de domingo (medidas, fotos, resumen, decisión), progreso (peso, cintura, TDEE), plan editable.
2. **Comidas:** base de alimentos, buscador, gramos, totales vs objetivo, alimentos propios y recetas, escáner.
3. **Entreno detallado:** registro de series, e1RM, volumen, autorregulación.
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

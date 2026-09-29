# Investigación: qué hacen las apps del mercado (sept. 2026)

Objetivo: sacar ideas de funcionalidad, rapidez y diseño para Recomp. **Nada de esto está implementado**;
es la cartera de ideas para decidir con el usuario. Apps revisadas (webs oficiales, centros de ayuda,
reseñas 2025-26):
- Dieta: FatSecret, MyFitnessPal, Yazio, Lose It!, Fitia, MacroFactor, Cronometer, Carbon, RP Diet.
- Entreno: Hevy, Strong, RP Hypertrophy, Boostcamp, Fitbod, Alpha Progression, JEFIT.
- Progreso y hábitos: Happy Scale, Libra, Withings, Apple/Samsung Health, Oura, Whoop, Streaks,
  HabitKit, Gentler Streak, apps de fotos de progreso.

## Conclusiones generales
1. **La velocidad de registro decide si la app se sigue usando.** El referente es MacroFactor, que midió
   las acciones por tarea: 24 frente a unas 40 de la competencia. La clave es que lo repetido cueste
   1–2 toques.
2. **Las apps «bonitas» usan pocos colores con significado fijo, cifras grandes y detalle bajo demanda**
   (Whoop, Oura, MacroFactor). Los rediseños que llenaron el inicio de tarjetas (MFP 2026) o de imágenes
   (Strong 6) fueron muy criticados.
3. **Neutralidad, no castigo.** Nada de rojo por pasarse 50 kcal ni rachas que caen a 0. Ejemplos: la
   barra de Fitia verde dentro de ±10 % y ámbar fuera; MacroFactor marca el objetivo alcanzado sin culpa;
   Happy Scale deja elegir el color de las subidas.
4. **Las reglas deben ser visibles.** Se critica a RP y Fitbod por ser cajas negras. La app debe decir
   siempre *por qué* sugiere algo y dejar aceptarlo o ignorarlo.
5. Casi todo lo que en esas apps es de pago (código de barras, copiar días, macros por comida, objetivos
   entreno/descanso, informes, sin anuncios) aquí sale gratis por diseño.

## Ideas por área (★ = encaja con lo que ha pedido el usuario)

### Registro de comida
- ★ **«Mis alimentos» / favoritos explícitos.** Un apartado propio al añadir, con un toque para guardar.
  MacroFactor guarda el favorito **con su cantidad** (p. ej. «Avena 60 g» y «Avena 80 g» son dos favoritos)
  y los pone en una barra arriba del buscador: se registra con un toque.
- ★ **Recordar la última cantidad** de cada alimento y ofrecer las 2–3 cantidades habituales como botones
  (Carbon, Cronometer). Hoy los botones son fijos (50/100/150/200).
- **Sugerencias por hora del día** (la «Smart History» de MacroFactor): al abrir «Añadir», antes de escribir
  nada, sale lo que sueles comer a esta hora con tu cantidad y un «+». Basta con contar por franja horaria;
  no hace falta IA.
- **Añadir varios de golpe con una bandeja**: marcar varios alimentos y ver cómo quedaría el día antes de
  confirmar (el Plate de MacroFactor, el «ojo» de Carbon).
- ★ **Comidas guardadas** (conjunto de alimentos con cantidades) y **sugerir guardar** las combinaciones
  que se repiten (Smart Adding de Yazio).
- **Copiar y pegar con destinos claros**: comida o día entero → hoy, mañana o varios días; «Repetir esta
  comida los próximos días» (Fitia, MacroFactor). Ya existe «Copiar de ayer» en comidas vacías.
- **Registro por texto**: «150 g pollo, 200 g arroz, 10 g aceite» se interpreta sin IA (Registro
  Inteligente de Fitia).
- **Calculadora inversa**: «¿cuántos gramos para 30 g de proteína?» o «rellena la proteína que me falta
  con esto» (Carbon).
- Añadir rápido kcal y macros sin alimento (para comer fuera). Macros por comida en su cabecera.

### Navegación y días
- ★ **Tira de la semana arriba, más un calendario en una hoja.** Cada día con un punto o mini-barra de
  estado; deslizar para cambiar de día o semana; atajos Hoy / Ayer / −7 días; sin días futuros; al tocar
  un día se ve todo lo registrado (MacroFactor, MFP 2026).
- **Calendario mensual con color por día** según tolerancia (verde/ámbar, sin rojo) y según si el día está
  validado. Encaja con la validación diaria que ya existe.
- Cambio de día animado (View Transitions API, ya disponible en Chrome y Safari).

### Entreno
- **Temporizador de descanso automático al marcar ✓**: duración por ejercicio, barra fija con ±15 s y
  saltar, y que siga contando en negativo (Alpha). Se calcula con la hora guardada, no con `setInterval`.
- **Pantalla siempre encendida** durante la sesión (Screen Wake Lock API).
- **Columna «anterior» por serie**, tocable para copiar. Objetivo sugerido con otro color.
- **RPE con botones 6–10** (pasos de 0,5) coloreados, en lugar del teclado (Strong, Hevy).
- **Récords por número de reps** y aviso de récord al marcar la serie (Strong, Hevy).
- **Series de calentamiento (W)** que no cuentan para volumen ni récords; calculadora de discos.
- Notas fijas del ejercicio (asiento, agarre) separadas de la nota del día.
- Cambiar de ejercicio a mitad de sesión con «solo hoy / a partir de ahora».
- Serie actual resaltada y ejercicios terminados plegados.
- **Mesociclos**: rejilla de semanas × días con el RIR objetivo por semana y la descarga generada
  automáticamente (RP). Ya estaba en la hoja de ruta.
- Preguntas de RP en el momento (pump y carga al terminar un músculo) para precargar la autorregulación
  del domingo.

### Peso, progreso y control
- Peso del día en puntos pálidos y tendencia en línea fuerte. Ritmo y fecha estimada de objetivo, con
  «—» si vas en contra (Libra, Happy Scale).
- **Fotos: comparar deslizando o superpuestas**, y una **silueta «fantasma»** de la foto anterior al
  hacer la nueva para repetir la postura (Metamorph, Progress Pics).
- Gasto (TDEE) con la confianza visible y **una frase que explique por qué ha cambiado** (MacroFactor).
- Balance de 30 días: frente al objetivo («¿cumplo el plan?») y frente al gasto («¿el plan funciona?»).
- Control semanal **modular**: los pasos solo aparecen si aportan algo, cada uno dice por qué sale, y
  hay un «control rápido» para semanas sin incidencias (MacroFactor).
- Celebraciones puntuales: nueva cintura mínima, nuevo récord, semana cerrada. Animación breve.
- Mapa de calor anual de constancia (HabitKit) o racha **semanal** (Hevy), nunca diaria punitiva.

### Diseño («que sea bonita»)
- Cifra protagonista grande y el resto pequeño; números con `tabular-nums` para que no bailen.
- 3–4 colores con significado fijo en toda la app.
- Oscuro en gris muy oscuro (no negro), con superficies más claras para dar elevación.
- Nada de pantallas de carga: pintar al instante desde la caché (ya se hace).
- Vacíos con una sola acción clara.
- Microanimación al marcar (✓ serie, día cerrado); vibración corta en Android. Respetar
  `prefers-reduced-motion`.
- Pocas pantallas y pocas tarjetas: Oura pasó de 5 pestañas a 3.
- Accesos directos del icono de la app (manifest `shortcuts`): Pesarme / Añadir comida / Escanear.

## Anti-patrones
- Rojo culpabilizador, rachas que caen a 0, textos de culpa.
- Inicio lleno de tarjetas gigantes, con lo importante tras «Ver todo» (MFP 2026).
- Copiar escondido en 7 pasos (Yazio); funciones solo accesibles con gestos o menús «⋯».
- Buscador que no pone lo tuyo primero.
- IA de fotos como método principal: acierta el alimento y falla la cantidad un 25–45 %.
- Sugerencias sin explicar (Fitbod) y falsa precisión («recuperación 73 %»).
- Un ejercicio por pantalla (JEFIT); ventanas a mitad de serie.
- Perder datos sin autoguardado (Strong); depender de la red (RP).

## Límites técnicos de una PWA a tener en cuenta
- En iOS no hay notificaciones locales programadas ni vibración. En Android `navigator.vibrate` funciona.
- Los recordatorios reales necesitarían un servidor: descartado. Alternativas: aviso al abrir la app o un
  recordatorio del calendario del móvil.
- Wake Lock, View Transitions, `<dialog>` y scroll-snap están disponibles en Chrome para Android.

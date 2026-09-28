# Recomp — documentación de producto

App personal de seguimiento de recomposición corporal para alguien que se prepara a sí mismo
(cliente y preparador son la misma persona). Sustituye a la clásica plantilla Excel de
autocontrol + PDFs de dieta/rutina por una única fuente de verdad usable desde el móvil.

| Documento | Contenido |
|---|---|
| [01-arquitectura.md](01-arquitectura.md) | Stack, repos, flujo de datos, seguridad |
| [02-producto.md](02-producto.md) | Principios, pantallas, flujos de uso |
| [03-modelo-datos.md](03-modelo-datos.md) | Estructura de `data.json` y ficheros |
| [04-motor-calculo.md](04-motor-calculo.md) | Fórmulas y algoritmos, con fuentes |
| [decisiones.md](decisiones.md) | Registro de decisiones (ADR ligero) |
| [formato-plan.md](formato-plan.md) | Formato para diseñar el plan con Claude e importarlo |
| mock.html | Prototipo navegable (solo local, no se sube: contiene datos personales) |

Fuentes de datos de alimentos: CIQUAL 2025 (ANSES, Licence Ouverte) y Open Food Facts (ODbL).

Regla de esta carpeta: aquí solo va información **del producto**. Nada de datos personales
del usuario (medidas, salud, planes concretos): eso vive únicamente en el repo privado de datos.

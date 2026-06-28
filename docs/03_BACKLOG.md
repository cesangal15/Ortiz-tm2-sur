# BACKLOG — TM2 Sur

## V1 — Alcance actual (✅ cerrado jun-2026)

| # | Ítem | Estado |
|---|---|---|
| 1.1 | Login multi-rol (admin, encargado, 5 capataces, 2 chequeadoras) | ✅ Hecho |
| 1.2 | Formulario capataz: actividades con producción adaptativa + equipos anidados | ✅ Hecho |
| 1.3 | Formulario chequeadora: origen + viajes por PK destino | ✅ Hecho |
| 1.4 | Panel encargado: bandeja con toggles, totales, edición, Enviar a DATA, WhatsApp | ✅ Hecho |
| 1.5 | Backend Apps Script v6 (BANDEJA / MAQUINARIA / DATA) | ✅ Hecho |
| 1.6 | DATA alineada al maestro TM2 (paste A:S) | ✅ Hecho |
| 1.7 | ZODME automático; cereo no_data; estado derivado | ✅ Hecho |
| 1.8 | Hoja RESUMEN_MES en Modelo_Produccion (períodos 16–15, producción individual) | ✅ Hecho (validar con datos reales) |
| 1.9 | Máquinas nuevas en dim (FNG02, CR08–CR26, PEXC027) | ✅ Hecho (datos de referencia) |
| 1.10 | Prueba punta a punta del flujo bandeja → DATA con día real completo | ✅ Hecho (probado en ejecución real con chequeadoras enviando; residuales menores derivados a V2: WhatsApp de prueba = 2.6, ajustes de interfaz de DATA) |
| 1.11 | Alinear hoja MAQUINARIA del Sheets al orden de Captura_Diaria | ✅ Hecho (Codigo.gs: layout A→AA + internos tras AA, derivaciones H/I/R/O/T y flag a_captura, D52). Hoja MAQUINARIA recreada al layout D52 (respaldo MAQUINARIA_OLD) y redespliegue verificado con reporte real |
| 1.12 | Completar catálogo de máquinas (IDs reales de vibros/alquiladas faltantes) | ✅ Hecho |
| 1.13 | Corregir marca/modelo/valor-hora de máquinas nuevas en dim | ✅ Hecho |
| 1.14 | Contraseñas definitivas para encargado y chequeadoras | ✅ Hecho (capataces ✅, chequeadoras ✅ con clave común cheq2025; el encargado se deja con su placeholder aceptado por el usuario) |
| 1.15 | Desglose por placa en reporte de chequeadora (textarea + parser, hoja VOLQUETAS) | ✅ Hecho (validado con datos reales, jun-2026) |
| 1.16 | Confirmación de envío en reporte-chequeadora.html (cuenta de filas del servidor, igual que capataz, D30). Detectado al validar 1.15. | ✅ Hecho |
| 1.17 | Detección de máquina duplicada por `reporta` en el panel del encargado (D51): solo es duplicado si el mismo `id_maquina` viene de dos capataces distintos | ✅ Hecho (encargado.html: agrupa por id_maquina; 1 capataz = reparto D46 con horas muertas = prog − Σ operadas; ≥2 capataces = conflicto con toggle ✓/✕ incluir/descartar) |
| 1.18 | Carga de minicargador (NH421, DINISSAN, alquilada 5h) y minibuldózer (CR026, ORTIZ, propia 6.4h) — ambos sin producción (igual a vibrocompactadores; IDs reasignados desde la lista de vibros descartada por D35). **+ limpieza de catálogo:** eliminar la pajarita PEXC027 del listado de máquinas en código; en reporte-chequeadora.html el selector de máquina muestra **solo excavadoras** (no el resto de tipos). | ✅ Hecho — pendiente redeploy (Pages + nueva versión Apps Script) |

## V2 — Mejoras identificadas (no iniciar sin cerrar V1)

| # | Ítem | Origen |
|---|---|---|
| 2.1 | **Emparejamiento chequeadora↔capataz anclado en la actividad del capataz, por ZONA de PK (no fila a fila).** Bucket terraplén = núcleo + corona del capataz (ambos mapean a TERRAPLEN) contra las filas OFICIAL de la chequeadora. Empareja por UF (filtro duro) + cercanía usando el **punto medio** del rango del capataz vs el PK de la chequeadora (los rangos vienen sucios —invertidos, con typos, p.ej. 38+500–35+800—; nunca usar los extremos). **Muchos-a-muchos por zona:** varias filas de chequeadora en una zona se **suman** (un PK recibe varios orígenes) y los frentes de capataz de esa zona comparten la suma; el cuadre se valida a nivel de zona. **Desfase sistemático** (3 días reales): el frente de albert sale ~35+xxx (capataz) vs ~34+6xx (chequeadora) → la tolerancia debe absorber ~500–800 m; parqueado, una mini-tabla de equivalencias de PK para frentes recurrentes (no construir aún). **Sin pareja clara / huérfanos** (volumen oficial sin frente = capataz que no reportó; o frente sin chequeadora) → el sistema no los empareja: los marca y el encargado los confirma a mano. **Abierto:** ancho de la tolerancia y definición operativa de "zona". | D29, refinado con 3 días reales jun-2026 |
| 2.2 | Clima en formularios y su flujo al Excel | D37 |
| 2.3 | Festivos marcados en RESUMEN_MES (rojo, como histórico) | D38 |
| 2.4 | **Reemplazar la producción estimada del capataz por el volumen reconciliado de la chequeadora**, solo para máquinas reportadas por el capataz cuyo frente sea **excavación o terraplén/ZODME** (02.05/02.06/02.07/02.08). Excluye subbase/base/BTC/MSR/desmonte (ahí el dueño del número es el capataz, ya es oficial) y vibros/apoyo (producción nula). Producción de la máquina = volumen oficial de **su zona** (la suma de 2.1); si hay 2+ máquinas en la zona, ÷ nº de máquinas (consistente con D54). **✅ Hecho como panel manual** (`produccion-maquinaria.html`, D59): admin consulta una fecha y ajusta la producción de MAQUINARIA con el oficial de DATA; cruce por **CC + proyecto/UF** (las filas de MAQUINARIA no llevan PK por el layout D52, así que el emparejamiento fino por zona de PK de 2.1 sigue pendiente para automatizarlo). Excavación prellena oficial÷nº máquinas (D54); terraplén/ZODME en blanco para reparto manual. Endpoint nuevo `?action=maquinaria_produccion` (GET cruce / POST parcha solo col T); guarda el estimado original en `produccion_capataz_orig`. **Resuelve la tensión de D55** por una vía aislada: el ajuste va directo a MAQUINARIA, **nunca** a DATA. **Ampliado (D60):** el panel muestra el panorama del día (frentes por actividad con su oficial aunque no tengan máquina, demás máquinas productivas en lectura, indicador multi-actividad) y permite **redirigir** la producción huérfana (ZODME, no aprovechable) a cualquier máquina creando su fila en MAQUINARIA. **D61:** muestra PK oficial (DATA) y PK del capataz por máquina + horas; lista las máquinas faltantes y permite registrar sus horas manualmente. **D62:** motivo de horas (estado derivado) + faltantes asignables a un frente o a una actividad complementaria sin producción (cereo/compactación/apoyo), saliendo de la lista al asignarlas. Pendiente validación con datos reales + redeploy. | Conversación maquinaria; refinado jun-2026; panel + panorama jun-2026 |
| 2.5 | Actividades secuenciales adicionales (vendrán con las máquinas nuevas) | Usuario |
| 2.6 | Generación del mensaje WhatsApp con desglose idéntico al formato histórico (equipos por actividad, secciones MSR) | ✅ Hecho (jun-2026) — MSR sin total mixto + líneas por nombre de actividad; excavación aprovechable agrupada por banco de origen con subtotales (D56) |
| 2.7 | Registro de flota de volquetas (Ortiz vs particulares) | ✅ Resuelto fuera de la app — el cruce placa→empresa/cubicaje vive en la Bitácora de Transporte; la app solo lee cubicaje vía hoja CUBICAJE (D53) |
| 2.8 | Modo sin conexión Nivel 2 (captura offline + cola + sync) en capataz y chequeadora; encargado fuera. Requiere UUID en cliente para dedupe (toca Codigo.gs) y sesión en localStorage | D49 |
| 2.9 | Escalamiento a Nivel 3 (service worker / PWA, carga sin señal desde cero) — solo si en pruebas el celular pierde la pestaña en zona muerta | D49 |
| 2.10 | **Cubicaje real por placa** (primer ítem de V2): hoja CUBICAJE (`placa·cubicaje`), cálculo del volumen por línea en backend = Σ(viajes×cubicaje), fallback al factor del reporte (14) + flag (naranja en la chequeadora + columna `cubicaje_origen` en VOLQUETAS), columnas nuevas en VOLQUETAS (cubicaje, m3_placa, cubicaje_origen), endpoint GET `?action=cubicaje` y lectura en vivo en reporte-chequeadora.html. Empresa fuera (vive en la Bitácora). **Ajustes post-prueba (D54):** fallback 14 fijo (se quita el editor de m³/viaje), maquinaria de la chequeadora (excavadoras → MAQUINARIA, producción = total ÷ nº máquinas), tipo de destino ODT. | D53, D54 |
| 2.11 | **Desmonte y descapote en m²** (antes Ha): captura única en m² que dispara automático la fila contractual en Ha (÷10 000) + excavación no aprovechable (m²×espesor) que encadena ZODME (D17). Extiende D16/D17 y catálogo §1. **Resuelto por opción B** (genera Ha contractual + no aprovechable + ZODME, no "solo m³"): se conservan ambas salidas a DATA. El doble conteo con D08 **no aplica**: la chequeadora no maneja datos de desmonte/descapote, el capataz es la única fuente. Espesor editable (default 0.2). Ver D58. | ✅ Hecho (validar en campo) |
| 2.12 | **Arreglar la generación de la hoja DATA (D63).** Dos arreglos dentro de A–T (D23, sin columnas nuevas): **(1) ELEMENTO arreglado** — la hoja BASE **se mantiene** como catálogo de elementos. La BASE son **varias tablas lado a lado**; la de elementos (J/K/L) no se cruza por CC/descripción (otra tabla — ese era el bug del `"REVISAR ·"` casi siempre). El elemento se elige por **actividad** y se cruza por abscisa: préstamo→`EL DIVISO`, estructuras/MSR→`MSR …` del PK, conformación (02.08, incl. ZODME auto)→`RCD 15+800` (ZODME PK30 pendiente), resto→tramo `"tm2 pk X - Y"`. Los `ODT*`/drenajes se ignoran (fuera de alcance). REVISAR queda solo para PK fuera de tramo o marcador faltante. Respaldo (PK sin tramo) y frontends: helper único (`buildElemento`/`pkMeters`/`pkNorm`, igual en backend y HTML): `"tm2 pk NN+NNN"`/`"… - NN+NNN"`, normaliza a `NN+NNN` y no duplica el token `pk`/`Pk` (mata el `"Pk Pk"`). El backend deriva UF/PROYECTO/CC/ABS del PK (D04) para toda fila, incluida la vía que salía sin UF. **(2) Excavación de la chequeadora por ORIGEN, acumulada** — 1 sola fila de excavación por reporte = Σ líneas, al PK del origen (Masivo2 19+800 / Masivo1 14+400 / Diviso 21+500 / Compl-Otro = PK tecleado); el terraplén no cambia (1×línea al destino); ZODME auto intacto. Reportes del mismo origen quedan separados. **✅ Hecho (validar en campo + redeploy).** | ✅ Hecho (D63) |

## V3 — Largo plazo

| # | Ítem | Origen |
|---|---|---|
| 3.1 | Sistema de asistencia de personal (oficiales, ayudantes, operadores) | "Más adelante puede que hagamos un sistema para la asistencia" |
| 3.2 | Chequeadora del Diviso digitalizada (hoy reporta por foto, otra persona) | Conversación fuentes |
| 3.3 | Materiales MSR con columnas propias en el resumen diario (hoy solo en DATA por ítem) | Análisis Excel |
| 3.4 | Inoperativos estructurados (hoy texto libre) | D28 |

**Regla:** no inventar funcionalidades fuera de este backlog.

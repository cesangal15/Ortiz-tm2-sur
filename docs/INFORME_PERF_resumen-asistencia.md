# INFORME — Lentitud de `resumen-asistencia.html` (Fase 0 · Fase 1 · Fase 2 puntos 1–4)

**Fecha:** jul-2026 · **Alcance:** módulo Asistencias (D69, aislado). No toca `Codigo.gs`, BANDEJA, DATA,
MAQUINARIA ni ninguna pantalla del sistema de obra.

---

## 0. Titular

**La hipótesis de partida no se confirmó.** `resumen-asistencia.html` **nunca llama a `?action=roster`**
(ese endpoint lo usa `asistencia.html`, el formulario del capataz). Al cambiar de fecha sale **UNA sola
petición**, no varias. El problema no es el número de llamadas.

Lo que sí pesa es **cada petición por dentro** y **el pintado del cliente**:

| Causa | Medida |
|---|---|
| `asistenciaDia` abre el Spreadsheet **14 veces** y lee **14 veces** una hoja (11 distintas) por petición | CUADRILLAS ×3, CONFIG ×2 |
| Todas las lecturas son `getDataRange()` (toda la hoja, todas las columnas) | incluye `CAT_CC` y el histórico completo de `ASISTENCIA` |
| El resumen pinta por adelantado el detalle de **todas** las cuadrillas (D76) y una ficha de captura por **cada** faltante | **12.166 nodos DOM** con 225 personas |
| SheetJS (~900 KB) se cargaba como `<script>` bloqueante en el `<head>`, aunque solo hace falta al exportar | bloquea el primer pintado |

---

## 1. FASE 0 — Diagnóstico

### 2.1 Mapa de peticiones del frontend

| Endpoint | ¿Cuándo se dispara? | ¿Serie o paralelo? | Campos de la respuesta que se usan |
|---|---|---|---|
| `GET ?action=asistencia&fecha&usuario&area` | Carga inicial · cambio de fecha · cambio de "Ver como" (admin) · después de guardar detalle · después de guardar faltantes | **Única** llamada de ese ciclo (no hay con quién paralelizar) | `filas`, `cuadrillas`, `faltantes`, `eventuales`, `jornada`, `catCC`, `catCCUsados`, `catMotivos`, `turnos`, `extrasAdmin`, `notas`, `config`, `festivos` — **se usan todos** |
| `GET ?action=export&fecha&usuario&area` | Solo al pulsar "Excel 3701/3702" | Una sola (cacheada por fecha en `STATE.exportCache`; sirve para los dos proyectos) | `filas`, `proyectoDefecto`, `catTrabajadores`, `config`, `festivos`, `turnos`, `extrasAdmin` |
| `GET ?action=personal&usuario&area` | Solo al pulsar "Cargar personal ↻" | Una sola | `personal`, `cuadrillas` |
| `GET ?action=ausencias&desde&hasta&usuario&area` | Solo al pulsar "Consultar" en el seguimiento por rango (D94) | Una sola | `filas`, `sinReportar`, `desde`, `hasta`, `dias` |
| `POST {asistencia_individual}` | Guardar detalle (D76) / guardar faltantes | Una sola, seguida de un `?action=asistencia` de refresco | `ok`, `error` |
| `POST {personal, op}` | Alta / retiro / mover / reactivar / reingreso | Una sola, seguida de `?action=personal` | `ok`, `error` |
| `GET plantilla_parte.xlsx` (GitHub Pages, **no** Apps Script) | Carga inicial, con `cache:'no-store'` | Paralela | los bytes del .xlsx |
| `GET cdn.jsdelivr.net/…/xlsx.full.min.js` | Carga inicial, **bloqueante** en el `<head>` | Bloquea el pintado | la librería |

**`?action=roster` y `?action=extras_admin` NO se piden desde esta pantalla.** Las extras del admin
llegan dentro de la respuesta de `asistencia` (campo `extrasAdmin`), ya filtradas por área en el backend.

### 2.2 Mapa de lecturas del backend

| Endpoint | Hojas que lee | Método | ¿Lee columnas que no usa? | ¿Abre el Spreadsheet más de una vez? | ¿Lee la misma hoja dos veces? |
|---|---|---|---|---|---|
| `asistencia` | CUADRILLAS ×3, ASISTENCIA, PERSONAL, CONFIG ×2, FESTIVOS, CAT_CC, CC_USADOS, CAT_MOTIVOS, TURNOS, EXTRAS_ADMIN, NOTAS_ASISTENCIA | `getDataRange()` en todas | **Sí** — trae toda la fila de cada hoja y descarta | **Sí: 14 `openById`** (uno por `readSheet`) | **Sí** — CUADRILLAS ×3, CONFIG ×2 |
| `export` | CUADRILLAS, **ASISTENCIA ×2**, CAT_TRABAJADORES, TURNOS, EXTRAS_ADMIN, CONFIG, FESTIVOS | `getDataRange()` | Sí | Sí: 8 | **Sí — ASISTENCIA entera dos veces** (una para el día, otra para el `proyectoDefecto` histórico) |
| `personal` | CUADRILLAS ×2, PERSONAL | `getDataRange()` | Sí | Sí: 3 | Sí — CUADRILLAS ×2 |
| `ausencias` | CUADRILLAS ×2, ASISTENCIA, FESTIVOS, PERSONAL, CAT_MOTIVOS | `getDataRange()` | Sí | Sí: 6 | Sí — CUADRILLAS ×2 |
| `roster` | *(no lo usa esta pantalla)* CUADRILLAS ×2, CONFIG ×2, FESTIVOS, PERSONAL, CAT_CC, CC_USADOS, CAT_MOTIVOS, ASISTENCIA, TURNOS | `getDataRange()` | Sí | Sí: ~11 | Sí |

La causa raíz es una sola: **`readSheet()` hace `SpreadsheetApp.openById(SHEET_ID)` en cada llamada**
(`backend/CodigoAsistencias.gs:163`) y **usa `getDataRange().getValues()`** (línea 165). Como los helpers
(`areaDeCuadrillaMap`, `cuadrillasInactivasSet`, `getConfigMap`, `ccUsadosParaArea`…) llaman a `readSheet`
cada uno por su cuenta, la misma hoja se relee varias veces dentro de la misma petición.

### 2.3 Respuestas Q1–Q9

- **Q1. ¿`?action=roster` se vuelve a llamar al cambiar de fecha?**
  **No — nunca se llama.** `resumen-asistencia.html` solo usa `asistencia`, `export`, `personal`,
  `ausencias` y los dos POST. La hipótesis principal del planteamiento queda descartada.
- **Q2. ¿Cuántas peticiones al abrir? ¿Cuántas al cambiar de fecha?**
  **1 al abrir** (`?action=asistencia`) y **1 al cambiar de fecha** (la misma). Aparte, dos descargas que
  no son del Apps Script: `plantilla_parte.xlsx` (~90 KB) y SheetJS (~900 KB) — solo en la carga inicial.
- **Q3. ¿Las peticiones de la carga inicial salen encadenadas o en paralelo?**
  No hay cadena: hay **una sola**. La única secuencia real estaba en el export (`await ensureXLSX` →
  `await obtenerExport`), y en Fase 1 pasó a `Promise.all`.
- **Q4. ¿`asistenciaDia` lee hojas de más? ¿Cuántas abre?**
  Abre **11 hojas distintas con 14 lecturas**. Ninguna sobra por sí sola (todas alimentan un campo que el
  frontend usa), pero **CUADRILLAS se lee 3 veces y CONFIG 2 veces** en la misma petición, y todas se leen
  enteras.
- **Q5. ¿`openById` una vez por hoja o por petición?**
  **Una por hoja** — 14 aperturas por petición de `asistencia`. Debería ser una por petición.
- **Q6. ¿`getDataRange()` sobre catálogos grandes?**
  **Sí, en todos** — incluidos `CAT_CC`, `CAT_TRABAJADORES` y el histórico completo de `ASISTENCIA`.
- **Q7. El detalle por cuadrilla de D76: ¿eager o al desplegar?**
  **Era eager.** `render()` llamaba a `detalleCuadrillaHtml` para **todas** las cuadrillas, clasificando
  horas (`clasificarHoras`/`turnoRowFor`/`tipoJornadaDeFecha`) de **todas** las personas y armando un
  editor completo (buscador de CC + turno + entrada/salida + `<select>` de motivos) por cada una, todo
  oculto con `display:none`. Con 225 personas eso son **12.166 nodos DOM** en el primer pintado.
- **Q8. ¿`extras_admin` se pide siempre?**
  **No se pide nunca** como petición aparte. Viaja dentro de `asistencia` y el backend ya lo acota
  (`verExtras`): vacío para ODT/ODL/`residente_dren`, con datos para tierras/admin (D74b).
- **Q9. ¿Algún `flush()` o escritura dentro de un `doGet`?**
  **No.** Los cinco handlers de `doGet` usan solo `readSheet` (que no escribe). `getSheet()` —el que puede
  escribir encabezados— solo lo llaman los `doPost`. No hay ningún `SpreadsheetApp.flush()` en el archivo.

### 2.4 Veredicto

**D — Mezcla, con reparto estimado ≈ 60 % backend (B) / 40 % cliente (C). Nada de A.**

- **A (exceso de peticiones): descartado.** 1 petición al abrir, 1 al cambiar de fecha.
- **B (backend lento por petición) ≈ 60 %.** 14 `openById` + 14 `getDataRange()` por cambio de fecha.
  Con <2.000 filas el volumen no es el problema: lo es el **coste fijo por llamada al servicio de Sheets**,
  que se paga 14 veces en vez de 1.
- **C (render de cliente) ≈ 40 %.** 12.166 nodos por pintado + ~900 KB de SheetJS bloqueando el `<head>`
  aunque la mayoría de las visitas nunca exporten.

**Consecuencia práctica:** la Fase 1 (frontend, sin redeploy) se lleva la parte C completa y hace que la
pantalla *se sienta* rápida aunque el servidor tarde lo mismo. La parte B necesita la Fase 2, que exige
redespliegue del Apps Script — **pendiente de visto bueno explícito del usuario**.

---

## 2. FASE 1 — Lo aplicado (solo frontend, sin redeploy)

1. **Caché del roster: no aplica** — no se pedía. En su lugar se conservó y documentó el caché que sí
   tenía sentido: `STATE.exportCache` por fecha (una sola petición de `export` sirve para 3701 y 3702), y
   se invalida al cambiar fecha, área o guardar. Sin `localStorage` de datos del día (la plantilla
   Navision, backlog 4.4c, sigue siendo su único uso legítimo y no se tocó).
2. **Paralelización:** `generarExcel` bajaba SheetJS y el crudo del día en cadena; ahora van con
   `Promise.all`. En la carga inicial no había nada que paralelizar (una sola petición).
3. **Render progresivo.** Se pintan primero los KPIs, los proyectos, el indicador de extras y la lista de
   cuadrillas con su ✓/✗. Se **difieren al primer despliegue**: el detalle por cuadrilla de D76 (con toda
   su clasificación de horas y su editor), la lista de "Sin reportar" y el bloque "Completar faltantes"
   —los tres nacían ocultos y se armaban igual—. Las `<option>` de motivos se construyen una vez en vez de
   una por persona, y el agrupado de filas por cuadrilla pasa de N×M a una sola pasada.
4. **SheetJS bajo demanda.** Sale del `<head>`; se inyecta al pulsar "Excel 3701/3702" y, si el navegador
   queda ocioso, se precarga en segundo plano para que el primer clic tampoco espere. Misma librería y
   misma versión (0.18.5): **no es una dependencia nueva**. La plantilla del repo también se baja en
   segundo plano, no compitiendo con la petición del resumen.
5. **Indicador de carga no bloqueante.** Barrita de progreso en el acento `#f5a623` bajo el header y el
   contenido atenuado: **al cambiar de fecha ya no se borra la pantalla**, se sigue viendo el día anterior
   hasta que llega el nuevo. Si la consulta falla sí se limpia (mostrar los números del día anterior con
   un aviso encima sería peor: se leerían como los del día pedido).
6. **Instrumentación temporal** detrás de `const DEBUG_PERF = true;` (arriba del archivo, una línea para
   apagarla): `console.time`/`timeEnd` por petición y un `console.table` por ciclo con ms, KB de la
   respuesta y —cuando la Fase 2 exista— `servidor_ms`/`red_ms` a partir del campo `_ms`.

**Lo que NO cambió:** ni un número, ni un filtro, ni el Excel. Sin dependencias nuevas. Guards de rol,
filtro por área de D74b, detalle y edición individual de D76, notas de D74, extras del admin de D73,
seguimiento de ausencias de D94 y flujo de dom/fest de D81: intactos.

---

## 3. Medición antes/después

Banco de pruebas headless (Chromium) con un día sintético de **225 personas en 5 cuadrillas** (presentes
con CC, presentes sin CC, ausentes con motivo, una cuadrilla sin reportar, eventuales, turnos 1/2/4 con
cruce de medianoche, notas y extras del admin) y la respuesta del Apps Script simulada — así se aísla el
coste del cliente del de la red.

| Medida | Antes | Después |
|---|---|---|
| Peticiones al Apps Script **al abrir** | 1 | 1 |
| Peticiones al Apps Script **al cambiar de fecha** | 1 | 1 |
| Nodos DOM tras el primer pintado | **12.166** | **222** |
| ms de **pintar** el resumen (promedio de 5 `render()`) | **204 ms** | **1 ms** |
| ms hasta ver los KPIs (carga completa, red simulada) | 246 ms | 111 ms |
| SheetJS en la ruta crítica | Sí (~900 KB bloqueantes) | No |

Los ms son de un contenedor x86; en el celular de la residente el factor es varias veces mayor, así que
los 204 ms de pintado eran del orden de segundos. **El número de peticiones no baja porque ya era 1** —
lo que baja es lo que cuesta cada una en el cliente.

**Paridad verificada** (mismo dataset, versión vieja vs. nueva, comparación automática):
KPIs del día · filas de cuadrillas y extras admin · títulos de sección · lista "sin reportar" ·
lista "completar faltantes" · **detalle por cuadrilla con las horas ya clasificadas (D76)** · KPIs tras
cambiar de fecha · apertura del editor individual → **idénticos**, cero errores de JS.
Casos borde: domingo/festivo (guía de D81 y sin selector de turno), selector "Ver como" del admin (D74b),
guardar faltantes sin desplegar el bloque (avisa, no rompe), export sin plantilla (avisa sin cargar
SheetJS). Y el **export real** contra la plantilla del repo: la hoja `Parte` sale **idéntica celda a
celda** (45 filas, incluida la del admin) entre la versión vieja y la nueva.

**Cómo medirlo en campo:** F12 → Console, abrir la pantalla y cambiar de fecha. Cada ciclo imprime su
`console.table` con los ms y los KB de cada petición. Para apagarlo: `DEBUG_PERF = false`.

---

## 4. FASE 2 — Puntos 1–4 EJECUTADOS (requieren redeploy); punto 5 pendiente

> Autorizados por el usuario tras reportar esperas reales de **10–30 s**. Exigen redesplegar
> `CodigoAsistencias.gs`: Administrar implementaciones → editar la existente → **Nueva versión**,
> **misma URL**. Mientras no se redespliegue, el frontend sigue funcionando igual (el campo `_ms`
> simplemente no llega y la columna sale vacía).

### Lo aplicado

| Punto | Cambio | Efecto medido |
|---|---|---|
| 1 | `ss_()` — referencia perezosa: el Spreadsheet se abre **una vez por ejecución**, no una por hoja | **`openById` 14 → 1** en `asistencia`; 8 → 1 en `export`; 13 → 1 en `roster`; 3 → 1 en `personal` |
| 1b | `_memoHoja` — memoria de lectura **dentro de la misma ejecución**, con `invalidarHoja_` en los 10 puntos de escritura | Cero hojas releídas: se van CUADRILLAS ×3 y CONFIG ×2 de `asistencia`, y CUADRILLAS ×2 de `personal` y `ausencias` |
| 2 | `getRange(1,1,lastRow,nCols)` en vez de `getDataRange()`, con `nCols` = columnas del encabezado topado al ancho real de la grilla | Deja de traer columnas que ningún endpoint usa |
| 3 | `export` deja de leer **`ASISTENCIA` entera dos veces** (la segunda la sirve la memoria) | **178.524 → 89.563 celdas**, la mitad |
| 4 | Campo **`_ms`** (ms de servidor) en toda respuesta JSON, sembrado en `doGet`/`doPost` | El frontend ya lo separa en `servidor_ms` / `red_ms` en su `console.table` |

Resumen del coste por petición (banco: 6 cuadrillas —una inactiva—, 240 personas con eventuales y un
retirado, 22 días de ASISTENCIA, CAT_CC de 506 filas):

| Petición | `openById` antes → después | Lecturas antes → después | Celdas antes → después |
|---|---|---|---|
| `asistencia` (residente) | **14 → 1** | 14 → 11 | 91.899 → 91.803 |
| `asistencia` (ODT/duvan) | 13 → 1 | 13 → 10 | 91.885 → 91.789 |
| `export` | 8 → 1 | 8 → 7 | **178.524 → 89.563** |
| `personal` | 3 → 1 | 3 → 2 | 2.243 → 2.215 |
| `ausencias` (20 días) | 6 → 1 | 6 → 5 | 91.213 → 91.185 |
| `roster` (otra pantalla, se beneficia igual) | 13 → 1 | 13 → 9 | 91.912 → 91.776 |

**Verificación:** un arnés ejecuta `CodigoAsistencias.gs` en Node contra un Sheet simulado y compara la
versión vieja con la nueva. Las **21 respuestas** (15 GET + 6 POST — incluidos `roster`, domingo/festivo,
día sin datos, rango invertido, vistas ODT/ODL y las 5 operaciones de gestión de personal) salen
**idénticas carácter a carácter**, salvo el `_ms` nuevo. Ninguna petición lee más que antes.

### Lo que sigue pendiente

**Punto 5 — `CacheService.getScriptCache()` (TTL 21600 s, JSON)** para CONFIG, FESTIVOS, TURNOS, CAT_CC,
CAT_TRABAJADORES, CAT_MOTIVOS, MOTIVOS_USADOS, CC_USADOS, CUADRILLAS y PERSONAL. Llevaría `asistenciaDia`
de 11 lecturas a **3** (ASISTENCIA, NOTAS_ASISTENCIA y EXTRAS_ADMIN **nunca** se cachean: cambian durante
el día y darían datos falsos). **No se hizo a propósito:** es el único cambio que introduce un modo de
fallo nuevo —personal viejo en el resumen si se escapa una invalidación tras un alta o un retiro— y la
decisión de si hace falta se toma **con el `_ms` medido en campo**, no a ciegas.

> **Ojo con el diagnóstico:** las 14 aperturas explicaban una espera de segundos, no necesariamente de
> 10–30 s. El `_ms` es justo el instrumento para saberlo. Si tras el redeploy `_ms` sale **alto** (varios
> segundos), el problema sigue en el script y el punto 5 se justifica. Si sale **bajo** y el total sigue
> alto, lo que pesa es la red / el arranque del contenedor de Apps Script / el tamaño del payload — y ahí
> el `CacheService` no ayudaría nada; lo que tocaría es el payload ligero de la sección 5.

## 4-bis. FASE 2 — Plan original (referencia)

Ordenada por relación beneficio/riesgo. El punto 5 del planteamiento (endpoint consolidado
`?action=resumen_dia`) **no aplica**: el veredicto no es A y ya sale **una sola** petición por cambio de
fecha — agrupar no agruparía nada.

1. **Una sola apertura del Spreadsheet por petición** (referencia perezosa a nivel de módulo) y **caché de
   hoja dentro de la petición**, para que CUADRILLAS no se lea 3 veces y CONFIG 2. Es el cambio de mejor
   relación beneficio/riesgo: pasa de 14 lecturas a 11 y de 14 `openById` a 1, sin tocar ninguna regla de
   negocio.
2. **`getRange(1, 1, lastRow, nCols)`** en vez de `getDataRange()`, leyendo solo las columnas del
   encabezado de cada hoja.
3. **`CacheService.getScriptCache()`** (TTL 21600 s, JSON) para lo casi estático: CONFIG, FESTIVOS,
   TURNOS, CAT_CC, CAT_TRABAJADORES, CAT_MOTIVOS, MOTIVOS_USADOS, CC_USADOS, CUADRILLAS, PERSONAL.
   **Invalidación obligatoria:** toda escritura de gestión de personal, cuadrillas o CONFIG borra las
   claves afectadas antes de responder; ante la duda, se borra. **NUNCA cachear** `ASISTENCIA`,
   `NOTAS_ASISTENCIA` ni `EXTRAS_ADMIN` — cambian durante el día y darían datos falsos en el resumen.
4. **Campo `_ms`** (tiempo de servidor) en cada respuesta JSON. El frontend ya lo lee y lo separa de la
   red en la tabla de `DEBUG_PERF`; hoy sale vacío porque el backend no lo manda.
5. **`export`: no leer `ASISTENCIA` dos veces.** El `proyectoDefecto` histórico puede salir de la misma
   lectura que las filas del día, o cachearse aparte (es un cálculo sobre todo el histórico que cambia muy
   poco). Es la lectura más cara del módulo y hoy se paga doble en cada descarga de Excel.

---

## 5. Propuestas V2 (anotadas, NO implementadas)

- **`asistencia` con payload "ligero" por fecha — el candidato más fuerte si `_ms` sale bajo.** Los
  catálogos (`catCC` completo, `catCCUsados`, `catMotivos`, `turnos`, `config`, `festivos`) **no dependen
  de la fecha** y hoy se reenvían íntegros en cada cambio de día. Medido en el banco, la respuesta de
  `?action=asistencia` pesa **59,2 KB**, repartidos en `filas` 58,6 % · **`catCC` 20,5 %** · `faltantes`
  17 % (y el `catCC` del banco son 506 filas: con el catálogo real esa fracción sube). Un parámetro
  `&cat=0` que los omita cuando el cliente ya los tiene se ahorraría ese 20 %+ en cada cambio de fecha.
  Requiere backend + caché en el cliente. **El frontend ya muestra los KB de cada petición** en la tabla
  de `DEBUG_PERF`, así que se puede confirmar en campo antes de tocar nada.
- **Prefetch del día anterior/siguiente** al quedar el navegador ocioso, para que las flechas de fecha
  sean instantáneas. No se hizo porque añade peticiones al Apps Script, justo lo que se quería evitar.
- **Partición de `ASISTENCIA` por año** — **fuera de alcance hoy** (backlog 4.10): con <2.000 filas no se
  justifica. Umbral sugerido para retomarlo: **20–30 mil filas** en la hoja, o cuando `?action=export`
  supere los ~5 s de servidor medidos con `_ms`.

# Conciliador de Cortes de Transporte — TM2 Sur (V1)

Herramienta **standalone** para el corte quincenal de transporte de volquetas
(~10-12 contratistas). Corre **100% en el navegador** (GitHub Pages o `file://`),
sin backend: los archivos nunca salen del equipo. Producto **independiente** del
sistema de reporte diario (no toca `Codigo.gs`, `reporte-capataz.html`, etc.).

**Filosofía:** nunca asumir ante la incertidumbre. Todo lo dudoso va a revisión
manual con evidencia visible. El sistema propone, César decide.

## Archivos

```
conciliador/
  index.html       ← abrir este archivo (CSS embebido, carga conciliador.js)
  conciliador.js   ← toda la lógica
  README.md
```

Librerías por CDN (versiones fijadas): SheetJS 0.18.5 (eager), pdf.js 3.11.174,
tesseract.js 5.1.1 y pdf-lib 1.17.1 (lazy: solo se descargan al entrar al Paso 5
o al generar el PDF de pendientes). Se necesita internet la primera vez que el
navegador las descarga; después quedan en caché del navegador.

## Flujo quincenal

| Paso | Qué haces | Qué hace el sistema |
|---|---|---|
| 1 · Cargar bases | Seleccionas `GRANULARES.xlsx` y `TERRAPLEN.xlsx` (copias locales) | Lee SOLO la hoja `BASE 2026` (si no existe, te pide señalarla), corta en la última fila con remisión, muestra filas útiles y rango de fechas. Quedan en memoria para todos los contratistas de la sesión. |
| 2 · Abrir corte | Eliges contratista + quincena | Rechaza empresas vetadas (ORTIZ, VOLKETSA, Betulia). Un contratista a la vez. |
| 3 · Cargar proforma | 1..N `.xlsx` del contratista | Auto-detecta encabezado (títulos arriba, alias de columna), enruta hojas por patrones (PUTANA→GRANULARES, INTERNO→interno, Hoja1→ignorar…), explota celdas multi-remisión, detecta pares sospechosos "¿lista o rango?" y concilia al instante. Hoja no reconocida → tú la señalas (y guardas la regla). |
| 4 · Conciliación | Revisas el tablero por estados | Llave cerrada: remisión exacta (texto, ceros incluidos) + empresa ∈ alias + fecha ≥ mínima. 0 candidatos → NO_ENCONTRADA (con sugerencias: "existe con otra empresa" y "existe en la otra base"); 1 → clasificador (solo UF3 excluye; áreas PLANTA/PUENTE/TM1/ODT… van al acta con observación); >1 → eliges tú. Si una hoja entera parece estar en la base equivocada, sale un aviso con un botón para cambiarla de ámbito y re-conciliar. |
| 5 · Investigación PDF | Cargas los PDFs de partes y corres el OCR | Búsqueda dirigida SOLO de las no-encontradas (listadas de menor a mayor por número de remisión, en la lista lateral y en los botones del modal de revisión): pasada roja por franjas (número impreso arriba-derecha, 1–3 partes/página) + pasada gris de respaldo (AVENSA). Verde = exacto, naranja = 1 dígito. NUNCA auto-confirma: tú ves la página y decides (Confirmar / Es ASFALTO / No es). Además, el panel "Cobertura del OCR por página" muestra la vista inversa: páginas SIN lectura o cuyo número no coincide con nada reclamado. El botón **"▶ Revisar contra las faltantes"** las recorre una por una: ves el parte, la lista de faltantes sin confirmar como botones (≈ marca las que están a 1 dígito de lo leído) y con UN clic confirmas el comprobante; o pulsas **"✕ No es ninguna faltante"** y la página se descarta de la lista (es reproceso: remisión que ya está en la base). Las descartadas se pueden ver y restaurar con ↩ (y corregir su lectura las re-abre). El ✏️ para corregir la lectura del OCR sigue disponible (si el número corregido es una faltante pasa a candidato; si es de una remisión ya conciliada, la página sale de la revisión). Por revisar y descartadas salen en el resumen del Paso 7. Navegador manual de miniaturas siempre disponible. |
| 6 · Resolución manual | Decides las dudosas | Cola de revisión manual, múltiples, duplicadas y alertas de internos >3 km. Cada transición queda auditada (estado anterior/nuevo, fecha-hora, nota). |
| 7 · Exportes | Copias/descargas | Bloque acta (TSV al portapapeles + .xlsx), **bloque acta de PENDIENTES** (mismo modelo A..S con lo que sabe la proforma y CC propuesto — ver abajo), Excel digitadora y PDF de pendientes — ambos en el MISMO orden: fecha de la proforma de menor a mayor y, dentro del día, remisión de menor a mayor (páginas deduplicadas), para que la digitadora trabaje renglón a página — y resumen del corte. |

**Ciclo digitadora:** cuando la digitadora digite los comprobantes enviados,
recarga las bases (Paso 1): se re-corren SOLO las `NO_ENCONTRADA` y
`PENDIENTE_DIGITACION`; las que ya aparecen pasan a `ENCONTRADA` con nota
"resuelta en re-conciliación". Las decisiones manuales no se tocan.

## Estados

`PENDIENTE → ENCONTRADA | NO_ENCONTRADA | MULTIPLE_EN_BASE | DUPLICADA_EN_PROFORMA | EXCLUIDA_UF3 | EXCLUIDA_OTRA_AREA | REVISION_MANUAL`

Desde investigación/manual: `NO_ENCONTRADA → PENDIENTE_DIGITACION | EXCLUIDA_ASFALTO | RECHAZADA | ACEPTADA_MANUAL` (nota obligatoria).

**Solo excluyen UF3 y ASFALTO** (decisión jul-2026). Las áreas PLANTA, PUENTE,
TM1, AMP, RCD, ODT…, etc. **NO excluyen**: la remisión va al acta como
`ENCONTRADA` con la marca `AREA_OBSERVADA` y la observación "área X" en la
columna S. (`EXCLUIDA_OTRA_AREA` queda solo como estado legado/manual.)

Al acta van **solo** `ENCONTRADA` + `ACEPTADA_MANUAL`. Marcas transversales que
no cambian el estado: `REZAGO` (nunca se excluye sola), `CELDA_MULTIPLE`,
`MATCH_SIN_CEROS` (queda en revisión hasta confirmar), `INTERNO_MAYOR_3KM`,
`AREA_OBSERVADA`.

### ¿Hoja en la base equivocada?

Caso real: un archivo de PUTANA con la hoja llamada `CORTE CLIENTE 2026` — el
patrón `CORTE` la enruta a TERRAPLÉN y nada matchea. El sistema no se
auto-corrige (filosofía: nunca asumir), pero te lo hace evidente por tres vías:

1. **Aviso de hoja sospechosa** (Pasos 3 y 4): si la mayoría de las
   no-encontradas de una hoja SÍ existen en la otra base con tu contratista,
   aparece un banner con el botón "Cambiar a X y re-conciliar".
2. **Botón "cambiar"** junto al ámbito de cada hoja en el Paso 3 (re-concilia
   las reclamaciones de esa hoja que no tengan decisión manual y puede guardar
   la regla en la config del contratista).
3. En el detalle de cada NO_ENCONTRADA: bloque "existe en la otra base" con el
   candidato listo para usar con un clic.

## Bloque acta (contrato de pegado)

Columnas A..S del acta con las derivadas **vacías** (A `X`, B `Acta No.`, D, E,
N `Km Stand by`, O `Total Km a pagar`): después de pegar, arrastra tus fórmulas.
Filas ordenadas por fecha y luego remisión. La remisión se exporta como TEXTO
(conserva `0348`, soporta `CH6199`).

- **Copiar bloque (TSV):** pegado directo en Excel. Los decimales usan coma
  (`decimalTSV` en la config; cámbialo a `"."` si tu Excel usa punto).
- **Descargar .xlsx:** mismos valores con números reales (sin problema de locale).

El mapeo acta↔bases vive en `actaLayout` dentro de la configuración (editable),
no está quemado en el código. Para las filas que vienen de la base se exporta
lo que dice la base (el cálculo `PK/1000+2.5` de granulares NO se recalcula);
ese cálculo sí se aplica en el bloque de PENDIENTES (ver `kmPorOrigen` abajo).

### Bloque acta de PENDIENTES de digitación (tarjeta 1b)

Los `PENDIENTE_DIGITACION` **con comprobante confirmado** salen en un bloque
APARTE con el mismo modelo A..S, llenado como lo hace César a mano (solo las
derivadas A/B/D/E/N/O van vacías): fecha C, actividad G = material de la
proforma **traducido a como lo escribe la base** (`nombreBase` del mapeo
`ccPorMaterial`: SUBBASE→"Sub base", BTC→"BTC", crudo→"Crudo de río"…; en
terraplén queda tal cual la proforma), remisión I, placa J, cantidad P;
observación S = "PENDIENTE DIGITACIÓN · comprobante archivo p.N · área X".
Cada proforma trae formato propio, así que la columna de material se detecta
por alias (`tipo material`, `tipo de material`, `material transportado`… —
ampliables en la config); si la proforma trae `KM` / `TOTAL M3/KM` propios,
se capturan y se usan SOLO como respaldo cuando las reglas de César no pueden
calcular (el acta paga las reglas propias, no lo que reclame el contratista). **Kilometrajes:** K = origen
(en GRANULARES el texto tal cual: "Planta Putana", "AVENSA"…; en TERRAPLEN la
abscisa en metros), L = PK destino en metros, y **M Km totales** con las
reglas verificadas contra la BASE 2026 (config `kmPorOrigen`, editable):
origen Putana → PK destino/1000 + 2,5; Avensa → 25,7 fijo y Pekin → 67,5 fijo
(siempre van al PK33); resto → |destino − origen|/1000 (abscisas en metros).
**Q m³·Km = Km totales × cantidad** y R unidad como la escribe la base
cargada (`m3/km` en GRANULARES, `m3km` en TERRAPLEN). Sin datos suficientes
la celda queda vacía y la llena César. El **CC (col. H)** es propuesta
automática que César confirma o corrige en la tarjeta (marca `auto` naranja
hasta editarlo):

- Área **ajena** (el origen/destino de la proforma menciona PUENTE, PLANTA,
  TM1, AMP, RCD… = todo lo no nuestro que no se excluye) → **CC fijo
  `3701.11.03`** (decisión jul-2026). Editar el área re-fija el CC.
- **Nuestros**: CC = prefijo por PK del destino (PK≤30→3701, PK>30→3702) +
  **sufijo por MATERIAL** (mapeo `ccPorMaterial` en la config, levantado de
  las BASE 2026 reales jul-2026): GRANULARES — sub base→`.03.02`,
  TDA→`.03.03`, BTC/base→`.03.04`, crudo de río→`.02.11`, piedra
  filtro→`.06.03`, PSI 4000/28 MPa→`.06.09`, PSI 2000/14 MPa→`.06.07`;
  TERRAPLEN — todo→`.02.11` (transporte explanaciones; el `.02.10` es por
  distancia ≤1 km y queda a corrección manual). El material sale de la
  columna `material` de la proforma (alias configurables) y, si no existe,
  de destino/origen/obs/nombre de hoja. Las variaciones `06.*`/`07.*` de
  ODT/ODL son puntuales y raras → corrección manual. Con material pero sin
  PK se propone el CC más frecuente de la base cargada que cierre con ese
  sufijo; sin señal → vacío, lo pone César. La UF (col. F) se deriva del
  prefijo del CC. UF3 (`3703.*`) no aplica: se excluye del corte.

El área/CC editados persisten en la sesión (`actaPend` del reclamo). Ojo al
reproceso: cuando la digitadora los digite y se recarguen las bases, esas
remisiones pasan a `ENCONTRADA` y salen también en el bloque 1 — no pegarlas
dos veces (la tarjeta lo advierte).

## Configuración (⚙️ Config)

JSON versionado, editable en pantalla, persistido en localStorage
**+ export/import de archivo** (localStorage es caché; el JSON es el respaldo).
Contiene: fecha mínima de búsqueda, quincena, alias de columna-remisión y
secundarias, áreas observadas/neutras, layout del acta y los 10 contratistas
seed (Sabana: ASOTRANSPA, ASOTRASAAT, ASOVOLSAT, COTRASABANA, SUMINISTROS,
TRANSAGREGADOS, VELEROS · Betulia solo GRANULARES: CARTRAGUA, D&S, TRANSDELTA)
con sus alias y reglas de hojas.

Notas del seed de reglas de hojas (además de las 4 del ejemplo de la spec):

- `TERRAPLEN…GRANULAR` en el nombre → **AMBAS** (hoja mixta de SUMINISTROS).
- Nombre de mes (`JUNIO 2026` de ASOTRASAAT) → **AMBAS**: busca en las dos bases;
  si aparece en ambas cae a `MULTIPLE_EN_BASE` (nunca asume mal).

## Sesión

- **Autosave** en localStorage en cada cambio relevante (si supera el límite,
  avisa y pide export).
- **Exportar/Importar sesión (JSON):** todo el estado del corte (reclamaciones,
  historial, asignaciones PDF por nombre de archivo + página, caché de OCR,
  páginas descartadas a mano en la revisión).
  Los binarios NO viajan: al importar, re-selecciona las bases (Paso 1) y los
  PDFs (Paso 5) con los MISMOS archivos — si el nombre difiere, avisa.

## Limitaciones V1 (fuera de alcance)

- No genera el acta completa (tarifas, totales, firmas): solo el bloque de pegado.
- No escribe las bases ni el acta reales (todo es lectura + export copy-paste).
- Sin histórico entre cortes / anti-doble-cobro entre quincenas (lo cubre el
  formato condicional del acta).
- Sin SharePoint/Google, sin multi-usuario, sin backend.
- El OCR es ayuda dirigida, no transcripción: siempre confirmas viendo la página.

## Verificación

Motor validado con suite headless (Node) que cubre los criterios de aceptación
comprobables sin navegador: normalización (0348/CH6199), explosión
`31428-31432-31441` vs par sospechoso `31428-31500`, exclusiones UF3/PUENTE/ODT
con DIVISO neutro, filtro por empresa y fecha mínima, duplicadas, rezagos,
MATCH_SIN_CEROS a revisión, re-conciliación preservando decisiones manuales,
bloque acta (19 columnas, derivadas vacías, orden por fecha), detección de hoja
mal clasificada con cambio de ámbito, y rendimiento (25k filas ≈ 0,6 s de
indexado; 800 reclamaciones ≈ 6 ms). La pasada roja del OCR se validó offline
contra partes escaneados reales de PUTANA (misma fórmula de filtro, tesseract
nativo): encontró todos los números de recibo de las páginas de prueba.

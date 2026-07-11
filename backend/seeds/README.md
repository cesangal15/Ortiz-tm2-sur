# Seeds de Asistencias — Drenajes ODT + ODL (D72)

Datos extraídos de los Parte Navison reales (ODT: los dos del 01-jul UF1/UF2; ODL: el del
10-jul UF1) para dejar el módulo de Asistencias funcionando con las cuadrillas de drenajes.
**Son TSV (separados por tab): se pegan directo en el Google Sheet de Asistencias** (no en
los .xlsx maestros).

## Orden de pegado (una sola vez, tras redeploy + `setupHojas()`)

1. **CUADRILLAS_odt.tsv** → hoja `CUADRILLAS`, debajo de las de tierras.
   `cuadrilla · responsables(login) · area`. Tres cuadrillas ODT (una por capataz):
   - `EDUARDO` → responsable `eduardo` (LUIS EDUARDO DORADO LOPEZ, UF1/3701)
   - `MAURICIO` → responsable `mauricio` (HERNAN MAURICIO QUIROGA, UF2/3702)
   - `ENRIQUE` → responsable `enrique` (nuevo, aún sin gente; el residente le mueve personal después)

2. **PERSONAL_odt.tsv** → hoja `PERSONAL`, debajo de la gente de tierras.
   57 personas (30 en EDUARDO, 27 en MAURICIO), incluido el capataz como una persona más.
   - `codigo` = número Navison (empata con la hoja Trabajadores de la plantilla al exportar).
   - `cedula` y `cargo` van vacíos (no venían en el Parte): opcionales, el residente los completa.
   - `fecha_ingreso` vacío = "siempre activo" (es la plantilla base). Los ingresos NUEVOS sí llevan fecha.

3. **CC_USADOS_odt.tsv** → hoja `CC_USADOS`, debajo de lo de tierras.
   `string_cc · area`. 71 filas = los del **capítulo 06** (ambos proyectos), que el residente pidió
   mostrar como frecuentes. `area=odt` hace que solo los vean los usuarios de ODT (a los capataces de
   tierra no les ensucia el datalist). **NO incluye el CC del capataz (`I010305`)**: aparecía en el
   selector de CC de los bloques y confundía (es la supervisión del capataz, no la actividad de la
   cuadrilla). Si ya lo pegaste en la hoja `CC_USADOS`, **borra esas 2 filas** (`3701.I010305…` y
   `3702.I010305…`).

## ODL — cuadrilla JAIRO (Parte del 10-jul, UF1)

Mismo procedimiento de pegado que ODT (cada TSV debajo de lo ya existente en su hoja):

1. **CUADRILLAS_odl.tsv** → hoja `CUADRILLAS`. Una sola cuadrilla:
   - `JAIRO` → responsable `jairo` (YONH JAIRO REYES GONZALEZ, código 75781 — venía
     resaltado como capataz en el Parte).

2. **PERSONAL_odl.tsv** → hoja `PERSONAL`. 21 personas, incluido el capataz.
   - Jairo (75781) ya trae **`cargo=CAPATAZ`**: así `asistencia.html` lo excluye de los
     bloques de actividad y le pone su CC `37xx.I010305` automático (D72(4)) — a diferencia
     del seed ODT, donde el cargo quedó para que lo llenara el residente.
   - ⚠️ **JESÚS MANUEL BERMÚDEZ CORREA (76775) ya existe en la cuadrilla MAURICIO** (seed
     ODT) y aparece también en el Parte ODL del 10-jul. Si ya pegaste `PERSONAL_odt.tsv`,
     NO pegues su fila dos veces: usa "Mover" en la gestión de personal (o borra la fila de
     MAURICIO) para dejarlo solo en JAIRO.
   - Nombres verbatim del Parte (p. ej. `LUIS FERNEY0CASTRO`): no importa, el export
     empata por `codigo` contra la hoja Trabajadores de la plantilla.

3. **CC_USADOS_odl.tsv** → hoja `CC_USADOS`. 84 filas con `area=odl`:
   - **Capítulo 07** completo (11 ítems; en el catálogo solo existe bajo 3701).
   - **Capítulo 06** ambos proyectos (la cuadrilla ODL carga a 06.* cuando hace descoles/box
     sobre obras ODT — el propio Parte del 10-jul usa 06.01/06.48/06.60). Los strings 3702
     vienen verbatim del seed ODT (plantilla UF2 del 01-jul); los 3701, del catálogo de la
     plantilla del 10-jul.
   - `3701.I010313| GESTION COMPRAS` (catálogo) y `3702.I010313| GESTION COMPRAS` (verbatim
     del Parte del 10-jul, fila de KEIMIS LERMA): se usan como asignación real de personal.
   - **NO incluye `I010305`** (CC del capataz): el backend ya lo excluye del picker
     (`cc_excluidos_bloque`) y el sistema se lo pone solo al capataz.

## TURNOS.tsv → hoja `TURNOS` (D72)

Los 5 turnos entregados (T1 diurno + T2–T5 nocturnos), una fila por turno × tipo de día
(`turno · tipo_dia · entrada · salida · descanso_ini · descanso_fin · cruza_medianoche`).
`tipo_dia` ∈ {`lv` L–V, `lj` L–J, `viernes`, `sabado`}; `cruza_medianoche=SI` cuando la salida
es del día siguiente (nocturnos). **No hace falta pegar este TSV**: `setupHojas()` ya siembra la
hoja TURNOS con estos mismos valores (si está vacía). El TSV queda como respaldo/edición manual.
El backend los sirve en `?action=roster` (`turnos`) para PRE-LLENAR la entrada/salida del reporte;
la clasificación de extras/recargos nocturnos (columnas G–N Navison) sigue pendiente de confirmar.

## Notas

- El **CC del capataz** es `37xx.I010305| ENCARGADOS, INSPECTORES Y CAPATACES`; el prefijo (3701/3702)
  es el de la UF donde está la mayoría de su gente (opción confirmada: mismo código, cambia el prefijo).
  Cada capataz reporta su propia asistencia eligiendo ese CC (ya está en sus frecuentes).
- ODL (capataz `jairo`) quedó cargado con el Parte del 10-jul (ver sección ODL arriba).
- Si querés ofrecer también el capítulo 07 a ODT, agregá esas filas a `CC_USADOS` con `area=odt`.

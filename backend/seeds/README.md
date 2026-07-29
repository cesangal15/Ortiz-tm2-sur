# Seeds de Asistencias — Drenajes ODT + ODL (D72)

Datos extraídos de los Parte Navison reales (ODT: los dos del 01-jul UF1/UF2; ODL: el del
10-jul UF1) para dejar el módulo de Asistencias funcionando con las cuadrillas de drenajes.
**Son TSV (separados por tab): se pegan directo en el Google Sheet de Asistencias** (no en
los .xlsx maestros).

## Orden de pegado (una sola vez, tras redeploy + `setupHojas()`)

1. **CUADRILLAS_odt.tsv** → hoja `CUADRILLAS`, debajo de las de tierras.
   `cuadrilla · responsables(login) · area · estado`. La 4ª columna `estado` (D84) saca una cuadrilla
   de circulación sin borrar su fila (`activa`/`inactiva`; **vacío = activa**). Tres cuadrillas ODT
   (una por capataz):
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

## D84 — columna `estado` en CUADRILLAS + checklist de la salida a UF3

D84 agrega la columna **`estado`** a `CUADRILLAS` (4ª columna; `activa`/`inactiva`, **vacío = activa**,
retrocompatible). `setupHojas()` ya la siembra; en una hoja ya existente basta con **añadir el
encabezado `estado`** (el backend auto-sana los encabezados al leer). Una cuadrilla `inactiva`
desaparece del roster de hoy, de los faltantes, del export y de los selectores, pero **sus filas de
fechas anteriores siguen saliendo** en el resumen y el export (el filtro aplica al roster esperado, no
a lo ya reportado).

**Checklist operativo de la salida a UF3 (se hace A MANO en el Sheet, el código no lo automatiza):**

1. `ariel` y `albert` están en `PERSONAL` con `cargo=CAPATAZ`. Se **retiran** con
   `fecha_retiro = 2026-07-27` (primer día NO trabajado). **No se borran.**
2. La gente de la cuadrilla **ARIEL** ya se movió a **ROBINSON**. ARIEL queda vacía → marcar su
   `estado = inactiva` (sin hueco pendiente).
3. La gente de **ALBERT** pasó a Robinson en obra, **pero en el sistema la reporta `maleja`**: la
   cuadrilla **ALBERT se conserva con el mismo nombre** y `maleja` queda como **única responsable**
   (editar la celda `responsables` de ALBERT y dejar solo `maleja`). Renombrar la cuadrilla dejaría el
   histórico apuntando a una cuadrilla inexistente. `maleja` ya tiene doble deber (D75) → cero código.

## Notas

- El **CC del capataz** es `37xx.I010305| ENCARGADOS, INSPECTORES Y CAPATACES`; el prefijo (3701/3702)
  es el de la UF donde está la mayoría de su gente (opción confirmada: mismo código, cambia el prefijo).
  Cada capataz reporta su propia asistencia eligiendo ese CC (ya está en sus frecuentes).
- ODL (capataz `jairo`) quedó cargado con el Parte del 10-jul (ver sección ODL arriba).
- Si querés ofrecer también el capítulo 07 a ODT, agregá esas filas a `CC_USADOS` con `area=odt`.

## UF3 — cuadrilla UF3, proyecto 3703 (D101)

Origen: hoja **`Parte`** de la plantilla Navision de UF3 que entregó el usuario (jul-2026), incluida en
el repo como **`plantilla_parte_uf3.xlsx`** (también es la plantilla que la app usa para exportar 3703:
misma estructura que la de 3701 —7 hojas, Parte A–R, mismo listado de Trabajadores— pero con la hoja
`Proyectos` de 3703 y sus 580 `Centros de coste`). El generador solo llena la hoja `Parte` y borra las
filas de ejemplo, así que el libro se puede usar tal cual viene.

Mismo procedimiento de pegado (cada TSV debajo de lo ya existente en su hoja):

1. **CUADRILLAS_uf3.tsv** → hoja `CUADRILLAS`. **Una sola cuadrilla** (decisión del usuario):
   - `UF3` · `responsables` **vacío** · `area=uf3` · `estado` vacío (= activa).
     Nadie de UF3 tiene login de capataz todavía: la reporta `residente_uf3` por la rama de ÁREA de
     `cuadrillasDeUsuario` (la misma de `duvan`). El día que haya capataces con login se agregan a
     `responsables` y los dos canales coexisten — cero código.
2. **PERSONAL_uf3.tsv** → hoja `PERSONAL`. 35 personas, todas en la cuadrilla `UF3`.
   - `codigo` = número Navision (empata con la hoja Trabajadores de la plantilla al exportar).
   - `cedula` va vacía (no venía en el Parte); el nombre va **verbatim** como lo escribe Navision.
   - `cargo=CAPATAZ` en los tres que en el Parte llevan el CC de supervisión `3703.I010305`:
     **76804 ARIEL LISANDRO CORREA**, **76626 CARLOS ERNESTO VILLADA** y **75746 ALBERT ESNAIDER ROJAS**.
     Con eso el formulario los saca de los bloques y les pone su CC propio automáticamente (D72(4)).
3. **CC_USADOS_uf3.tsv** → hoja `CC_USADOS`. **316 filas** con `area=uf3`. A diferencia de ODT/ODL
   —donde `CC_USADOS` es una lista corta de "frecuentes" curada para el capataz— aquí quien reporta es
   la RESIDENTE, así que lleva **todos los CC imputables de 3703** y no solo los siete que aparecen en el
   Parte de muestra. El buscador del formulario muestra 60 y filtra al escribir, así que la lista larga
   no estorba. De las 580 filas de la hoja `Centros de coste` de la plantilla se dejan fuera:
   - los **17 encabezados de capítulo** (`3703.00`, `3703.01`, … : no se imputa a ese nivel),
   - los **245 indirectos** (`3703.I*`, `3703.IFIN*`, `3703.DIF01`): staff, oficina, seguros, impuestos
     — no es trabajo de cuadrilla,
   - las 2 filas malformadas `37I0101…| CREADO POR PROCESO`,
   - y **`3703.I010305`** (supervisión del capataz): el sistema se lo pone solo a quien tiene
     `cargo=CAPATAZ` y lo excluye del selector de bloques por `cc_excluidos_bloque` (D72(3)).
   Quedan los 118 `3703.NN.NN` de los capítulos de vía más los 198 de cuarto nivel de los capítulos
   13–17 (EL BARRO, SAN MARTIN, EL MARQUEZ, PEAJES, SITIO CRITICO). Si alguno sobra, se borra su fila.
4. **CONFIG** (a mano, `setupHojas()` solo siembra con la hoja vacía): agregar la fila
   `proyecto_3703` → `3703| T2 - UF3 - R4513 PR 09+800 - PR 90+718` (string exacto de la hoja
   `Proyectos` de la plantilla). Sin esa fila el export avisa y escribe "3703" pelado, que Navision no
   reconoce.

**Cruces con personal existente — revisar ANTES de pegar.** Contra los seeds de ODT/ODL no hay ninguno.
Contra **tierras hay que mirar el Sheet vivo**: `76804 ARIEL` y `75746 ALBERT` son los dos capataces que
dan nombre a las cuadrillas ARIEL/ALBERT y que D84 mandó retirar con `fecha_retiro = 2026-07-27`. Por eso
sus filas de UF3 llevan **`fecha_ingreso = 2026-07-27`**: sin esa fecha aparecerían en el roster de UF3
también en días anteriores a su salida de tierras, y la residente reporta días pasados. Si el checklist
de D84 no se ejecutó (siguen `activo` en tierras sin fecha de retiro), **primero retíralos allá** — si no,
quedan activos en dos áreas a la vez. El resto de las 34 filas va con
`fecha_ingreso` **vacío** (= siempre activo), que es la convención de la plantilla base: solo los ingresos
NUEVOS llevan fecha.

# Seeds de Asistencias — Drenajes ODT (D72)

Datos extraídos de los dos Parte Navison del 01-jul (UF1 y UF2) para dejar el módulo de
Asistencias funcionando con las cuadrillas ODT. **Son TSV (separados por tab): se pegan
directo en el Google Sheet de Asistencias** (no en los .xlsx maestros).

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
   `string_cc · area`. 73 filas = los 2 CC del capataz (`I010305`, 3701 y 3702) + los 71 del
   **capítulo 06** (ambos proyectos), que el residente pidió mostrar como frecuentes. `area=odt`
   hace que solo los vean los usuarios de ODT (a los capataces de tierra no les ensucia el datalist).

## Notas

- El **CC del capataz** es `37xx.I010305| ENCARGADOS, INSPECTORES Y CAPATACES`; el prefijo (3701/3702)
  es el de la UF donde está la mayoría de su gente (opción confirmada: mismo código, cambia el prefijo).
  Cada capataz reporta su propia asistencia eligiendo ese CC (ya está en sus frecuentes).
- ODL (capataz `jairo`) y sus CC del capítulo 07 quedan pendientes del listado correspondiente.
- Si querés ofrecer también el capítulo 07 a ODT/ODL, agregá esas filas a `CC_USADOS` con `area`.

# Insumos crudos (entregados por el usuario) — NO se pegan en el Sheet

Archivos fuente tal como llegaron. De aquí se **derivan** los TSV de `backend/seeds/`;
el original se conserva para poder auditar de dónde salió cada fila.

## `Plantilla_Parte_Trabajo_UF3.xlsx` (jul-2026)

Plantilla Navision de **UF3 / proyecto 3703**, entregada con la hoja `Parte` **ya llena**
con la gente de UF3 y su centro de coste. Insumo del prompt de asistencias de UF3.

- **7 hojas, idénticas en estructura a `plantilla_parte.xlsx` (3701) de la raíz del repo:**
  `Parte` (18 columnas A–R, mismos encabezados), `Control de partes`, `Proyectos`,
  `Centros de coste`, `Trabajadores`, `Ausencia`, `Motivos ausencia`.
- **Lo que cambia respecto de la de 3701:** la hoja `Proyectos` (una línea, la de 3703) y
  la hoja `Centros de coste` (**580 filas de `3703.*`** contra 386 de `3701.*`).
  La hoja `Trabajadores` (2.458 filas) es **exactamente la misma** en las dos.
- **String de proyecto de 3703** (hoja `Proyectos`, y columna O de las 35 filas):
  `3703| T2 - UF3 - R4513 PR 09+800 - PR 90+718`
- **Hoja `Parte`: 35 personas** con `codigo| NOMBRE` en A y su CC en P. Sin horas
  (las columnas C–N vienen vacías): es el padrón, no un parte de un día concreto.
  CC usados: `06.06` (7), `06.02` (6), `02.05` (5), `06.10` (5), `03.06` (4), `03.02` (4),
  `I010305` (3 — capataces/encargados), `03.07` (1).

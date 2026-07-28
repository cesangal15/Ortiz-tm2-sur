# PROMPT — D100 · Asistencias de UF3 (proyecto 3703) en el MISMO módulo

> **Regla de oro:** este cambio es **solo del módulo de Asistencias** (D69).
> No se toca `Codigo.gs`, ni BANDEJA/DATA/MAQUINARIA/VOLQUETAS, ni ninguna pantalla de obra.
> No se rediseña nada: tema oscuro existente, DM Sans / Syne, acento naranja `#f5a623`.

---

## 1. Objetivo

Dar a la **residente de UF3** un canal propio dentro del módulo de asistencias, con el
**mismo molde que `duvan` (D88)** pero para una sola área:

1. **Reportar** la asistencia de las cuadrillas de UF3 (eligiendo la cuadrilla, como el admin),
   **incluidos días anteriores** — hoy no hay capataces de UF3 con login, ella sube todo.
2. **Revisar el resumen** del día, ver el detalle por cuadrilla (D76), completar faltantes,
   consultar ausencias por rango (D94) y **descargar el Excel Navision** — en su caso **un solo
   proyecto: `3703`**.
3. **Gestionar el personal** de sus cuadrillas (alta / retiro / mover / reactivar), acotado a su área.

**Naturaleza del cambio — solución puente, deliberadamente reversible.**
UF3 entra como un área más (`uf3`) en el MISMO Sheet y el MISMO
`CodigoAsistencias.gs` que tierras/ODT/ODL — no se crea módulo, ni Sheet,
ni Apps Script nuevos (mismo camino de D72 con drenajes). Se elige esta
forma precisamente porque es la más barata de poner Y de quitar: el día que
UF3 tenga su sistema propio (backlog 3.5), basta con marcar sus cuadrillas
`estado=inactiva` (D84) y retirar el login — el histórico de ASISTENCIA
queda intacto y no hay nada que desmontar ni migrar.

Alcance de lo "temporal": lo provisional es que la residente reporte por
TODAS las cuadrillas de UF3, porque hoy ninguna tiene capataz con login.
Eso se disuelve solo al agregar responsables a CUADRILLAS (los dos canales
coexisten, cero código). El resto — el área `uf3`, el proyecto 3703 y el
export del Parte — no es provisional: el módulo de asistencias ya es
multi-área y puede quedarse así aunque UF3 monte su sistema de obra aparte.

---

## 2. PASO 0 — VERIFICACIÓN OBLIGATORIA (antes de tocar una sola línea)

No modifiques nada hasta completar esta lista y **reportarme los hallazgos**. Si algo no coincide
con lo que aquí se asume, **para y dímelo** en vez de improvisar.

Lee primero `PROJECT_CONTEXT.md`, y de `02_REGISTRO_DECISIONES.md` las decisiones
**D69, D72, D74b, D76, D78, D81, D84, D85, D88, D94, D99**.

Luego, con el código a la vista, confirma y **cita la línea/función**:

| # | Qué verificar | Dónde |
|---|---|---|
| 0.1 | `areasDeUsuario()` — cómo mapea rol → array de áreas; qué devuelve para `admin` (se espera `[]` = sin filtro) y cómo se aplica (`includes`). | `CodigoAsistencias.gs` |
| 0.2 | `cuadrillasDeUsuario()` — la rama de `duvan`: ¿devuelve **todas las cuadrillas activas** cuyo `area` esté en `areasDeUsuario`, **sin mirar `responsables`**? Es la rama que hay que reutilizar. | `CodigoAsistencias.gs` |
| 0.3 | `proyectoFromCC()` — **¿está cableado a `3701`/`3702`?** (p. ej. una comparación literal, un `indexOf`, un mapa de dos entradas). Reporta el fragmento exacto. | `CodigoAsistencias.gs` (y dónde más se use) |
| 0.4 | Cómo el export decide el/los **proyecto(s) del día** y de dónde saca el string de proyecto para la plantilla (`CONFIG.proyecto_3701` / `proyecto_3702`) y el `proyectoDefecto` de respaldo. | `CodigoAsistencias.gs` + `resumen-asistencia.html` |
| 0.5 | Prefijo del **CC del capataz** (D72(4)): la lógica de "mayoría de UF" — ¿elige entre 3701 y 3702 con lógica cerrada de dos valores, o toma el prefijo del CC genéricamente? | `asistencia.html` |
| 0.6 | `ccUsadosParaArea()` — que ya acepta área **o array** (D88e) y filtra `CC_USADOS` por la columna `area`. | `CodigoAsistencias.gs` |
| 0.7 | `esVistaTierras()` — qué condiciona exactamente (guía dom/fest de D81 y el aviso de "sin reportar" en dom/fest) y con qué roles/áreas da `true`. | `resumen-asistencia.html` |
| 0.8 | Guards de `resumen-asistencia.html` y la validación de rol de `gestionPersonal` en el backend: **lista literal de roles aceptados**. | ambos |
| 0.9 | Selector **"Ver como"** del admin (D74b): dónde se construye la lista de áreas. | `resumen-asistencia.html` |
| 0.10 | **Fechas anteriores en `asistencia.html`:** ¿el `<input type="date">` tiene `max`, o hay validación de "solo hoy / últimos N días" en frontend o backend? Reporta qué límite existe hoy. | `asistencia.html` + `CodigoAsistencias.gs` |
| 0.11 | Columnas reales (orden e índices) de **CUADRILLAS**, **PERSONAL** y **CC_USADOS**, y qué siembra `setupHojas()`. | `CodigoAsistencias.gs` |
| 0.12 | `cc_excluidos_bloque` (D72(3)): confirmar que el match es **por substring**, así `3703.I010305` queda excluido de los bloques **sin cambio alguno**. | `CodigoAsistencias.gs` |
| 0.13 | `?action=ausencias` (D94): que el filtro de área use `areasEfectivas` y por tanto herede `uf3` sin tocar nada. | `CodigoAsistencias.gs` |

**Entregable del Paso 0:** un resumen corto (10–15 líneas) con lo encontrado en 0.3, 0.5 y 0.10,
que son los tres puntos donde puede haber trabajo real oculto.

---

## 3. Alcance funcional

### 3.1 Login y rol nuevo (`index.html`)

- Usuario nuevo: **`{{USUARIO_UF3}}`** / clave **`{{CLAVE_UF3}}`** *(placeholder, endurecimiento 2.21)*.
- **Rol propio: `asistencia_plus_uf3`**, campo `areas: ['uf3']`.
- **Por qué rol propio y no reutilizar `residente`:** los guards de las pantallas de obra
  (`encargado.html`, `residente.html`, `jefe.html`, `reporte-*`) van por **rol**; con un rol nuevo
  queda **imposible por construcción** que entre a obra, no por omisión de un tile (mismo argumento
  de D88a).
- Ruteo: aterriza en **`seleccion-reporte.html`** con dos tiles —
  **"Asistencia de UF3"** (`asistencia.html`) y **"Resumen de asistencias"** (`resumen-asistencia.html`).

### 3.2 Backend `CodigoAsistencias.gs` — el área `uf3`

- `areasDeUsuario()`: `asistencia_plus_uf3` → `['uf3']`.
- `cuadrillasDeUsuario()`: **reutiliza la rama de `duvan`** (0.2) — para `asistencia_plus_uf3`
  devuelve **todas las cuadrillas ACTIVAS con `area='uf3'`**, sin mirar `responsables`.
  Motivo: hoy no hay capataces de UF3 con login; ella reporta por todos. Si mañana los hay,
  se agregan a `responsables` y **coexisten los dos canales** (el envío pisa `fecha+cuadrilla`, D03),
  igual que en drenajes — **cero código extra**.
- `gestionPersonal` y `personalCompleto`: autorizar `asistencia_plus_uf3` y **acotarlo a su área**
  (misma validación que los residentes de área; no puede mover gente a/desde tierras u ODT/ODL).
- **Validar en el backend, no solo en el frontend** (regla D69h).
- El resto del backend (roster date-aware D85, turnos D72, notas D74, detalle D76, ausencias D94)
  debe funcionar **sin cambios** por ser genérico sobre `area`. Si encuentras algún filtro con
  `'tierras'|'odt'|'odl'` **enumerado a mano**, repórtalo y generalízalo.

### 3.3 Proyecto `3703` — el punto delicado

- **`proyectoFromCC()` debe aceptar `3703`.** Si el Paso 0.3 confirma que está cableado a dos
  valores, **generalízalo**: tomar el prefijo numérico del CC (`^(\d{4})\.`) y devolverlo, en vez
  de comparar contra una pareja fija. No listes proyectos válidos a mano.
- **`CONFIG.proyecto_3703`** — parámetro nuevo, **semilla `"PENDIENTE"`** (mismo tratamiento que
  `proyecto_3702`, backlog 4.3). Si viene vacío o `"PENDIENTE"`, el generador **avisa con la causa
  exacta y no inventa el string**. `setupHojas()` lo siembra en instalaciones nuevas; en la
  instalación viva **lo agrega el usuario a mano** en la hoja CONFIG (no requiere redeploy leerlo,
  pero sí el resto de cambios).
- Export: el `Parte` se sigue armando **por día × proyecto** y el archivo se sigue llamando
  `Parte_{proyecto}_{fecha}.xlsx` → para ella saldrá **un solo archivo, `3703`**. No se toca el
  clasificador de horas ni el layout de 18 columnas (A–R).
- **Prefijo del CC del capataz** (0.5): si la lógica de "mayoría de UF" está cerrada a 3701/3702,
  generalízala al **prefijo mayoritario de los CC reportados por esa cuadrilla ese día**, con los
  mismos respaldos que hoy (CC más reciente de la cuadrilla → en última instancia, el prefijo del
  primer CC del área). **No** dejes `3701` como último respaldo para un área que no es tierras.

### 3.4 `asistencia.html`

- **Se espera CERO cambios** (D88b): el `<select>` de cuadrilla ya aparece cuando el usuario tiene
  más de una, y "← Volver" ya apunta a `seleccion-reporte.html` para todo rol distinto de admin.
- **Única excepción, según el Paso 0.10 — días anteriores:** si existe un tope (`max` en el input o
  validación de antigüedad), la residente de UF3 debe poder reportar **fechas pasadas**.
  - Si el tope es solo `max = hoy`: **está bien, no se toca** (no hay que reportar el futuro).
  - Si hay un límite de antigüedad hacia atrás: **quítalo para este rol** (o súbelo a un valor de
    CONFIG), y deja el aviso en la confirmación de envío indicando la fecha que se está pisando.
  - Reporta qué encontraste antes de cambiarlo.

### 3.5 `resumen-asistencia.html`

- **Guard:** aceptar `asistencia_plus_uf3` (junto a `residente`, `admin`, `jeisson`/`asistencia_plus`,
  `residente_odt`/`residente_odl`/`residente_dren`, `duvan`/`asistencia_plus_dren`).
- Mismo alcance que `duvan` pero sobre `uf3`: resumen del día, detalle por cuadrilla con edición
  (D76), completar faltantes (`asistencia_individual`), ausencias por rango (D94), export Navision
  y gestión de personal.
- **No ve** tierras, ni ODT/ODL, ni las **extras del admin** (D73 — son CC de tierras).
- **No ve** el selector "Ver como" (solo admin) y **no puede burlar su área**: el backend la fuerza
  e **ignora `&area=`** para roles con área forzada.
- **Selector "Ver como" del admin:** agregar la opción **UF3** a la lista (0.9).

### 3.6 Domingos y festivos — **DECISIÓN A CONFIRMAR**

`esVistaTierras()` (0.7) hoy separa dos comportamientos:
- **Tierras (D81):** dom/fest se reporta **solo a quien trabajó**; el aviso de "gente sin reportar"
  se suprime esos días.
- **Drenajes:** el aviso se **conserva** todos los días.

**Propuesta por defecto:** UF3 es movimiento de tierras con el mismo tipo de cuadrilla, así que
sigue la **regla de tierras (D81)** → `esVistaTierras()` devuelve `true` también para `uf3`.

> ⚠️ **No implementes esto hasta que el usuario lo confirme por escrito.** Si al llegar aquí no
> tienes la confirmación, deja `uf3` con el comportamiento **de drenajes** (más conservador: avisa
> siempre) y **anótalo como pendiente** — es un cambio de una línea revertir.

### 3.7 Datos que aporta el usuario (no se fabrican)

Claude Code **no inventa** roster ni centros de costo. Genera los **seeds TSV** en
`backend/seeds/` a partir de los archivos que entregue el usuario, con las mismas columnas que los
existentes (verificadas en 0.11):

- `CUADRILLAS_uf3.tsv` → `cuadrilla · responsables · area · estado`
  (`area=uf3`, `estado=activa`, `responsables` **vacío** por ahora — ella entra por la rama 0.2).
- `PERSONAL_uf3.tsv` → mismas columnas que `PERSONAL_odt.tsv`/`_odl.tsv`, con `fecha_ingreso`
  cuando el listado la traiga y `cargo=CAPATAZ` en quien lo sea (para que la corrección D72(4) lo
  saque de los bloques y le ponga su CC de supervisión automático).
- `CC_USADOS_uf3.tsv` → los CC de UF3 con `area=uf3`.

⚠️ **Antes de pegar:** cruzar el listado de UF3 contra `PERSONAL` por **código Navision**.
Si alguien ya está activo en una cuadrilla de tierras/ODT/ODL, **se MUEVE** con la gestión de
personal (respetando el roster *date-aware* de D85), **no se duplica la fila** — mismo caso que
el de JESÚS MANUEL en el seed ODL (D72h). Reporta los cruces encontrados; no los resuelvas solo.

---

## 4. Parámetros abiertos — NO INVENTAR

| # | Parámetro | Estado |
|---|---|---|
| P1 | Usuario y clave de la residente de UF3 (`{{USUARIO_UF3}}` / `{{CLAVE_UF3}}`) | pendiente del usuario |
| P2 | `CONFIG.proyecto_3703` — string exacto de la plantilla Navision de 3703 | semilla `"PENDIENTE"`; el generador avisa y no exporta ese proyecto |
| P3 | Regla dom/fest de UF3 (§3.6) | pendiente de confirmación; default conservador = comportamiento de drenajes |
| P4 | ¿La **plantilla** `Plantilla_Parte_Trabajo…xlsx` de 3703 es la **misma** que la de 3701/3702? | pendiente. Si es distinta, ojo: la plantilla recordada en `localStorage` (backlog 4.4c) es **un solo slot por navegador** — ella subiría la suya y listo, pero el **admin** tendría que re-subir al cambiar de proyecto. **No implementes** el guardado por proyecto: proponlo como ítem V2 |
| P5 | Nombre(s) de la(s) cuadrilla(s) de UF3 y sus capataces | del listado que entregue el usuario |
| P6 | Mapeo I–N del Parte (backlog 4.2) | sigue abierto, **no cambia** con esto |

Los parámetros abiertos se dejan **explícitos en el código** (constante o `CONFIG` con `TODO`),
nunca resueltos a ojo.

---

## 5. Fuera de alcance (no lo hagas, ni siquiera "de paso")

- **El sistema espejo completo de UF3** (backlog 3.5): reporte de obra, bandeja, envío a DATA,
  maquinaria, panel del residente, WhatsApp, Sheet propio. **Esto es SOLO asistencias.**
- Tocar `Codigo.gs` (**cero cambios, cero redeploy**), BANDEJA/DATA/MAQUINARIA/VOLQUETAS,
  `deriveArea`, el pisado por día+área, o cualquier pantalla de obra.
- Dar a `asistencia_plus_uf3` acceso a tierras, drenajes, paneles o reportes de obra.
- Cambiar el clasificador de horas, el layout de 18 columnas del `Parte`, o el mapeo I–N.
- Borrar personas, cuadrillas o filas históricas (regla permanente: `inactivo` + fecha).
- Rediseñar pantallas o cambiar el estilo visual.
- Guardar la plantilla Navision por proyecto (P4 → V2).

---

## 6. Reglas técnicas del proyecto (recordatorio)

- **Apps Script:** fechas por **duck-typing** (`typeof x.getFullYear === 'function'`),
  **nunca** `instanceof Date` ni `Utilities.formatDate` para comparar; POST con
  `Content-Type: text/plain`; **redespliegue editando la implementación** (versión nueva, **misma URL**).
- **Frontend:** archivos completos listos para subir a GitHub Pages (no parches sueltos).
- **`CACHE_V`:** **NO sube** si la lista de precache de `sw.js` no cambia (precedente D88).
  Consecuencia consciente: un equipo sin señal verá el login viejo hasta recuperar conexión — decláralo.
- Nombres exactos: `asistencia.html`, `resumen-asistencia.html`, `seleccion-reporte.html`,
  `index.html`, `backend/CodigoAsistencias.gs`.

---

## 7. Entregables

1. **Resumen del Paso 0** (§2) — antes de cualquier cambio.
2. Archivos completos modificados:
   - `index.html` (login + rol + ruteo)
   - `seleccion-reporte.html` (tiles del rol nuevo)
   - `resumen-asistencia.html` (guard, "Ver como" admin, dom/fest según P3)
   - `backend/CodigoAsistencias.gs` (áreas, cuadrillas, `proyectoFromCC`, `CONFIG.proyecto_3703`, autorizaciones)
   - `asistencia.html` **solo si** el Paso 0.10 lo obliga (prefijo del capataz / fechas anteriores)
3. Seeds en `backend/seeds/`: `CUADRILLAS_uf3.tsv`, `PERSONAL_uf3.tsv`, `CC_USADOS_uf3.tsv`
   (a partir de los archivos del usuario) + **lista de cruces detectados** con personal existente.
4. **Nota de despliegue:** qué redesplegar (`CodigoAsistencias.gs` → sí; `Codigo.gs` → no),
   qué subir a GitHub Pages, qué pegar a mano en el Sheet (seeds + `CONFIG.proyecto_3703`).
5. Actualización de documentación (§8).

---

## 8. Actualización de la documentación (obligatoria, en la misma entrega)

### 8.1 `02_REGISTRO_DECISIONES.md` — decisión nueva **D100**

> `D100` es el siguiente libre: el registro llega hasta **D99**.

| ID | Decisión | Estado | Origen |
|---|---|---|---|
| D100 | **Asistencias de UF3 (proyecto `3703`) sobre el MISMO módulo — reabre parcialmente el ítem 3.5.** Pedido del usuario (jul-2026): la residente de UF3 necesita subir la asistencia de su gente —incluidos **días anteriores**— y descargar su Excel Navision. **No es el sistema espejo de 3.5** (sin reporte de obra, sin bandeja, sin DATA, sin maquinaria): es **solo el canal de asistencias**, y como el módulo es *data-driven* vía CUADRILLAS (D69/D72), UF3 entra como **un área más (`uf3`) en el MISMO Sheet y el MISMO `CodigoAsistencias.gs`**. **(a) Login y rol:** usuario nuevo con **rol propio `asistencia_plus_uf3`** y `areas: ['uf3']` — rol propio (no `residente`) porque los guards de obra van por ROL, así queda **imposible por construcción** que entre a bandeja/DATA (mismo argumento de D88a). Aterriza en `seleccion-reporte.html` con dos tiles. **(b) Reporta además de revisar:** `cuadrillasDeUsuario` le devuelve **todas las cuadrillas ACTIVAS de `uf3`** sin mirar `responsables` (rama de `duvan`, D88b), porque hoy no hay capataces de UF3 con login; si mañana los hay, se agregan a `responsables` y los dos canales coexisten (el envío pisa `fecha+cuadrilla`, D03). **(c) Alcance de datos:** resumen del día, detalle por cuadrilla con edición (D76), completar faltantes (`asistencia_individual`), ausencias por rango (D94), export Navision de `3703` y gestión de personal de sus cuadrillas — todo acotado a `uf3` **por el backend**, que ignora `&area=`. No ve tierras ni drenajes ni las extras del admin (D73). **(d) Proyecto `3703`:** `proyectoFromCC` deja de estar cableado a 3701/3702 y **deriva el prefijo del CC genéricamente**; lo mismo el prefijo del CC de supervisión del capataz (D72(4)), que ya no cae a `3701` por defecto en áreas que no son tierras. Parámetro nuevo **`CONFIG.proyecto_3703`**, semilla `"PENDIENTE"`: si está vacío el generador **avisa y no exporta**, no inventa el string (mismo trato que `proyecto_3702`, backlog 4.3). **(e) Selector "Ver como" del admin** (D74b) gana la opción UF3. **(f) Dom/festivo:** *(P3 — anotar aquí la regla confirmada: tierras D81 o drenajes)*. **(g) Datos:** seeds `CUADRILLAS_uf3.tsv` / `PERSONAL_uf3.tsv` / `CC_USADOS_uf3.tsv` del listado del usuario; quien ya esté activo en otra área **se mueve, no se duplica** (roster date-aware, D85). **(h) Carácter puente:** solución deliberadamente reversible mientras UF3 no tenga su sistema propio (3.5). Salida limpia = `estado=inactiva` en sus cuadrillas + retiro del login (patrón D84), sin borrar histórico. Lo único realmente provisional es el reporte centralizado en la residente (§b); el área `uf3`, `proyectoFromCC` genérico y `CONFIG.proyecto_3703` son mejoras permanentes que el módulo necesitaba igual. **Fuera de alcance:** todo el sistema espejo de obra de UF3 (3.5 sigue abierto), tocar `Codigo.gs`, el clasificador de horas, el layout del Parte y el mapeo I–N. | ✅ Cerrada (alcance); pendiente validación en campo + redeploy | jul-2026. Extiende D69/D72 con un área más y reusa el molde de D88. **Enmienda el "fuera de alcance UF3" de D84/D88** (solo para asistencias) y **cierra parcialmente el backlog 3.5**. Redeploy: `CodigoAsistencias.gs`. `Codigo.gs` **sin cambios**. GitHub Pages: `index.html`, `seleccion-reporte.html`, `resumen-asistencia.html` (+ `asistencia.html` si el Paso 0.10 lo obligó). `CACHE_V` no sube. |

### 8.2 `03_BACKLOG.md` — ítem **4.12** (siguiente libre; el bloque 4 llega a 4.11)

| 4.12 | **Asistencias de UF3 / proyecto `3703` (D100).** Rol nuevo `asistencia_plus_uf3` (`areas:['uf3']`) que reporta cualquier cuadrilla activa de UF3 —incluidos días anteriores—, revisa el resumen, completa faltantes, consulta ausencias, exporta el Parte de `3703` y gestiona su personal. UF3 entra como **área más** en el MISMO Sheet/Apps Script (D69/D72), no como módulo. `proyectoFromCC` generalizado a cualquier prefijo `37xx`; `CONFIG.proyecto_3703` como parámetro abierto. | ✅ Hecho (alcance); pendiente validación en campo + redeploy — jul-2026, D100 |

Y en el ítem **3.5** agregar: *"**Parcialmente cerrado por D100** en su parte de **asistencias**; sigue abierto todo el lado de obra (reporte, bandeja, DATA, maquinaria, panel)."*

### 8.3 `PROJECT_CONTEXT.md`

En el párrafo del **Módulo Asistencias**, tras la mención de `duvan`, agregar el equivalente de UF3
(rol, área `uf3`, proyecto `3703`, que reporta y revisa, que no toca obra) y sumar `uf3` a la lista
de valores de la columna `area` de CUADRILLAS.

### 8.4 `05_CATALOGO.md`

Agregar la residente de UF3 al bloque **"Módulo Asistencias (D69) — usuarios y mapa
cuadrilla→responsable"**, sumar las cuadrillas de UF3 a la tabla de CUADRILLAS
(`area=uf3`, `responsables` vacío) e incluir `asistencia_plus_uf3` en la línea de
"Acceso a `resumen-asistencia.html`".

### 8.5 `04_ARQUITECTURA.md`

En el bloque de **Áreas**, sumar `uf3` a los valores de la columna `area` y a la enumeración de
`areasDeUsuario()`; anotar que `proyectoFromCC` deriva el prefijo genéricamente y que
`CONFIG` gana `proyecto_3703`.

---

## 9. Criterios de aceptación

1. La residente de UF3 entra con su usuario y ve **exactamente dos tiles**; ninguna URL de obra le
   abre (probar entrando a `residente.html`, `encargado.html` y `reporte-drenajes.html` a mano →
   debe rebotar al login).
2. En `asistencia.html` puede **elegir cuadrilla de UF3** y **una fecha pasada**, y el envío queda
   con `reporta = {{USUARIO_UF3}}`; re-enviar la misma `fecha+cuadrilla` **pisa** lo anterior (D03).
3. En el resumen ve **solo UF3** — cero filas de tierras/ODT/ODL — y el `&area=` manipulado a mano
   en la petición **no** le amplía el alcance.
4. Con `CONFIG.proyecto_3703` en `"PENDIENTE"`, el export **avisa con la causa exacta** y no genera
   un archivo con el string equivocado. Con el string real, genera **un solo** `Parte_3703_{fecha}.xlsx`
   con la hoja `Parte` llena y **las demás hojas de la plantilla intactas**.
5. Un CC `3703.*` devuelve `3703` en `proyectoFromCC`, y el CC de supervisión del capataz de UF3
   sale con prefijo **3703**, no 3701.
6. `3703.I010305` **no** aparece en el picker de CC de los bloques (D72(3), match por substring).
7. **No regresión:** tierras, ODT y ODL siguen exactamente igual — resumen, export (3701/3702),
   detalle por cuadrilla, ausencias, extras del admin y gestión de personal. Verificar el export de
   un día ya validado y comparar **celda a celda** contra el archivo anterior.
8. `Codigo.gs` sin un solo cambio; BANDEJA/DATA/MAQUINARIA intactas.

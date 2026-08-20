# PROMPT — Backlog 2.29: pestaña de FLOTA en la pantalla de maquinaria

> **Cómo usar este archivo:** pégalo como primer mensaje de un chat nuevo del Project. Todo lo que
> dice aquí ya está decidido con el dueño (ago-2026): no hay que volver a proponerlo ni discutirlo.
> Lee antes `docs/PROJECT_CONTEXT.md` y, de `docs/02_REGISTRO_DECISIONES.md`, las decisiones
> **D138** (catálogo vivo), **D137** (flota esperada), **D136** (devoluciones), **D59/D60/D61/D62**
> (la pantalla que se va a ampliar) y **D69** (aislamiento del módulo de asistencias).

## Qué hay que hacer

Ampliar `produccion-maquinaria.html` con una segunda pestaña para **dar de alta y de baja máquinas**
(escribir la hoja `MAQUINAS` de D138 desde la web, en vez de a mano en el Sheet), y abrirle la
pantalla al residente de tierras, a `jeisson` y al jefe.

## Por qué existe este ítem

D138 mudó el catálogo de máquinas a la hoja `MAQUINAS` para que un alta o una baja fuera editar una
fila en vez de una sesión de desarrollo. Al cerrarlo quedó un riesgo señalado en la propia decisión:
**el `id_maquina` lo teclea ahora una persona, y tiene que coincidir letra por letra con
`dim_maquinaria` del maestro `Modelo_Produccion_Maquinaria` o el pegado a `Captura_Diaria` deja de
cruzar EN SILENCIO** (por eso `RT-02` va con guion, D111). Una hoja suelta no puede avisar de eso;
una pantalla sí. Esa es la razón principal del ítem — la comodidad de no entrar al Sheet es
secundaria.

## Decisiones ya cerradas con el dueño (NO reabrir)

1. **Va como PESTAÑA en `produccion-maquinaria.html`, no en una pantalla nueva.** La pantalla pasa a
   llamarse **"Maquinaria"** (hoy "Producción de Maquinaria") con dos pestañas: **Producción del
   día** (exactamente lo que ya hace, sin tocar) y **Flota**. Se descartó una pantalla aparte: sería
   la número 14, compartiendo modelo de datos y audiencia. El criterio con el que D112 sí justificó
   pantalla propia (`horas-persona.html`) era que **la entrada fuera distinta** — una persona en vez
   de una fecha; aquí las dos pestañas entran por lo mismo, un día de máquinas.
2. **Accesos:** `admin` y `residente` (tierras) editan todo. **`jeisson` también edita la flota**
   (su cuadrilla es OPERADORES, los operadores de estas máquinas). **`jefe` entra en SOLO LECTURA.**
3. **La puerta del jefe sigue siendo `jefe.html`:** desde ahí un enlace/tile a la pantalla de
   Maquinaria, que al detectar rol `jefe` esconde TODO lo editable (ajustes de producción,
   redirección, registro de horas, altas y bajas). No se duplica el contenido dentro de `jefe.html`.
4. **`jeisson` es el primer usuario de asistencias que entra a una pantalla de OBRA.** Está aceptado
   a propósito. **No** implica mezclar los módulos: `produccion-maquinaria.html` habla con el Apps
   Script de obra y el aislamiento de D69 (Sheet y script propios para asistencias) **no se toca**.

## Lo que YA existe y hay que reusar (no rehacer)

- **Hoja `MAQUINAS`** (D138): `id_maquina · tipo · horas_prog · propiedad · fecha_ingreso ·
  fecha_retiro · notas`. **Una fila por ESTANCIA**, ventana **semiabierta `[ingreso, retiro)`** con
  `fecha_retiro` = primer día que YA NO estuvo (vacía = sigue en obra). Semilla en
  `backend/seeds/MAQUINAS.tsv`.
- **Backend `Codigo.gs`:** `getFlotaRows_()`, `flotaEnFecha_(fecha)`, `maquinasCatalogo(e)`,
  constantes `MAQUINAS_HEADERS`, `MAQ_TIPOS_VALIDOS`, `MAQ_CATALOGO` (respaldo), `MAQ_INTERMITENTES`.
  Endpoint `?action=maquinas&fecha=` (solo lectura, devuelve `avisos`).
- **Cliente `flota.js`:** `TM2Flota.cargar/ids/tipos/progs/deTipo/sinProduccion/aviso`.
- **Arnés `backend/pruebas/verificar_d138_flota_viva.js`** (32 comprobaciones): hay que **ampliarlo**,
  no crear otro para lo mismo.

## Alcance

### 1. Pestaña "Flota" (lectura)

Tabla de **estancias** de la hoja `MAQUINAS`, agrupadas por máquina y ordenadas por tipo (el orden de
`MAQ_ORDEN_TIPO`) y luego por id. Por máquina: si está **en obra hoy** (badge) o desde cuándo/hasta
cuándo estuvo, y el historial de estancias plegado. Mostrar arriba los `avisos` que ya devuelve
`?action=maquinas` (filas sin fecha válida, tipos desconocidos, estancias traslapadas) — hoy nadie
los ve.

### 2. Alta, baja y reingreso (escritura)

- **Alta / reingreso:** `id_maquina`, `tipo` (lista de `MAQ_TIPOS_VALIDOS`), `propiedad`
  (propia/alquilada), `fecha_ingreso`, `horas_prog` opcional (vacía → 5 h alquilada / 6.4 h propia,
  D10) y `notas`. Un reingreso es una **fila nueva**, nunca editar la vieja: editarla perdería el
  hueco en que la máquina no estuvo (lección de D85 con el personal).
- **Baja:** poner `fecha_retiro` a la estancia abierta. Recordar en la propia pantalla que es **el
  primer día que ya NO estuvo**, no el último que trabajó — es el error fácil.
- **Corregir** una estancia mal escrita (fechas o datos), sin que eso sea el camino del reingreso.
- **Identidad de la estancia = `id_maquina` + `fecha_ingreso`**, no el número de fila: alguien puede
  estar editando la hoja a mano al mismo tiempo y los números de fila se mueven. Rechazar dos
  estancias con la misma clave.

### 3. El guard de typos (la razón del ítem)

No se puede leer `dim_maquinaria`: es un `.xlsx` maestro y la regla del proyecto es no tocarlos. **Sí
se puede comparar contra los `id_maquina` que ya existen en la hoja `MAQUINARIA`**, que es
exactamente el vocabulario que después se pega a `Captura_Diaria`.

Al dar de alta un ID que **no** aparece en ese histórico ni en `MAQUINAS`, avisar antes de guardar:

> `RT02` no aparece en el histórico de MAQUINARIA. El parecido más cercano es **`RT-02`**.
> ¿Es una máquina nueva de verdad?

- El caso común es el typo de una máquina que **ya existe**, y se atrapa **normalizando**: quitar lo
  que no sea alfanumérico y pasar a mayúsculas (`RT02` y `RT-02` colapsan al mismo `RT02`). Con eso
  basta para el 90 %; no hace falta distancia de edición, y si se añade que sea encima de esto.
- Una máquina genuinamente nueva se confirma una vez y entra.
- **Leer solo la COLUMNA `id_maquina` de MAQUINARIA**, con el lector acotado de D107 — esa hoja
  crece y tiene ~40 columnas; leerla entera por esto sería una regresión de rendimiento.

### 4. Endpoint nuevo de ESCRITURA

`POST {action:'flota_guardar', ...}` en `doPost`. Puntos que **no** se pueden pasar por alto:

- **Rol en el SERVIDOR, no solo en el guard del cliente** (D109: la identidad sale del token y
  `doPost` ya sobrescribe `body.usuario`). Escriben `admin`, `residente`, `jeisson`. **`jefe` NO.**
- **`fdateValida_` en las dos fechas** (D106): sin fecha válida no se escribe nada.
- **`getSheet('MAQUINAS', MAQUINAS_HEADERS)`** para que se auto-sanen los encabezados, y
  `ensureRows_` antes de anexar (D93).
- **Invalidar las DOS memorias:** `invalidarHoja_('MAQUINAS')` **y** `_flotaRows = undefined`.
  `getFlotaRows_` tiene memo propio (no usa `_memoHoja`), así que si solo se invalida la hoja, una
  lectura posterior en la misma ejecución devuelve datos viejos en silencio — es exactamente el
  problema que D107 documentó para `_memoRango`.
- Rechazar `fecha_retiro` anterior a `fecha_ingreso` y estancias traslapadas de la misma máquina.

## Lo que NO se toca

- **La recepción de reportes sigue SIN validar contra el catálogo** (D138). Un reporte que esperó en
  la cola sin señal (D82) puede traer una máquina ya devuelta: rechazarlo perdería trabajo real del
  capataz. El catálogo decide qué se OFRECE y qué se ESPERA, nunca qué se acepta.
- **La pestaña "Producción del día" queda igual.** Este ítem no cambia el ajuste de producción, la
  redirección ni el registro de horas (D59/D60/D61/D62).
- **BANDEJA, DATA y los maestros:** esta pantalla nunca los escribió y sigue sin hacerlo.
- **El respaldo:** `MAQ_CATALOGO` y las listas de respaldo de las pantallas se conservan. Nunca se
  sirve una flota vacía.
- **`sw.js`:** no entran archivos nuevos al precache, así que **`CACHE_V` no sube**. Y esta pantalla
  no va al precache: necesita datos vivos (D49).

## Verificación esperada

Ampliar `backend/pruebas/verificar_d138_flota_viva.js` (o un `verificar_d139_*.js` hermano) con:

- el guard de rol: `jefe` no puede escribir; `admin`/`residente`/`jeisson` sí;
- fechas inválidas y `retiro < ingreso` → no escribe nada;
- estancia duplicada (misma máquina + mismo ingreso) → rechazada;
- el detector de parecidos: `RT02` propone `RT-02`; una máquina nueva de verdad no dispara falso positivo;
- que tras escribir, una lectura en la MISMA ejecución ve lo nuevo (las dos memorias invalidadas);
- que `guardarReporte` sigue sin consultar el catálogo.

Y **mutar algo a propósito para comprobar que el arnés no es ciego**, como se hizo en D138 con la
ventana semiabierta.

## Al terminar

- Decisión nueva en `docs/02_REGISTRO_DECISIONES.md` (la siguiente libre; D138 es la última usada).
- `docs/03_BACKLOG.md`: marcar **2.29** como hecho.
- `docs/05_CATALOGO.md` §4 y `docs/PROJECT_CONTEXT.md`: que la flota se administra desde la pantalla.
- Avisar que **requiere redespliegue del Apps Script de obra** (endpoint de escritura nuevo).

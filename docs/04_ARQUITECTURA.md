# ARQUITECTURA GENERAL — TM2 Sur

## Componentes

```
┌─────────────────────────── GITHUB PAGES (frontend estático) ───────────────────────────┐
│  index.html ──login──> menu.html (admin)                                                │
│                        ├── encargado.html      (encargado, admin)                       │
│                        ├── reporte-capataz.html (capataz, encargado, admin)             │
│                        ├── reporte-chequeadora.html (chequeadora, admin)                │
│                        ├── estado.html          (admin)                                 │
│                        ├── produccion-maquinaria.html (admin · ajuste de producción)    │
│                        ├── residente.html      (residente, admin)                       │
│                        ├── jefe.html (jefe · residente · admin — resumen post-DATA,      │
│                        │             filtro Área tierras/ODT/ODL + copiado por área)     │
│                        ├── reporte-drenajes.html (capataz_odt · capataz_odl · admin;     │
│                        │      área de cada línea por CC 06→ODT/07→ODL; campo areas D84)  │
│                        └── residente-drenajes.html (residente_dren · residente_odt/odl   │
│                                   · admin — bandeja combinada ODT+ODL, envío x área D84) │
│  Sesión: localStorage {usuario, rol} (D82; antes sessionStorage). Credenciales hardcoded │
│  en index.html.                                                                          │
│  Admin: botón "← Menú" en toda pantalla interna vuelve a menu.html sin cerrar sesión.    │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘

**Offline (D82, backlog 2.8/2.8b/2.9):** archivos nuevos `offline.js` (cola localStorage `tm2_cola_envios` + sync FIFO + caché-fallback de catálogos + chip/panel de estado), `sw.js` (service worker network-first, precache del shell + capturas; NUNCA intercepta Apps Script; fuentes Google cache-first; subir `CACHE_V` solo si cambia la lista de precache), `manifest.json`, `icons/` (192/512/180) y `OFFLINE_README.md` (instalación + checklist de pruebas). Flujo de envío de las 4 capturas (capataz, chequeadora, drenajes, asistencia) con rama offline: intento directo (timeout ~15 s) → si no hay red, encola y muestra confirmación NARANJA (distinta del verde de servidor); al volver la señal la cola sube en orden y `Codigo.gs` deduplica por `id_registro` UUID de cliente (asistencia no lo necesita: upsert fecha+cuadrilla idempotente). Encargado/residente/jefe/resúmenes quedan FUERA del offline (D49): sin señal muestran "Esta pantalla necesita conexión".
                                     │ fetch GET/POST (Content-Type: text/plain)
                                     ▼
┌──────────────────── GOOGLE APPS SCRIPT v6 (API, una sola URL) ──────────────────────────┐
│  GET  ?action=bandeja&fecha=…[&proyecto=…][&area=…] → crudo del día por área (D70)      │
│  GET  ?action=consolidado&fecha=…            → lo ya enviado a DATA                     │
│  GET  ?action=consolidado&desde=…&hasta=…    → filas A–T de DATA + climaPorDia (D65/D37)│
│  GET  ?action=estado&fecha=…                 → máquinas reportadas (estado.html)        │
│  GET  ?action=debug&fecha=…                  → diagnóstico                              │
│  GET  ?action=cubicaje                        → mapa placa→cubicaje (frontend, D53/2.10) │
│  GET  ?action=volquetas&fecha=…               → filas VOLQUETAS del día (digitadora, D83) │
│  GET  ?action=maquinaria_produccion&fecha=…  → frentes×oficial DATA + PK/horas/faltantes  │
│  GET  ?action=drenajes                        → 147 marcadores ODT + ítems .06/.07 (D70)  │
│  POST {reporte}                              → escribe BANDEJA + MAQUINARIA (+VOLQUETAS)  │
│  POST {action:enviar_data, area}             → pisa DATA del día POR ÁREA + marca bandeja │
│         (tierras/odt/odl derivada del CC con deriveArea; sin area = tierras — D70)       │
│  POST {action:maquinaria_produccion}         → parcha col T + crea filas (redir/horas/compl, D60-62)│
│  Regla técnica: fechas por duck-typing (getFullYear), nunca instanceof Date.            │
│  Redespliegue: Administrar implementaciones → editar → Nueva versión (misma URL).       │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     ▼
┌──────────────────────────── GOOGLE SHEETS (almacenamiento) ─────────────────────────────┐
│  BANDEJA     crudo con estado (pendiente/incluido/descartado/no_data) · 28 cols          │
│              +`origen` (col 23): banco de material de la chequeadora para excavación     │
│              aprovechable (Masivo 1/2/Complementario/Otro); vacío capataz/enc (D56)      │
│              +`area` (col 24, ''=tierras) y SOLO-WhatsApp `personal_oficiales` ·         │
│              `personal_ayudantes` · `turno_noche` · `nota_libre` (cols 25–28, D70)       │
│  MAQUINARIA  equipos con producción individual (directo, sin aprobación); interno `area` │
│              tras produccion_capataz_orig — drenajes = captura libre, a_captura=NO (D70) │
│  VOLQUETAS   desglose por placa de la chequeadora (1 fila/placa, informativo; no a DATA) │
│  CUBICAJE    catálogo placa→cubicaje (lo lee el backend; lo mantiene el usuario; D53/2.10)│
│  DATA        oficial; A–T = espejo del maestro TM2; internas U+ (…area, clima D37)      │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     │ copy-paste manual por bloques
                                     ▼
┌──────────────────────────── EXCEL MAESTROS (fuera del app) ─────────────────────────────┐
│  TM2_SUR_REPORTE_DIARIO_OBRA.xlsx   ← DATA (A:S del día)                                │
│    └─ hoja DATA alimenta DATOS/TABLAS/GRAFICOS e informes                               │
│  Modelo_Produccion_Maquinaria_v2.xlsx ← MAQUINARIA (mapeada a Captura_Diaria)           │
│    ├─ Captura_Diaria (fact_produccion): fórmulas propias de KPI                         │
│    ├─ dim: catálogo de máquinas (horas prog 5/6.4 por proveedor)                        │
│    └─ RESUMEN_MES: matriz período 16–15, generada por este proyecto                     │
└─────────────────────────────────────────────────────────────────────────────────────--─┘
```

## Flujo de captura (diario)

1. **Capataz** entra → agrega N actividades. Por actividad: actividad específica → (sistema muestra ítem contractual, unidad, UF, CC) → PK → producción (campo adaptativo) → equipos (máquina, operador, horas; motivo si faltan horas) → observación.
2. **Chequeadora** entra → fecha, origen → N líneas {PK destino, tipo destino (Terraplén·Puente·ODL·ODT·Botadero), bloque de placas} + maquinaria (excavadoras del origen). Pega el desglose por placa estilo WhatsApp; el sistema parsea placa+viajes, calcula el **volumen real de la línea = Σ(viajes×cubicaje)** leyendo la hoja CUBICAJE (D53 sobre D06). Placa no registrada → fallback **14 fijo** (D54) + flag (naranja + `cubicaje_origen`=default). Cada placa se guarda en VOLQUETAS con su cubicaje y m3_placa. **Excavación = por ORIGEN, acumulada (D63):** la excavación se registra DONDE SE HIZO EL CORTE = el origen, así que el reporte genera **UNA sola fila de excavación = Σ(volúmenes de todas las líneas)** al PK del origen (Masivo 2→19+800, Masivo 1→14+400, Diviso→21+500, todos ≤30→UF1/3701; Complementario/Otro→el PK que teclea la chequeadora), del que derivan PK/ELEMENTO/ABS/UF/PROYECTO/CC. El **terraplén NO cambia**: 1 fila por línea con destino=Terraplén, al PK de DESTINO. No aprovechable acumulada sigue disparando ZODME (D17). Las excavadoras reportadas van a MAQUINARIA con producción = total excavado del día **repartido en partes iguales** entre ellas (D54; el encargado reconcilia duplicados con el capataz, D51).
3. Ambos envían → BANDEJA (+ MAQUINARIA). Confirmación real del servidor (cuenta de filas guardadas).

## Flujo de captura — DRENAJES (D70 / D84)

1. **Capataz de drenajes** entra a `reporte-drenajes.html`. Con una sola área (`capataz_odt`/
   `capataz_odl`, sin campo `areas`) el formulario se comporta igual que hoy. **D84: con el campo
   opcional `areas` en el login (`['odt','odl']`) el desplegable ofrece todos los ítems `.06.*` y
   `.07.*` en una lista y el ÁREA DE CADA LÍNEA se deriva del CC del ítem** (06→ODT pide el
   **marcador de obra**, 147 puntuales `ODT*` de `?action=drenajes`; 07→ODL pide **PK** inicial/final
   o un marcador ODT si es descole). Por línea: **cantidad directa** en la unidad contractual +
   opcional {oficiales, ayudantes, turno de noche, nota libre} + opcional máquinas (texto libre). El
   resumen en vivo agrupa por área.
2. Envía a BANDEJA (+ MAQUINARIA con `a_captura=NO`) con confirmación real (D30). El área queda en
   la col `area` de BANDEJA (derivada del CC, por línea). Dos flujos válidos sin código extra (D84):
   mezclar ODT+ODL en un envío, o dos envíos el mismo día (BANDEJA acumula, D02).
3. **Residente de drenajes** revisa en `residente-drenajes.html`. Con una sola área (`residente_odt`/
   `residente_odl`) es como hoy (bandeja filtrada `&area=`). **D84: el residente unificado
   `residente_dren` ve ODT+ODL JUNTOS** — la bandeja se consulta una vez por área y se fusiona en
   cliente (chips de filtro Todas/ODT/ODL, badge de área por línea, totales separados por área) →
   **Enviar a DATA** dispara **una llamada `enviar_data` por área presente** (secuencial, con guard
   anti-borrado: un área sin filas en la bandeja de ese día NO se llama; pisa el día SOLO en cada
   área, D70/D03) → **Generar WhatsApp** (un mensaje con dos secciones, o uno por área, toggle
   recordado en localStorage).
4. `buildDataRowDrenajes` arma la fila: GRUPO "DRENAJES Y ESTRUCTURAS", CAPITULO DRENAJE
   TRANSVERSAL/LONGITUDINAL, ELEMENTO = marcador (ODT) o tramo `"tm2 pk X - Y"` (ODL), ABS del
   marcador/tramo verbatim (K/L), UF/proyecto/CC por D04+D63, DESCRIPCION verbatim (D68).

## Flujo de consolidación (diario, encargado)

1. Consulta fecha → ve: quién reportó / quién falta (capataces y máquinas), totales en vivo, bandeja agrupada por categoría con chip de fuente (rol·usuario).
2. Reconcilia: apaga duplicados (ej. terraplén estimado del capataz vs chequeadora), edita producciones, agrega líneas (directo o vía formulario capataz), anota inoperativos.
3. **Enviar a DATA** (pisa el día **solo en el área tierras**, D70) → **Generar WhatsApp** (copia al portapapeles).
4. Al pisar el día, `buildDataRow` deriva UF/PROYECTO/CC del PK (D04/D63) y, en filas con **match a la hoja BASE**, copia **verbatim** el ELEMENTO (celda J), ABS INICIAL/FINAL (K/L del elemento/subtramo, no del PK reportado) y la DESCRIPCION (tabla de ítems A–H, cruce por CC) — D68; sin match, ELEMENTO/ABS derivan del PK (`buildElemento`, D63). El PK reportado queda en las internas U–AA.

## Flujo de consulta

- estado.html: máquinas reportadas vs faltantes por fecha.
- encargado.html: consolidado y estado de reportes.
- jefe.html (jefe/residente/admin): consulta post-DATA **por rango de fechas** (solo lectura). Resumen por actividad y ubicación (PK crudo + UF, sumando LARGO por unidad), filtro de **Área** (Tierras/ODT/ODL/Todas — derivada del CC en cliente con el espejo de `deriveArea`, D70; el esquema A–T no cambia) y copiado A:S día a día al portapapeles, **por área o día completo**, para pegar en el maestro (D65). No escribe nada.
- Excel maestros: análisis, KPI y resúmenes mensuales (RESUMEN_MES con B2=período, B3=proyecto/0).
- digitadora.html (rol `digitadora`, admin vía menu.html + "← Menú"): **solo lectura** de VOLQUETAS por fecha (`?action=volquetas`), explota los viajes y pre-llena la BASE de transporte (`TERRAPLEN.xlsx`/`BASE 2026`) para pegar con **Omitir blancos** (export A→AH; H/M/V/W/AB–AH quedan vacías por ser fórmula). PK destino real editable por viaje; toggle explotar/agrupado (ORTIZ/internos); viajes externos a mano; **sin persistencia** (Opción A, D83). No escribe nada ni entra a DATA/BANDEJA/MAQUINARIA. Offline fuera de alcance (D49/D82).

## Módulo Asistencias (D69) — aislado, Sheet/Script propios

```
┌── GITHUB PAGES (mismo repo, mismo login index.html) ──────────────────┐
│  seleccion-reporte.html (capataces/mairy/jeisson: tiles según usuario) │
│  asistencia.html         (responsable de cuadrilla + admin)           │
│  resumen-asistencia.html (residente, admin, jeisson)                  │
│  mis-extras.html         (SOLO admin: canal "solo extras", D73)       │
└────────────────────────┬────────────────────────────────────────────--┘
                          │ fetch GET/POST (text/plain), URL PROPIA
                          ▼
┌── backend/CodigoAsistencias.gs (Apps Script NUEVO, SHEET_ID propio) ───┐
│  GET  ?action=roster&usuario=…     → cuadrillas + roster + CONFIG      │
│                                       + CAT_CC + motivos frecuentes    │
│                                       (MOTIVOS_USADOS, D78) + recientes│
│  GET  ?action=asistencia&fecha=…   → filas del día + estado cuadrilla  │
│                                       + faltantes (con responsable)    │
│  GET  ?action=personal             → PERSONAL + CUADRILLAS (gestión)  │
│  GET  ?action=export&fecha=…       → crudo del día + catálogos        │
│                                       (el cliente arma el Excel)       │
│  POST {reporte_asistencia,…}       → pisa fecha+cuadrilla, escritura   │
│                                       DIRECTA (sin bandeja, D03)       │
│  POST {personal, op, usuario,…}    → valida usuario ∈{residente,admin}│
│  GET  ?action=extras_admin&fecha=… → registro EXTRAS_ADMIN del día(D73)│
│  POST {extras_admin, fecha,cc,…}   → upsert por fecha (proyecto del CC) │
│  POST {extras_admin_delete, fecha} → borra la fila del día             │
└────────────────────────┬────────────────────────────────────────────--┘
                          ▼
┌── GOOGLE SHEET NUEVO (1KrhzaIg3BSspyi0oH0gHkAJnSRXaOIdel_pKaMVHX9w) ───┐
│  PERSONAL · CUADRILLAS · ASISTENCIA · CONFIG · FESTIVOS ·              │
│  CAT_TRABAJADORES · CAT_CC · CAT_MOTIVOS (catálogo completo, D78) ·    │
│  MOTIVOS_USADOS (frecuentes, D78) · EXTRAS_ADMIN (D73) —               │
│  setupHojas() de un solo uso                                          │
└────────────────────────┬────────────────────────────────────────────--┘
                          │ SheetJS en el navegador (resumen-asistencia.html)
                          ▼
┌── Plantilla_Parte_Trabajo…xlsx (subida por el usuario, una vez/sesión) ┐
│  El generador llena SOLO la hoja "Parte" (18 columnas A–R) y conserva  │
│  las demás hojas/catálogos intactos → Parte_{proyecto}_{fecha}.xlsx    │
└─────────────────────────────────────────────────────────────────────--┘
```

Reglas clave: captura CRUDA de hora entrada/salida; la clasificación (ordinarias/extras diurna-nocturna/
Dom-Fest) la hace el **clasificador de horas** (módulo JS compartido embebido en `resumen-asistencia.html`,
con casos de prueba manual en comentario) **al exportar**, nunca al guardar. El **estándar de ordinarias
es el del TURNO reportado** (catálogo TURNOS, D72e/D77): las extras empiezan al pasar la salida del turno,
la ventana nocturna va de `CONFIG.nocturno_desde` (19:00) a `CONFIG.nocturno_hasta` (06:00) — lo que una
extra pase de las 06:00 es extra DIURNA —, en sábado un turno sin variante sabatina usa su horario de
semana, y domingo/festivo tiene horario típico 07:00–15:00 (7h a col D, tope `domfest_tope`). Códigos sin
catálogo pasan sin bloqueo (`codigo| NOMBRE`). Retiros = `inactivo` + `fecha_retiro`, nunca se borra una
fila. **Áreas (D72/D84):** CUADRILLAS lleva col `area` (`tierras`/`odt`/`odl`) y col **`estado`**
(`activa`/`inactiva`, vacío=activa: inactivar sin borrar; filtra roster/faltantes/export/selectores/
gestión, no lo ya reportado). El guard de área es `areasDeUsuario()` → **array** (residente/jeisson=
`['tierras']`, residente_odt/odl=`['odt']`/`['odl']`, **residente_dren=`['odt','odl']`** con export
Navision combinado, admin=`[]` sin filtro); los filtros usan `includes`. Columnas H–N (Dom/Fest c/s
compensación) y el string de `CONFIG.proyecto_3702` son parámetros abiertos (ver 03_BACKLOG). Este módulo
**nunca** lee ni escribe BANDEJA/DATA/MAQUINARIA ni comparte Sheet/Script con `Codigo.gs`.

**Canal "solo extras" del admin (D73):** hoja **`EXTRAS_ADMIN`** (`fecha·cc·proyecto·horas·tipo·timestamp·reporta`,
clave lógica = `fecha`, re-guardar pisa el día, sin staging) aislada del roster — el admin NO está en
PERSONAL/CUADRILLAS/ASISTENCIA y no aparece en el `Parte` salvo los días con extra. `mis-extras.html` (solo
admin) hace el upsert/borrado; el generador de `resumen-asistencia.html` (`buildAdminExtraRow`) inyecta su
fila al `Parte` del día×proyecto con `Ausente=No`. Día normal: **solo la extra, sin ordinarias** (confirmado
con Navision) — todas las horas en 0 salvo la columna del tipo (E diurna / F nocturna), tope 2h. Domingo/
festivo: las horas van a **D ordinarias dom/fest** (no a extras), tope 7h (`MAX_HORAS_EXTRA`/`MAX_HORAS_DOMFEST`).
CONFIG gana `admin_recurso` (No. Recurso Navision, parámetro abierto: vacío ⇒ no se agrega la fila y avisa)
y hay un flag `EXTRAS_ORDINARIAS_EN_CERO` (en el HTML) por si un import rechaza el 0 en las ordinarias.

## Mapeo de paste MAQUINARIA → Captura_Diaria (D52, verificado con el archivo real)

Captura_Diaria es una **tabla de Excel** (`fact_produccion`, A1:AA). Se pegan SOLO las columnas de entrada con **Pegado especial → Omitir blancos**; la tabla autocompleta las columnas-fórmula.

- **Columnas de entrada (se pegan):** B id_fecha · D id_proyecto · E id_maquina · G operador · H actividad · I SUB ACTIVIDAD · L Horas Operación · O Horas Mantenimiento · R ESTADO · T Producción · AA Observaciones.
- **Columnas-fórmula (NO se tocan, van en blanco):** A id_registro (`=ROW()-ROW(fact_produccion[#Headers])`, autonumera) · C dia · F Tipo Equipo · J Unidad · K Horas Programadas (VLOOKUP a `dim`) · M %util · N Horas Muertas (prog−oper) · P %muerto · Q Horas Facturadas · U Meta · V %ef · W rendimiento · X unitario · Z Costo.
- **En blanco aunque sean editables:** S CLIMA (pospuesto, D37) · Y Viajes (no aplica a maquinaria).
- **Derivaciones del app:** H/I desde la actividad del capataz (05_CATALOGO §1) · R ESTADO desde el motivo (05_CATALOGO §5) · O = prog−oper solo si motivo=Mantenimiento · T en blanco para vibros y actividades de apoyo (D41/D44).
- La hoja MAQUINARIA del Sheets se reordena a este layout A→AA; los internos del app (id_registro, timestamp, reporta, motivo, unidad_prod, etc.) quedan **después de AA** para trazabilidad.
- El panel de producción (2.4/D59-D60) añade un interno más tras AA, `produccion_capataz_orig`, donde guarda el estimado geométrico del capataz (col T original) la primera vez que sustituye la producción por el volumen oficial. El panel parcha la col T (Producción) de filas existentes y, para redirigir producción huérfana (ZODME, no aprovechable), **crea filas nuevas** en MAQUINARIA con el layout A→AA + internos (D52); nunca toca DATA ni BANDEJA.

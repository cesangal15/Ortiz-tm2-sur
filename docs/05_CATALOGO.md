# CATÁLOGO CONSOLIDADO — TM2 Sur

## 1. Actividades (formulario capataz) — CONFIRMADO

Formato: actividad de campo → ítem contractual | unidad | CC | medición | ¿DATA?

### Excavación
- Excavación aprovechable (masivo) → Excavaciones en material común APROVECHABLE | m3 | 02.05 | m³ directo | Sí
- Excavación no aprovechable → Excavaciones en material común NO APROVECHABLE | m3 | 02.05 | m³ directo | Sí (+ZODME auto)
- Excavación de préstamo (Diviso) → Excavación en material común de préstamos | m3 | 02.06 | m³ directo | Sí

### Terraplén
- Núcleo de terraplén → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- Corona de terraplén → Terraplenes (solo conformación) | m3 | 02.07 | m³ directo | Sí
- Cereo de corona → (sin ítem) | m2 | — | (PKf−PKi)×11.5 | **No** (no_data)

### Conformación / Pedraplén
- Conformación y disposición de sobrantes (ZODME) → ídem | m3 | 02.08 | m³ | Sí (también auto)
- Pedraplén compacto → ídem | m3 | 02.07 | m³ directo | Sí

### Subbase / Base
- Conformación de subbase → Subbase Granular | m3 | 03.01 | m³ directo | Sí
- Cereo de subbase → (sin ítem) | m2 | — | (PKf−PKi)×11.5 | **No** (no_data)
- Base estabilizada con cemento (BTC) → Base granular estabilizada con cemento | m3 | 03.03 | m³ directo | Sí

### Pavimentos (D71)
- Riego de imprimación con emulsión asfáltica → ídem | m2 | 04.01 | m² directo | Sí. GRUPO **PAVIMENTOS**, CAPÍTULO **PAVIMENTOS ASFALTICOS** (así lo tiene la BASE; `grupoFromCc`/`capFromCc` mapean `04.*`). Rama de tierras normal (deriveArea=tierras). Único ítem de pavimentos ofrecido en V1 (acota el "excluye pavimentos" del alcance).

### Desmonte
- Desmonte y limpieza en bosque → ídem | captura m² → DATA en Ha (÷10 000) | 02.01 | + genera no aprovechable (02.05, m²×espesor) → ZODME (02.08) | Sí. Máquina: producción en m².
- Descapote / zonas no boscosas → Desmonte y limpieza en zonas no boscosas | captura m² → DATA en Ha (÷10 000) | 02.03 | + genera no aprovechable (02.05, m²×espesor) → ZODME (02.08) | Sí. Máquina: producción en m³ (m²×espesor).

(Nota: espesor editable, default 0.2. La máquina del frente se atribuye a DOS filas de MAQUINARIA —la contractual con producción m²/m³ y la no aprovechable con producción m³— repartiendo las horas operadas por igual; la ZODME no lleva máquina. D58.)

### Estructuras / MSR
- Relleno para muros de tierra MSR | M3 | 05.04 | directo | Sí
- Material granular drenante MSR | M3 | 05.05 | directo | Sí
- Geobolsas / costales (propybag) | UND | 05.11 | directo | Sí
- Geomalla uniaxial 115 kn/m (método md) | M2 | 05.07 | directo | Sí
- Geomalla uniaxial 55 kn/m (método md) | M2 | 05.06 | directo | Sí
- Geotextil tejido 2890 n (método grab md) | M2 | 05.09 | directo | Sí
- Geotextil tejido 1480 n (método grab md) | M2 | 05.08 | directo | Sí
- Geodrén planar h=1 m | M | 05.10 | directo | Sí
- Geodrén planar h=0,5 m | M | 05.02 | directo | Sí
- Tubería PVC 4" perforada | M | 05.03 | directo | Sí

### Actividades de apoyo (sin producción) — CONFIRMADO
Aplican a excavadoras, motoniveladoras, bulldozer. Estado `no_data`; no van a DATA; sí a MAQUINARIA con producción nula.
- Compactación de terraplén
- Compactación de subbase
- Compactación de BTC
- Paisajeo / ornato
- Adecuación de caminos
- Limpieza de derrumbe

### Mapeo a actividad/subactividad del modelo de maquinaria (Captura_Diaria)
02.03→DESMONTE/DESCAPOTE · 02.05→EXCAVACION COMUN/(NO)APROVECHABLE · 02.06→EXCAVACION PRESTAMO · 02.07→TERRAPLEN/NUCLEO-CORONA-CEREO · 02.08→CONFORMACION/ZODME · 03.01→SUBBASE · 03.03→BASE BTC · 05.04 y 02.12→TERRAPLEN(MSR) · APOYO→APOYO/PAISAJEO, APOYO/ADECUACION, APOYO/DERRUMBE.

**Mapeo explícito actividad del capataz → actividad(H) / SUB ACTIVIDAD(I) de Captura_Diaria** (verificado con datos reales, D52):
- Excavación aprovechable (masivo) → EXCAVACION COMUN / EXCAVACION APROVECHABLE
- Excavación no aprovechable → EXCAVACION COMUN / EXCAVACION NO APROVECHABLE
- Excavación de préstamo (Diviso) → EXCAVACION PRESTAMO / EXCAVACION APROVECHABLE
- Núcleo de terraplén → TERRAPLEN / NUCLEO DE TERRAPLEN
- Corona de terraplén → TERRAPLEN / CORONA DE TERRAPLEN
- Cereo de corona → TERRAPLEN / CEREO CORONA
- Conformación y disposición de sobrantes (ZODME) → CONFORMACION / ZODME
- Conformación de subbase → SUBBASE / CONFORMACION SUBBASE
- Cereo de subbase → SUBBASE / CEREO SUBBASE
- Base estabilizada con cemento (BTC) → BASE / BTC
- Desmonte y limpieza en bosque → DESMONTE / DESMONTE
- Descapote / zonas no boscosas → DESMONTE / DESCAPOTE

Máquina de **apoyo** (vibro/compactación sobre un frente): hereda el H/I del frente que apoya, producción en blanco. **No pasan a Captura** (sin par definido): paisajeo, adecuación de caminos, limpieza de derrumbe, materiales MSR y pedraplén.

### Drenajes ODT / ODL (D70) — catálogo VIVO en la BASE, servido por `?action=drenajes`
Las actividades de drenajes NO se listan aquí ni viven hardcodeadas en el frontend: son **TODOS los
ítems `.06.*` (ODT — DRENAJE TRANSVERSAL) y `.07.*` (ODL — DRENAJE LONGITUDINAL)** de la tabla de
ítems de la hoja BASE, por proyecto (3701/3702), incluidos los ~20 "box abovedados" aunque no se
usen. El backend los sirve con el endpoint `?action=drenajes` junto con los **147 marcadores de obra
`ODT1-…/ODT2-…/ODT3-…`** (tabla de elementos J/K/L, abscisa puntual) y los frontends arman el
dropdown deduplicando por CC corto (el CC final = proyecto derivado del PK/marcador + código corto).
Reglas:
- **Cantidades directas** en la unidad contractual del ítem (sin conversiones ml→m³/und→m: V2).
- DESCRIPCION **verbatim de la celda** de la BASE — con el typo real `"Excavaciones varias sin
  clasicar"` y el sufijo `" ODL"` en los ítems de longitudinal. NO corregirlos (pivotes del maestro).
- **ODT**: el ELEMENTO es el marcador de obra; ABS INI/FIN = abscisa puntual del marcador (K/L).
- **ODL**: el ELEMENTO es el tramo `"tm2 pk X - Y"` por abscisa (como tierras); opcionalmente un
  marcador ODT si se trabaja el descole de una ODT.
- Sin ZODME, sin no-aprovechable, sin chequeadora, sin actividades derivadas.
- Campos por línea SOLO-WhatsApp (no van a DATA): oficiales, ayudantes, turno de noche, nota libre.
- Máquinas de drenajes: **texto libre** (id/placa + operador + horas opcionales), sin catálogo;
  `a_captura=NO` siempre (no pasan a Captura_Diaria).

**Ítems "extra" de drenajes (D71) — CC que NO deriva el área por sí solo.** Config `EXTRA_DREN` en
`Codigo.gs` (CC corto → { áreas ofrecidas, capítulo verbatim }). Se sirven en `?action=drenajes` para
cada área listada (desc/unidad verbatim de la BASE) y el **área real de la línea la fija el reporte
(columna `area`), no el CC** — por eso `buildDataRow`/ingesta/`enviar_data` usan `areaDeFila(c.area,cc)`.
DATA lleva una columna interna `area` para pisar por día+área sin confundirlos con tierras.
- **Demolición de Estructuras** → GRUPO `DRENAJES Y ESTRUCTURAS`, CAPÍTULO `DEMOLICIONES Y
  REUBICACIONES`, CC corto `01.02`, unidad **m³** | ofrecida en **ambas** áreas (ODT y ODL).

## 2. Orígenes de material (chequeadora) — CONFIRMADO
- Masivo 2 (PK 19) → excavación aprovechable
- Masivo 1 (PK 14) → excavación aprovechable
- Diviso / Préstamo → excavación de préstamo
- PK Complementario (texto libre) → aprovechable
- Otro origen (texto libre) → aprovechable

Notas cerradas: Crudo de Río y Fresado = materiales, no orígenes. Botadero/RCD = destino, no origen.

## 3. Tipos de destino (chequeadora) — CONFIRMADO
Terraplén (genera fila de terraplén) · Puente · ODL · Botadero (solo excavación).

## 4. Máquinas — CONFIRMADO en app

| ID | Tipo | Hrs prog | Proveedor |
|---|---|---|---|
| BL005, BL009 | BULLDOZER | 6.4 | Propias |
| NH69 | BULLDOZER | 5 | Alquilada |
| EXC001, EXC013, EXC014, EXC015 | EXCAVADORA | 6.4 | Propias |
| MO03, MO04, MO09 | MOTONIVELADORA | 6.4 | Propias |
| FNG02 | FINISHER | 6.4 | Propia |
| CR019, CR013, CR016 | VIBROCOMPACTADOR | 6.4 | ORTIZ (propios) |
| CS78B | VIBROCOMPACTADOR | 5 | GEOEXCON (alquilada) |
| NH403, NH404, NH420 | VIBROCOMPACTADOR | 5 | DINISSAN (alquilados) |
| CAT900 | VIBROCOMPACTADOR | 5 | SK RENTAL (alquilada) |
| NH421 | MINICARGADOR | 5 | DINISSAN (alquilada) |
| CR026 | MINIBULDOZER | 6.4 | ORTIZ (propia) |

**Retiradas de la obra (jun-2026, D61):** CAT320 (excavadora alquilada) y MC705 (motoniveladora alquilada). Ya no aparecen en los desplegables de capataz/chequeadora, ni en el panel de producción, ni en el estado de máquinas faltantes.

**Regla de producción por tipo:**
- VIBROCOMPACTADOR: producción siempre nula — compactan frentes ejecutados por otras máquinas; el campo producción no se muestra ni se guarda.
- MINICARGADOR y MINIBULDOZER (NH421, CR026): producción siempre nula — mismo tratamiento que los vibrocompactadores en cuanto al campo `produccion`.
- Actividades de apoyo (Compactación terraplén/subbase/BTC · Paisajeo / Adecuación de caminos / Limpieza de derrumbe): producción nula para cualquier tipo de máquina.
- Todos los demás tipos + actividades productivas: producción = largo de la línea de la actividad.

CC habituales por máquina (de reportes Abr–May): BL→02.07/02.08 · EXC→02.05/02.06/02.03 · MO→02.07/03.01/03.03 · CR013→02.07-UF2/03.01 · CR016→02.07/03.01 · CR019→02.07-UF1 · FNG02→03.03.

**PENDIENTE DE VALIDAR:** marca/modelo/valor-hora reales de vibros nuevos en dim; bulldozer alquilado D150B y motoniveladora 120 alquilada (IDs pendientes).

## 5. Motivos / Estados — CONFIRMADO
Motivos (dropdown, 10): Mantenimiento · Sin operador · Falla mecánica · Lluvia/clima · Sin frente de trabajo · Esperando material · Abastecimiento de combustible · Traslado/movilización · **Bloqueo** · Otro (especificar).
Estados reales en Captura_Diaria (9): OPERANDO · LLUVIAS · NO PROGRAMADO · MEDIA JORNADA · ESPERA · VARADO · MANTENIMIENTO · SIN OPERADOR · BLOQUEO.

**Mapeo motivo → ESTADO** (lo genera el app en la fila de MAQUINARIA, D52):
- (sin horas muertas) → OPERANDO
- Mantenimiento → MANTENIMIENTO
- Falla mecánica → VARADO
- Sin operador → SIN OPERADOR
- Lluvia/clima → LLUVIAS
- Sin frente de trabajo · Esperando material · Abastecimiento de combustible · Traslado/movilización · Otro → ESPERA
- Bloqueo → BLOQUEO

MEDIA JORNADA y NO PROGRAMADO **no salen del app**; son ajuste manual del encargado en Captura (D52).

**Máquina con 0 horas operadas:** el capataz NO la reporta. El encargado la registra como inoperativo en texto libre desde su panel (D28); entra al WhatsApp, no a MAQUINARIA.

## 6. Tipos de reporte / fuentes — CONFIRMADO
| Fuente | Aporta | Dueño del número |
|---|---|---|
| Chequeadora (web) | viajes×PK destino por origen | Volumen excavación + terraplén |
| Capataz (web) | actividades, producción medida (subbase/BTC/MSR/desmonte), equipos+horas | Subbase, base, MSR, desmonte; equipos |
| Encargado (web) | reconciliación, líneas faltantes, inoperativos | Versión oficial (DATA) |
| Chequeadora Diviso (foto, externa) | viajes del diviso | Préstamo — sin digitalizar (V3) |

## 7. Usuarios — CONFIRMADO (contraseñas de encargado/chequeadoras = placeholder)
admin/venganza753 → menu · encargado/enc1-2 → encargado · residente/Ortiz2026 → residente · jefe/Ortiz2026 → jefe · capataz1-5/uf1-2 → reporte-capataz · chequeadora1-3/cheq1-2 → reporte-chequeadora.
**Residente** (rol `residente`, D57): entra a `residente.html` (panel de selección) → tile activo al Panel del Encargado (guard de `encargado.html` extendido para aceptar el rol) y tile **Resumen General** que ahora abre `jefe.html` (D65).
**Jefe** (rol `jefe`, D65): usuario `jefe`, clave `Ortiz2026` (placeholder); entra a `jefe.html` — consulta post-DATA por rango de fechas (solo lectura): resumen por actividad + ubicación (PK crudo) y copiado A:S día a día, ahora con filtro de **Área** (Tierras/ODT/ODL/Todas, derivada del CC en cliente, D70). Guard acepta `jefe`/`admin`/`residente`. **Admin:** botón "← Menú" en toda pantalla interna vuelve a `menu.html` sin cerrar sesión.
**Drenajes (D70/D84, claves placeholder):** capataces NOMINALES por área (usuario propio → trazabilidad en `reporta`, como los de tierras; el **rol** `capataz_odt`/`capataz_odl` activa el modo por defecto, clave común `dren2026`): **ODT** = `mauricio`, `eduardo`, `enrique`; **ODL** = `jairo`. Todos → `reporte-drenajes.html`. **D84:** el área de CADA línea se deriva del CC del ítem (06→ODT, 07→ODL); con el campo opcional `areas` en el login (`['odt','odl']`) un capataz reporta los dos capítulos en una sola lista (sin el campo se comporta igual que hoy). **Residente de drenajes unificado `residente_dren`** (clave `Ortiz2026`, rol `residente_dren` → `['odt','odl']`) → `residente-drenajes.html` con bandeja **combinada** ODT+ODL (una llamada `enviar_data` por área, con guard anti-borrado; WhatsApp con toggle un-mensaje/uno-por-área). `residente_odt` salió a UF3 (login eliminado); `residente_odl` queda de respaldo de una sola área; ambos roles se conservan por retrocompatibilidad. El admin entra a ambas pantallas desde `menu.html`. La lista "capataces esperados" del panel (`CAPATACES_ESPERADOS_POR_AREA`) usa estos nombres y **no cambia** con D84 (cada capataz sigue esperado solo en su área primaria).

**Módulo Asistencias (D69) — usuarios y mapa cuadrilla→responsable.** `jeisson` (clave `Ortiz2026` placeholder, rol `asistencia_plus`): entra a `seleccion-reporte.html` con tiles "Asistencia de mi grupo" y "Resumen de asistencias" (sin reporte de obra, sin gestión de personal). Capataces de tierras (`angel/alejo/robinson`) y `mairy` conservan su usuario/clave/rol de siempre pero aterrizan en `seleccion-reporte.html` (su reporte de obra + tile "Asistencia de personal"). **D84:** CUADRILLAS gana la col `estado` (`activa`/`inactiva`, vacío=activa) para sacar una cuadrilla de circulación sin borrar su fila. Semilla de la hoja CUADRILLAS (`cuadrilla·responsables·area·estado`, data-driven: se amplía sin tocar código):

| Cuadrilla | Responsable(s) (usuario del login) | Estado |
|---|---|---|
| ANGEL | angel | activa |
| ROBINSON | robinson | activa |
| ALBERT | maleja (D84: única responsable; `albert` salió a UF3, D75 doble deber) | activa |
| ARIEL | — (D84: `ariel` salió a UF3; su gente se movió a ROBINSON) | **inactiva** |
| ALEJANDRO | alejandro (alias de `alejo`, mismo capataz — ver nota abajo) | activa |
| OPERADORES | jeisson | activa |
| VOLQUETEROS | mairy | activa |

Cuadrillas de drenajes (D72, col `area` en CUADRILLAS): **EDUARDO**/`eduardo`, **MAURICIO**/`mauricio`, **ENRIQUE**/`enrique` (`area=odt`) y **JAIRO**/`jairo` (`area=odl`, 21 pers. del Parte 10-jul; capataz YONH JAIRO REYES GONZALEZ 75781 con `cargo=CAPATAZ`). Seeds TSV para pegar en el Sheet en `backend/seeds/`.

Nota: `alejo` (usuario real del login) y `alejandro` (nombre usado en la cuadrilla) son la misma persona; el backend (`cuadrillasDeUsuario` en `CodigoAsistencias.gs`) los trata como alias. Gestión de personal (alta/retiro/mover/reactivar) `residente`/`admin` y los residentes de drenajes (`residente_odt`/`residente_odl`/`residente_dren`, cada uno acotado a sus áreas; `residente_dren` puede mover personal entre cuadrillas ODT↔ODL, D84), validado también en el backend. Acceso a `resumen-asistencia.html`: `residente`, `admin`, `jeisson`, `residente_odt`/`residente_odl` y `residente_dren` (D84: export combinado ODT+ODL en un archivo).

**Canal "solo extras" del admin (D73).** Tile **"Mis horas extra"** en `menu.html` (solo admin) → `mis-extras.html` (guard `rol==='admin'`): registra las horas extras del admin de días puntuales (máx 2h/día) en la hoja `EXTRAS_ADMIN`, aislada del roster. Nuevo parámetro de la hoja **CONFIG**: **`admin_recurso`** = «No. Recurso» del admin en Navision, string exacto formato `código| NOMBRE` (seed `77463| CESAR AUGUSTO GALVIS SANDINO`, valor del dueño — debe coincidir carácter por carácter con el listado de Trabajadores de Navision; si queda vacío el generador NO agrega la fila del admin y avisa). Flag `EXTRAS_ORDINARIAS_EN_CERO` (en `resumen-asistencia.html`, default `true`): conmutar a `false` si un import real rechaza el `0` en las columnas de horas no usadas con `Ausente=No` (escribe celda vacía; las ordinarias siempre llevan su valor). **CC por defecto del admin** (constante `DEFAULT_CC` en `mis-extras.html`): `3701.I010303| JEFES DE ÁREA DE PRODUCCIÓN Y RESIDENTES` (sobrecosto, cuenta única); el prefijo de proyecto puede variar (3701↔3702) → ambas variantes se inyectan al desplegable y se preselecciona el último usado (o el default en la primera vez).

## 8. Reglas de reconciliación automática (encargado) — CONFIRMADO

- Al cargar la bandeja, las filas de **capataz** en categorías de volumen oficial
  (Excavación aprovechable, Excavación préstamo, Excavación no aprovechable,
  Conformación/ZODME, Terraplén) se **apagan automáticamente** si la chequeadora
  ya reportó esa misma categoría. Quedan marcadas "control · no suma".
  El encargado puede reactivarlas manualmente si hace falta.

- **Regla terraplén ≤ aprovechable+préstamo**: el panel muestra un aviso verde/rojo
  comparando los totales. Si terraplén > aprovechable+préstamo = probable doble
  conteo o error de volumen. Chequearlo antes de enviar a DATA.

- Las filas de chequeadora se etiquetan "oficial"; las de capataz en esas categorías
  se etiquetan "control · no suma" y tienen borde punteado.

- **Detección y conciliación de máquina duplicada (D51):** el panel agrupa la maquinaria
  del día por `id_maquina`. Una máquina es duplicado SOLO si el mismo `id_maquina` aparece
  bajo dos o más capataces (`reporta`) la misma fecha → conflicto: se muestra la versión de
  cada capataz y el encargado concilia con el toggle ✓/✕ (incluye una, descarta el resto;
  solo las versiones incluidas pasan al WhatsApp). La misma máquina por UN solo capataz en
  varias actividades/PK NUNCA es duplicado (reparto multi-actividad de D46): se muestra normal
  y sus horas muertas del día = horas_programadas − Σ horas_operadas del grupo. No se compara
  PK ni actividad; el único discriminante es `reporta`. (Sustituye la corrección por desplegable
  + endpoint `editar_maquina`, que asumía duplicado por id_maquina repetido.)

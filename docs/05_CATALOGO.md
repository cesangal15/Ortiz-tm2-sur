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

### Desmonte
- Desmonte y limpieza en bosque → ídem | Ha | 02.01 | Ha | Sí
- Descapote / zonas no boscosas → Desmonte y limpieza en zonas no boscosas | Ha | 02.03 | Ha | Sí

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
Aplican a excavadoras, motoniveladoras, bulldozer, pajarita. Estado `no_data`; no van a DATA; sí a MAQUINARIA con producción nula.
- Compactación de terraplén
- Compactación de subbase
- Compactación de BTC
- Paisajeo / ornato
- Adecuación de caminos
- Limpieza de derrumbe

### Mapeo a actividad/subactividad del modelo de maquinaria (Captura_Diaria)
02.03→DESMONTE/DESCAPOTE · 02.05→EXCAVACION COMUN/(NO)APROVECHABLE · 02.06→EXCAVACION PRESTAMO · 02.07→TERRAPLEN/NUCLEO-CORONA-CEREO · 02.08→CONFORMACION/ZODME · 03.01→SUBBASE · 03.03→BASE BTC · 05.04 y 02.12→TERRAPLEN(MSR) · APOYO→APOYO/PAISAJEO, APOYO/ADECUACION, APOYO/DERRUMBE.

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
| CAT320 | EXCAVADORA | 5 | Alquilada |
| MO03, MO04, MO09 | MOTONIVELADORA | 6.4 | Propias |
| MC705 | MOTONIVELADORA | 5 | Alquilada |
| FNG02 | FINISHER | 6.4 | Propia |
| PEXC027 | PAJARITA (retro de llantas) | 6.4 | Propia |
| CR019, CR013, CR016 | VIBROCOMPACTADOR | 6.4 | ORTIZ (propios) |
| CS78B | VIBROCOMPACTADOR | 5 | GEOEXCON (alquilada) |
| NH403, NH404, NH420 | VIBROCOMPACTADOR | 5 | DINISSAN (alquilados) |
| CAT900 | VIBROCOMPACTADOR | 5 | SK RENTAL (alquilada) |

**Regla de producción por tipo:**
- VIBROCOMPACTADOR: producción siempre nula — compactan frentes ejecutados por otras máquinas; el campo producción no se muestra ni se guarda.
- Actividades de apoyo (Compactación terraplén/subbase/BTC · Paisajeo / Adecuación de caminos / Limpieza de derrumbe): producción nula para cualquier tipo de máquina.
- Todos los demás tipos + actividades productivas: producción = largo de la línea de la actividad.

CC habituales por máquina (de reportes Abr–May): BL→02.07/02.08 · EXC→02.05/02.06/02.03 · MO→02.07/03.01/03.03 · CR013→02.07-UF2/03.01 · CR016→02.07/03.01 · CR019→02.07-UF1 · FNG02→03.03.

**PENDIENTE DE VALIDAR:** marca/modelo/valor-hora reales de vibros nuevos en dim; bulldozer alquilado D150B y motoniveladora 120 alquilada (IDs pendientes).

## 5. Motivos / Estados — CONFIRMADO
Motivos (dropdown): Mantenimiento · Sin operador · Falla mecánica · Lluvia/clima · Sin frente de trabajo · Esperando material · Abastecimiento de combustible · Traslado/movilización · Otro (especificar).
Estados (Captura_Diaria): OPERANDO · MEDIA JORNADA · VARADO · SIN OPERADOR · NO PROGRAMADO · LLUVIAS · MANTENIMIENTO · ESPERA.

**Máquina con 0 horas operadas:** el capataz NO la reporta. El encargado la registra como inoperativo en texto libre desde su panel (D28); entra al WhatsApp, no a MAQUINARIA.

## 6. Tipos de reporte / fuentes — CONFIRMADO
| Fuente | Aporta | Dueño del número |
|---|---|---|
| Chequeadora (web) | viajes×PK destino por origen | Volumen excavación + terraplén |
| Capataz (web) | actividades, producción medida (subbase/BTC/MSR/desmonte), equipos+horas | Subbase, base, MSR, desmonte; equipos |
| Encargado (web) | reconciliación, líneas faltantes, inoperativos | Versión oficial (DATA) |
| Chequeadora Diviso (foto, externa) | viajes del diviso | Préstamo — sin digitalizar (V3) |

## 7. Usuarios — CONFIRMADO (contraseñas de encargado/chequeadoras = placeholder)
admin/venganza753 → menu · encargado/enc1-2 → encargado · capataz1-5/uf1-2 → reporte-capataz · chequeadora1-3/cheq1-2 → reporte-chequeadora.

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

- Corrección de máquina duplicada: el encargado elige el ID correcto de un
  desplegable con la lista de máquinas conocidas (no texto libre). Requiere
  endpoint `editar_maquina` en Apps Script desplegado.

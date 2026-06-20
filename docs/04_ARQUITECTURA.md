# ARQUITECTURA GENERAL — TM2 Sur

## Componentes

```
┌─────────────────────────── GITHUB PAGES (frontend estático) ───────────────────────────┐
│  index.html ──login──> menu.html (admin)                                                │
│                        ├── encargado.html      (encargado, admin)                       │
│                        ├── reporte-capataz.html (capataz, encargado, admin)             │
│                        ├── reporte-chequeadora.html (chequeadora, admin)                │
│                        └── estado.html          (admin)                                 │
│  Sesión: sessionStorage {usuario, rol}. Credenciales hardcoded en index.html.           │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     │ fetch GET/POST (Content-Type: text/plain)
                                     ▼
┌──────────────────── GOOGLE APPS SCRIPT v6 (API, una sola URL) ──────────────────────────┐
│  GET  ?action=bandeja&fecha=…[&proyecto=…]   → crudo del día (cantidades + máquinas)    │
│  GET  ?action=consolidado&fecha=…            → lo ya enviado a DATA                     │
│  GET  ?action=estado&fecha=…                 → máquinas reportadas (estado.html)        │
│  GET  ?action=debug&fecha=…                  → diagnóstico                              │
│  GET  ?action=cubicaje                        → mapa placa→cubicaje (frontend, D53/2.10) │
│  POST {reporte}                              → escribe BANDEJA + MAQUINARIA (+VOLQUETAS)  │
│  POST {action:enviar_data}                   → pisa DATA del día + marca bandeja        │
│  Regla técnica: fechas por duck-typing (getFullYear), nunca instanceof Date.            │
│  Redespliegue: Administrar implementaciones → editar → Nueva versión (misma URL).       │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     ▼
┌──────────────────────────── GOOGLE SHEETS (almacenamiento) ─────────────────────────────┐
│  BANDEJA     crudo con estado (pendiente/incluido/descartado/no_data) · 23 cols          │
│              +`origen` (col 23): banco de material de la chequeadora para excavación     │
│              aprovechable (Masivo 1/2/Complementario/Otro); vacío capataz/enc (D56)      │
│  MAQUINARIA  equipos con producción individual (directo, sin aprobación)                │
│  VOLQUETAS   desglose por placa de la chequeadora (1 fila/placa, informativo; no a DATA) │
│  CUBICAJE    catálogo placa→cubicaje (lo lee el backend; lo mantiene el usuario; D53/2.10)│
│  DATA        oficial; columnas A–T = espejo del maestro TM2                             │
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
2. **Chequeadora** entra → fecha, origen → N líneas {PK destino, tipo destino (Terraplén·Puente·ODL·ODT·Botadero), bloque de placas} + maquinaria (excavadoras del origen). Pega el desglose por placa estilo WhatsApp; el sistema parsea placa+viajes, calcula el **volumen real de la línea = Σ(viajes×cubicaje)** leyendo la hoja CUBICAJE, y genera las filas de excavación (+terraplén si destino=Terraplén) por ese volumen (D53 sobre D06). Placa no registrada → fallback **14 fijo** (D54) + flag (naranja + `cubicaje_origen`=default). Cada placa se guarda en VOLQUETAS con su cubicaje y m3_placa. Las excavadoras reportadas van a MAQUINARIA con producción = total excavado del día **repartido en partes iguales** entre ellas (D54; el encargado reconcilia duplicados con el capataz, D51).
3. Ambos envían → BANDEJA (+ MAQUINARIA). Confirmación real del servidor (cuenta de filas guardadas).

## Flujo de consolidación (diario, encargado)

1. Consulta fecha → ve: quién reportó / quién falta (capataces y máquinas), totales en vivo, bandeja agrupada por categoría con chip de fuente (rol·usuario).
2. Reconcilia: apaga duplicados (ej. terraplén estimado del capataz vs chequeadora), edita producciones, agrega líneas (directo o vía formulario capataz), anota inoperativos.
3. **Enviar a DATA** (pisa el día) → **Generar WhatsApp** (copia al portapapeles).

## Flujo de consulta

- estado.html: máquinas reportadas vs faltantes por fecha.
- encargado.html: consolidado y estado de reportes.
- Excel maestros: análisis, KPI y resúmenes mensuales (RESUMEN_MES con B2=período, B3=proyecto/0).

## Mapeo de paste MAQUINARIA → Captura_Diaria (D52, verificado con el archivo real)

Captura_Diaria es una **tabla de Excel** (`fact_produccion`, A1:AA). Se pegan SOLO las columnas de entrada con **Pegado especial → Omitir blancos**; la tabla autocompleta las columnas-fórmula.

- **Columnas de entrada (se pegan):** B id_fecha · D id_proyecto · E id_maquina · G operador · H actividad · I SUB ACTIVIDAD · L Horas Operación · O Horas Mantenimiento · R ESTADO · T Producción · AA Observaciones.
- **Columnas-fórmula (NO se tocan, van en blanco):** A id_registro (`=ROW()-ROW(fact_produccion[#Headers])`, autonumera) · C dia · F Tipo Equipo · J Unidad · K Horas Programadas (VLOOKUP a `dim`) · M %util · N Horas Muertas (prog−oper) · P %muerto · Q Horas Facturadas · U Meta · V %ef · W rendimiento · X unitario · Z Costo.
- **En blanco aunque sean editables:** S CLIMA (pospuesto, D37) · Y Viajes (no aplica a maquinaria).
- **Derivaciones del app:** H/I desde la actividad del capataz (05_CATALOGO §1) · R ESTADO desde el motivo (05_CATALOGO §5) · O = prog−oper solo si motivo=Mantenimiento · T en blanco para vibros y actividades de apoyo (D41/D44).
- La hoja MAQUINARIA del Sheets se reordena a este layout A→AA; los internos del app (id_registro, timestamp, reporta, motivo, unidad_prod, etc.) quedan **después de AA** para trazabilidad.

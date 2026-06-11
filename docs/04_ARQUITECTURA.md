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
│  POST {reporte}                              → escribe BANDEJA + MAQUINARIA             │
│  POST {action:enviar_data}                   → pisa DATA del día + marca bandeja        │
│  Regla técnica: fechas por duck-typing (getFullYear), nunca instanceof Date.            │
│  Redespliegue: Administrar implementaciones → editar → Nueva versión (misma URL).       │
└────────────────────────────────────┬─────────────────────────────────────────────────--┘
                                     ▼
┌──────────────────────────── GOOGLE SHEETS (almacenamiento) ─────────────────────────────┐
│  BANDEJA     crudo con estado (pendiente/incluido/descartado/no_data)                   │
│  MAQUINARIA  equipos con producción individual (directo, sin aprobación)                │
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
2. **Chequeadora** entra → fecha, m³/viaje (14), origen → N líneas {PK destino, viajes, tipo destino} → el sistema genera filas de excavación (+terraplén si aplica).
3. Ambos envían → BANDEJA (+ MAQUINARIA). Confirmación real del servidor (cuenta de filas guardadas).

## Flujo de consolidación (diario, encargado)

1. Consulta fecha → ve: quién reportó / quién falta (capataces y máquinas), totales en vivo, bandeja agrupada por categoría con chip de fuente (rol·usuario).
2. Reconcilia: apaga duplicados (ej. terraplén estimado del capataz vs chequeadora), edita producciones, agrega líneas (directo o vía formulario capataz), anota inoperativos.
3. **Enviar a DATA** (pisa el día) → **Generar WhatsApp** (copia al portapapeles).

## Flujo de consulta

- estado.html: máquinas reportadas vs faltantes por fecha.
- encargado.html: consolidado y estado de reportes.
- Excel maestros: análisis, KPI y resúmenes mensuales (RESUMEN_MES con B2=período, B3=proyecto/0).

## Mapeo de paste MAQUINARIA → Captura_Diaria (pendiente de alinear en hoja)

id_registro→A · fecha→B · id_proyecto→D · id_maquina→E · operador→G · actividad→H · sub_actividad→I · horas_operadas→L · horas_muertas→N · h_mantenimiento→O · estado→R · produccion→T · viajes→Y · observaciones→AA. Las demás columnas de Captura_Diaria son fórmulas propias y no se tocan.

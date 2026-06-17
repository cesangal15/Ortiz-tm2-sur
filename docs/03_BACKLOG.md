# BACKLOG — TM2 Sur

## V1 — Alcance actual (en cierre)

| # | Ítem | Estado |
|---|---|---|
| 1.1 | Login multi-rol (admin, encargado, 5 capataces, 2 chequeadoras) | ✅ Hecho |
| 1.2 | Formulario capataz: actividades con producción adaptativa + equipos anidados | ✅ Hecho |
| 1.3 | Formulario chequeadora: origen + viajes por PK destino | ✅ Hecho |
| 1.4 | Panel encargado: bandeja con toggles, totales, edición, Enviar a DATA, WhatsApp | ✅ Hecho |
| 1.5 | Backend Apps Script v6 (BANDEJA / MAQUINARIA / DATA) | ✅ Hecho |
| 1.6 | DATA alineada al maestro TM2 (paste A:S) | ✅ Hecho |
| 1.7 | ZODME automático; cereo no_data; estado derivado | ✅ Hecho |
| 1.8 | Hoja RESUMEN_MES en Modelo_Produccion (períodos 16–15, producción individual) | ✅ Hecho (validar con datos reales) |
| 1.9 | Máquinas nuevas en dim (FNG02, CR08–CR26, PEXC027) | ✅ Hecho (datos de referencia) |
| 1.10 | Prueba punta a punta del flujo bandeja → DATA con día real completo | 🔲 Pendiente |
| 1.11 | Alinear hoja MAQUINARIA del Sheets al orden de Captura_Diaria | 🔲 Pendiente |
| 1.12 | Completar catálogo de máquinas (IDs reales de vibros/alquiladas faltantes) | ✅ Hecho |
| 1.13 | Corregir marca/modelo/valor-hora de máquinas nuevas en dim | ✅ Hecho |
| 1.14 | Contraseñas definitivas para encargado y chequeadoras | 🟡 Parcial (capataces ✅ y chequeadoras ✅ con clave común cheq2025; falta solo el encargado) |
| 1.15 | Desglose por placa en reporte de chequeadora (textarea + parser, hoja VOLQUETAS) | ✅ Hecho (validar con datos reales) |

## V2 — Mejoras identificadas (no iniciar sin cerrar V1)

| # | Ítem | Origen |
|---|---|---|
| 2.1 | Bandeja modo B: consolidado pre-armado con emparejamiento automático por PK/fecha/UF (chequeadora↔capataz), descartes sugeridos | D29 |
| 2.2 | Clima en formularios y su flujo al Excel | D37 |
| 2.3 | Festivos marcados en RESUMEN_MES (rojo, como histórico) | D38 |
| 2.4 | Reemplazar producción estimada por volumen real de chequeadora en la producción por máquina (depende de 2.1) | Conversación maquinaria |
| 2.5 | Actividades secuenciales adicionales (vendrán con las máquinas nuevas) | Usuario |
| 2.6 | Generación del mensaje WhatsApp con desglose idéntico al formato histórico (equipos por actividad, secciones MSR) | Formato actual simplificado |
| 2.7 | Registro de flota de volquetas (Ortiz vs particulares) — hoy se ignora | "Más adelante sí puede servir" |

## V3 — Largo plazo

| # | Ítem | Origen |
|---|---|---|
| 3.1 | Sistema de asistencia de personal (oficiales, ayudantes, operadores) | "Más adelante puede que hagamos un sistema para la asistencia" |
| 3.2 | Chequeadora del Diviso digitalizada (hoy reporta por foto, otra persona) | Conversación fuentes |
| 3.3 | Materiales MSR con columnas propias en el resumen diario (hoy solo en DATA por ítem) | Análisis Excel |
| 3.4 | Inoperativos estructurados (hoy texto libre) | D28 |

**Regla:** no inventar funcionalidades fuera de este backlog.

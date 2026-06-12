# PROJECT_CONTEXT — Sistema Reporte Diario de Obra TM2 Sur

**Qué es:** App web (GitHub Pages + Google Apps Script + Google Sheets) que digitaliza el reporte diario de movimiento de tierras de una obra vial, reemplazando WhatsApps manuales. Alimenta por copy-paste dos Excel maestros: TM2_SUR (cantidades de obra, hoja DATA) y Modelo_Produccion_Maquinaria (hoja Captura_Diaria).

**Alcance V1:** Tierras + Estructuras/MSR. Captura hasta LARGO (sin FC/CANTIDAD/ESPESOR, esos van en el maestro). Excluye drenajes, pavimentos, transporte, demoliciones, taludes.

**Roles:** 5 capataces (actividades + equipos), 2 chequeadoras (viajes por PK destino, por origen), 1 encargado (reconcilia y aprueba), admin (todo, vía menu.html).

**Flujo:** capataz/chequeadora → hoja **BANDEJA** (crudo, estado pendiente) y equipos → hoja **MAQUINARIA** (directo). Encargado revisa bandeja (toggles incluir/descartar, edita, agrega) → **Enviar a DATA** (pisa el día; bandeja queda incluido/descartado como historial) → genera WhatsApp. DATA cols A–T = espejo exacto del maestro TM2 (paste A:S); internas U–AA.

**Reglas críticas (NO rediscutir, ver 02_REGISTRO_DECISIONES):**
- UF: PK≤30→UF1/3701; PK>30→UF2/3702. CC = proyecto+código ítem, automático.
- m³ = viajes × 14 (editable). Volumen oficial de excavación/terraplén = **chequeadora**; conteo del capataz = solo control. Interno/acopio no se suma.
- Chequeadora genera excavación (por origen: Masivo2/Masivo1/Diviso/Complementario/Otro) + terraplén solo si destino=Terraplén (Puente/ODL/Botadero no).
- No aprovechable: ambos roles pueden reportar; encargado reconcilia (destino PK15+800/RCD). ZODME se agrega automático tras no aprovechable.
- Cereo: m²=(PKf−PKi)×ancho(11.5 editable); va a bandeja como **no_data** (nunca a DATA) y a maquinaria con su producción.
- Maquinaria: sin horómetros; horas directas. Prog 5h alquiladas (NH69/CAT320/MC705) / 6.4h propias (FNG02 propia). Operador obligatorio. Horas muertas=prog−oper → motivo obligatorio (dropdown 9 opciones). ESTADO derivado (sin muertas=OPERANDO). Equipos anidados en la actividad; producción máquina = largo de su línea; multi-máquina muestra el total (no sumar).
- Períodos maquinaria: 16 del mes anterior → 15 del mes. RESUMEN_MES: B2=yyyy-mm, B3=3701/3702/0(ambos). Metas: excavación 106.25, terraplén 85 m³/hr.
- Apps Script: fechas SIEMPRE por duck-typing (getFullYear), nunca instanceof Date. POST text/plain (respuesta legible). Redespliegue = editar implementación → nueva versión (misma URL).
- Reconciliación automática al abrir bandeja: filas de capataz que duplican volumen ya reportado por chequeadora se apagan por defecto (etiqueta "control · no suma", borde punteado). El total queda correcto sin intervención. Regla de validación: terraplén ≤ aprovechable+préstamo; el panel avisa en rojo si se viola. Corrección de máquina duplicada: `<select>` con lista de máquinas conocidas (no texto libre); requiere endpoint `editar_maquina` en Apps Script.

**Entidades:** BANDEJA(22 cols, estado) · DATA(A–T maestro + 7 internas) · MAQUINARIA(18 cols, con produccion/unidad_prod; pendiente alinear a Captura_Diaria) · Catálogo 23 actividades (ver 05_CATALOGO) · 19 máquinas.

**Pendientes V1:** prueba punta a punta; alinear MAQUINARIA a Captura_Diaria; IDs de máquinas faltantes (usuario los consigue); valores reales dim; contraseñas definitivas. **Pospuesto:** clima, festivos, emparejamiento automático por PK (V2).

**Restricción de trabajo:** no inventar funcionalidades (ver 03_BACKLOG); no escribir directo en los .xlsx maestros; el usuario valida con datos reales antes de dar por cerrado.

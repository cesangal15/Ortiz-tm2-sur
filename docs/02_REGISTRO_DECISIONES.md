# REGISTRO DE DECISIONES — TM2 Sur

Decisiones cerradas. **No replantear** salvo solicitud explícita del dueño del proyecto.

| ID | Decisión | Estado | Observaciones |
|---|---|---|---|
| D01 | Arquitectura de 3 capas: BANDEJA (crudo) → revisión del encargado → DATA (oficial) | ✅ Cerrada | Reemplazó la escritura directa a DATA. |
| D02 | Bandeja conserva historial: al enviar, filas quedan marcadas incluido/descartado (no se borran) | ✅ Cerrada | |
| D03 | Re-enviar una fecha a DATA **pisa** lo de ese día | ✅ Cerrada | Con confirmación previa en UI. |
| D04 | UF por PK: ≤30 → UF1/3701; >30 → UF2/3702 | ✅ Cerrada | Automático, no se pregunta. |
| D05 | m³ = viajes × 14, factor editable por reporte | ✅ Cerrada | |
| D06 | Volumen oficial de excavación/terraplén = **chequeadora**; conteo geométrico del capataz = solo control | ✅ Cerrada | Verificado con datos reales (28/05: 156 vs 153). |
| D07 | Material interno/acopio del capataz NO se suma al volumen oficial | ✅ Cerrada | El encargado histórico solo tomaba chequeadora. |
| D08 | No aprovechable: ambos roles pueden reportarlo; el encargado reconcilia (opción C) | ✅ Cerrada | Fuente varía por día (capataz al RCD o chequeadora descapote). |
| D09 | Sin horómetros HI/HF; horas operadas directas | ✅ Cerrada | Evita errores de digitación. |
| D10 | Horas programadas: 5 h alquiladas (NH69, CAT320, MC705) / 6.4 h propias | ✅ Cerrada | FNG02 = propia (6.4). Vibros ORTIZ (CR013/CR016/CR019) = propios 6.4h; CS78B/NH403/NH404/NH420/CAT900 = alquilados 5h. |
| D11 | Operador obligatorio al agregar máquina | ✅ Cerrada | |
| D12 | Motivo de horas menos = lista desplegable + "Otro (especificar)" | ✅ Cerrada | 9 opciones definidas. |
| D13 | ESTADO derivado del motivo; sin horas muertas = OPERANDO | ✅ Cerrada | No se pregunta aparte. |
| D14 | App captura hasta LARGO; sin FC ni CANTIDAD (van en el maestro) | ✅ Cerrada | |
| D15 | Campo se llama **"Producción"**, adaptativo por actividad (m³ / m² calculado / Ha / cantidad) | ✅ Cerrada | Reemplazó "Largo" en UI. |
| D16 | Cereo: m² = (PKf−PKi) × ancho vía (11.5 editable); **no va a DATA** pero sí a bandeja (no_data) y a maquinaria | ✅ Cerrada | PK final requerido en cereo. |
| D17 | ZODME automático tras excavación no aprovechable | ✅ Cerrada | Ítem secuencial, mismo volumen. |
| D18 | Liberación fija = CAMPO; campo Elemento autogenerado y oculto | ✅ Cerrada | |
| D19 | PK final opcional (salvo cereo) | ✅ Cerrada | |
| D20 | Equipos anidados dentro de cada actividad (no sección aparte); producción de la máquina = largo de la línea | ✅ Cerrada | Eliminó el doble trabajo. |
| D21 | Capataz elige actividades específicas de campo (núcleo, cereo, etc.); el sistema mapea al ítem contractual | ✅ Cerrada | Evita confusión con nombres generales. |
| D22 | Alcance V1: Tierras + Estructuras/MSR; sin drenajes, pavimentos, transporte, demoliciones, taludes | ✅ Cerrada | |
| D23 | DATA con columnas A–T en orden exacto del maestro TM2; internas a la derecha | ✅ Cerrada | Paste por bloque A:S. |
| D24 | Traspaso a Excel maestros = manual copy-paste (no escritura directa a .xlsx) | ✅ Cerrada | Protege fórmulas del maestro. |
| D25 | Orígenes chequeadora: Masivo 2, Masivo 1, Diviso/Préstamo, PK Complementario, Otro | ✅ Cerrada | Crudo de Río y Fresado son **materiales**, no orígenes. Botadero/RCD es **destino**, no origen. |
| D26 | Tipo de destino en línea de viajes: Terraplén / Puente / ODL / Botadero; solo Terraplén genera fila de terraplén | ✅ Cerrada | |
| D27 | Encargado agrega actividades+maquinaria usando el formulario del capataz (opción B, navegación) | ✅ Cerrada | Rol encargado aceptado en reporte-capataz; botón "← Volver". |
| D28 | Equipos inoperativos: texto libre en panel del encargado; entra al WhatsApp, no a MAQUINARIA | ✅ Cerrada | |
| D29 | Bandeja modo A (cruda con toggles); sugerencia automática pre-armada = fase 2 | ✅ Cerrada | Emparejamiento por PK pospuesto. |
| D30 | POST con Content-Type text/plain para leer respuesta del servidor (confirmación real de guardado) | ✅ Cerrada | Eliminó el "enviado" falso del modo no-cors. |
| D31 | Detección de fechas en Apps Script por duck-typing (getFullYear), nunca instanceof Date | ✅ Cerrada | Bug conocido del entorno GAS; costó 3 iteraciones. |
| D32 | Períodos de maquinaria: del 16 del mes anterior al 15 del mes de cierre | ✅ Cerrada | RESUMEN_MES lo implementa con cruce de año. |
| D33 | RESUMEN_MES: proyecto 0 = ambos; actividades generales (no subactividad); producción individual real | ✅ Cerrada | |
| D34 | Metas de rendimiento: Excavación 106.25 m³/hr, Terraplén 85 m³/hr (editables en la hoja) | ✅ Cerrada | Extraídas del resumen histórico de abril. |
| D35 | Máquinas en dim: lista definitiva ver §4 de 05_CATALOGO | ✅ Cerrada | Vibros anteriores (CR08/CR13/CR16/CR19/CR26) reemplazados por lista nueva. FNG02 confirmada. |
| D36 | Producción multi-máquina: cada una muestra el total de la actividad (visibilidad, no sumar entre máquinas) | ✅ Cerrada | |
| D37 | Clima en formularios | ⏸️ Pospuesta | "Hay otras cuestiones de por medio". |
| D38 | Festivos en rojo en RESUMEN_MES | ⏸️ Pospuesta | Se abordará después. |
| D39 | IDs de máquinas faltantes — resuelto parcialmente | ✅ Cerrada | Vibros confirmados. Pendiente: bulldozer D150B, moto 120 alquilada. |
| D40 | Alineación de hoja MAQUINARIA al orden de Captura_Diaria | ⏸️ Pendiente | Mapeo de columnas ya definido en Doc Maestro §7. |
| D41 | Vibrocompactadores (CR019, CR013, CR016, CS78B, NH403, NH404, NH420, CAT900): `produccion = null` en su fila de MAQUINARIA. El `largo` de la actividad **nunca** se ve afectado por el tipo de máquina asignada. | ✅ Cerrada | Corrección jun-2026: la regla se aplica solo a nivel de fila de MAQUINARIA (campo `produccion` de esa máquina). No oculta ni anula el campo de producción de la actividad. Una actividad productiva con vibro sigue capturando y enviando su `largo` normalmente a BANDEJA. |
| D42 | Actividades de apoyo sin producción: Paisajeo / Adecuación de caminos / Limpieza de derrumbe | ✅ Cerrada | Lista fija. Estado no_data; no van a DATA; sí a MAQUINARIA con producción nula. Aplica a cualquier máquina no-vibro. |
| D43 | Máquina con 0 horas operadas: capataz no la reporta; encargado la anota como inoperativo en su panel (texto libre, D28) | ✅ Cerrada | El capataz solo reporta máquinas que efectivamente trabajaron. |
| D44 | Actividades de compactación (terraplén, subbase, BTC) como apoyo sin producción | ✅ Cerrada | La producción ya queda en la actividad de conformación/excavación; la compactación solo registra el equipo. Estado no_data, no va a DATA. |
| D45 | Resumen en vivo en formulario del capataz | ✅ Cerrada | Bloque al final del formulario que muestra por actividad: nombre, PK, producción, equipos+horas. Indica campos incompletos en naranja y "listo para enviar" en verde. |
| D46 | Máquina en múltiples actividades el mismo día: horas operadas y motivo se ingresan una sola vez (primera aparición); actividades adicionales solo capturan producción. Horas se reparten proporcionalmente por producción al construir MAQUINARIA; reparto igual si no hay producción numérica. Horas muertas = programadas − total del día. | ✅ Cerrada | Aplica tanto si es el mismo capataz (escenario A) como si son capataces distintos (escenario B; el encargado reconcilia en bandeja). |
| D47 | Usuarios capataces: albert / angel / ariel / alejandro / robinson — contraseña común cap2025. Chequeadoras (4): maleja / mairy / maria / luzdary — contraseña común **cheq2025** (llaves en minúscula porque el login hace trim+toLowerCase). Contraseña del encargado: pendiente de definir (placeholder enc1-2). | ✅ Cerrada | Usuarios distintos por persona garantizan trazabilidad en columna `reporta` de BANDEJA. |
| D48 | Chequeadora reporta viajes por placa: pega un bloque estilo WhatsApp por línea de PK destino; el parser extrae placa (3 letras + 3 números, normalizada a 6 chars MAYÚSCULAS) y viajes (dígitos tras el guion final). El total de la línea se **CALCULA** (suma de placas), ya no se teclea. Cada placa genera una fila en la hoja nueva VOLQUETAS. **NO altera el volumen oficial**: la línea sigue generando su fila de excavación (+terraplén si destino=Terraplén) por el total, igual que D06. No toca BANDEJA/DATA/MAQUINARIA ni el panel del encargado. La app NO deduce empresa por placa; solo guarda la placa de 6 caracteres y el cruce placa→empresa lo hace el usuario en su Excel. | ✅ Cerrada | Renglones que no calzan el patrón se marcan en naranja (D45) y no se cuentan, sin bloquear el resto. Validado con datos reales jun-2026. |
| D49 | **Modo sin conexión — alcance V2.** Nivel 2 (captura offline + cola local + sincronización al volver la señal) en reporte-capataz.html y reporte-chequeadora.html. **Encargado FUERA** del offline: su flujo es leer–reconciliar–pisar (D03) y "Enviar a DATA" offline sobre una bandeja vieja podría borrar datos legítimos; consolida con señal. Reglas técnicas del ítem: `id_registro` generado como UUID en el cliente para deduplicar en re-sincronización (toca Codigo.gs); sesión {usuario, rol} migra de sessionStorage a localStorage para sobrevivir pestaña en segundo plano; la cola guarda el reporte completo (cantidades + maquinaria anidada + placas VOLQUETAS); el `fecha` guardado es la fecha de obra tecleada, no la de sync. **Nivel 3** (service worker / PWA para abrir sin señal desde cero) queda como **escalamiento etiquetado**, a activar solo si en pruebas de campo el celular pierde la pestaña en zona muerta; pospuesto por el costo de versionado de caché durante desarrollo activo. | ✅ Cerrada (alcance) | Implementación a V2, no iniciar sin cerrar V1. Definido en chat de alcance jun-2026 (backlog 2.8 / 2.9). |
| D50 | **Fecha por defecto anclada a la zona horaria de Colombia (UTC−5).** Los `<input type="date">` de reporte-capataz, reporte-chequeadora, encargado y estado calculan el día por defecto con `new Date().toLocaleDateString('en-CA',{timeZone:'America/Bogota'})`. **Prohibido** usar `toISOString()` para fechas mostradas al usuario: devuelve UTC y al caer la noche en Colombia (≥7 PM) mostraba el día siguiente, generando confusión en los reportes. | ✅ Cerrada | Corrección jun-2026. `en-CA` entrega el formato `YYYY-MM-DD` que requiere el input. No afecta el backend: la fecha del reporte siempre llega desde el frontend y `new Date()` en Codigo.gs solo se usa para timestamps de registro. |

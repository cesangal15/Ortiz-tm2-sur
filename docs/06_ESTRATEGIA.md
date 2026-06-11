# ESTRATEGIA DE TRABAJO Y HERRAMIENTAS — TM2 Sur
(Fases 2, 5 y 6 del ejercicio de reestructuración)

---

## FASE 2 — Estructura en Claude Projects

### Recomendación: UN ÚNICO PROJECT
**Justificación:** el sistema es un solo producto con un solo dueño, fuerte acoplamiento entre sus partes (una regla de negocio como "cereo no va a DATA" toca formulario, backend, panel y Excel a la vez) y un volumen documental pequeño (~15 páginas). Dividir en varios Projects fragmentaría las reglas de negocio, duplicaría el catálogo y multiplicaría el riesgo de contradicciones. La separación por Projects tiene sentido cuando hay equipos o dominios independientes; aquí no los hay.

### Configuración del Project único
**En las instrucciones del Project:** el contenido de PROJECT_INSTRUCTIONS.md (tal cual).

**Documentos cargados permanentemente (knowledge):**
1. PROJECT_CONTEXT.md — siempre (es el ancla).
2. 02_REGISTRO_DECISIONES.md — evita rediscusiones (su función principal).
3. 05_CATALOGO.md — se consulta en casi toda tarea de formularios/backend.
4. 04_ARQUITECTURA.md — necesaria en tareas técnicas.
5. 03_BACKLOG.md — control de alcance.

**Solo como referencia (subir a una conversación cuando haga falta, no al knowledge):**
- 01_DOCUMENTO_MAESTRO.md (redunda en buena parte con CONTEXT+CATALOGO; útil para onboarding o dudas profundas).
- Los archivos de código vigentes (HTML/Codigo.gs) — se suben solo a la conversación que los va a modificar.
- Los Excel maestros — solo cuando la tarea sea sobre ellos.

**NO volver a cargar nunca:**
- El historial de esta conversación ni resúmenes de ella.
- Reportes de WhatsApp de ejemplo (Capataces/Chequeadora/Encargado .txt) — sus conclusiones ya están destiladas en reglas y decisiones.
- Versiones antiguas de archivos (formulario.html viejo, Codigo.gs v1–v5).
- Análisis exploratorios de los Excel (los hallazgos están en el catálogo).

---

## FASE 5/6 — Estrategia de desarrollo, datos y conocimiento

### A. Dónde vive cada tipo de información (fuente oficial única)

| Información | Fuente oficial | Notas |
|---|---|---|
| Contexto general | PROJECT_CONTEXT.md (Project knowledge) | Copia espejo en GitHub /docs |
| Reglas de negocio | PROJECT_CONTEXT + 01_DOCUMENTO_MAESTRO | |
| Registro de decisiones | 02_REGISTRO_DECISIONES.md | Append-only |
| Backlog | 03_BACKLOG.md | |
| Arquitectura | 04_ARQUITECTURA.md | |
| Catálogos (actividades, máquinas, usuarios) | 05_CATALOGO.md | Los catálogos *en código* (constantes JS) deben reflejarlo |
| Código fuente | **GitHub (repo de Pages)** | Ya es obligatorio para publicar; es el versionado natural |
| Apps Script | Editor de GAS + copia Codigo.gs en el repo | El editor no versiona bien; el repo es el respaldo |
| Configuraciones (URL script, Sheet ID, credenciales) | 05_CATALOGO + el propio código | Cambiar contraseñas placeholder |
| Datos operativos diarios | Google Sheets (BANDEJA/DATA/MAQUINARIA) | |
| Datos consolidados/KPI | Excel maestros (Drive del usuario) | Nunca tocados por el app |
| Procedimientos operativos (cómo desplegar, cómo pegar al maestro) | Un OPERACIONES.md en /docs del repo | Pendiente de crear cuando V1 cierre |

### B. Claude vs Claude Code — recomendación específica

**Hoy (cierre de V1): seguir en Claude (este Project).** Las tareas restantes son de validación funcional, catálogos y ajustes pequeños donde el contexto de negocio pesa más que el volumen de código.

**Migrar a Claude Code cuando se cumplan las dos condiciones:** (1) V1 probado punta a punta y estable, y (2) empiece trabajo V2 de código puro (emparejamiento por PK, refactors, formato WhatsApp avanzado). En ese punto:
- **Claude (Project):** decisiones de negocio, nuevos requisitos, catálogos, documentación, diseño de pantallas, análisis de los Excel.
- **Claude Code (sobre el repo):** implementación, refactorización, bugs, mantener consistencia entre los 5 HTML (hoy duplican constantes), pruebas.
- El puente entre ambos: los mismos /docs en el repo (Claude Code los lee como contexto local con costo mínimo).

**Combinación recomendada:** Project principal + documentación espejada en GitHub (Opción 3 del enunciado). El Project es la "oficina de decisiones"; el repo es la fábrica.

### C. Estructura documental recomendada (en el repo de GitHub Pages)

```
/docs
  PROJECT_CONTEXT.md        ← espejo del Project (fuente: Project)
  02_REGISTRO_DECISIONES.md
  03_BACKLOG.md
  04_ARQUITECTURA.md
  05_CATALOGO.md
  OPERACIONES.md            ← crear al cerrar V1 (despliegue, paste, credenciales)
/ (raíz)                    ← los 6 HTML
/backend
  Codigo.gs                 ← copia del script desplegado
```
(01_DOCUMENTO_MAESTRO.md puede vivir solo en /docs como referencia extendida.)

### D. Documentación viva

| Documento | Responsable | Frecuencia | Criticidad |
|---|---|---|---|
| 02_REGISTRO_DECISIONES | Usuario (con texto propuesto por Claude al cerrar cada tema) | Por evento | **Alta** — es lo que evita rediscusiones |
| PROJECT_CONTEXT | Usuario | Solo si cambia una regla crítica | **Alta** |
| 03_BACKLOG | Usuario | Al cerrar/abrir ítems | Media |
| 05_CATALOGO | Usuario | Al agregar máquinas/actividades | Media-alta (el código depende) |
| 04_ARQUITECTURA | Usuario | Solo en cambios estructurales | Media |
| OPERACIONES | Usuario | Al cambiar despliegue/flujo | Media |

### E. Metodología de conversaciones (minimizar créditos)

1. **Una conversación = un objetivo** (ej. "alinear MAQUINARIA a Captura_Diaria"). Evitar chats ómnibus como el histórico.
2. **Abrir chat nuevo cuando:** cambia el objetivo, o la conversación supera ~30–40 turnos, o se entró en depuración larga ya resuelta.
3. **Al cerrar un chat con decisiones:** pedir el bloque de actualización de documentos y aplicarlo antes de abrir el siguiente.
4. **Subir a cada chat solo los archivos que se van a tocar** (ej. solo encargado.html si el cambio es del panel), nunca el paquete completo.
5. **Depuración:** dar siempre el dato observable (respuesta del endpoint debug, captura, valor de celda) en el primer mensaje; evita iteraciones a ciegas como las del bug de fechas.
6. **No pegar historiales** de otros chats; si falta algo en los docs, es señal de actualizar el doc, no de re-narrar.
7. Revisión mensual rápida (15 min): backlog al día, decisiones registradas, espejo del repo sincronizado.

### F. Riesgos y medidas

| Riesgo | Medida |
|---|---|
| Documentación desactualizada vs código | Regla "cambio cerrado = doc actualizado en el mismo chat"; el espejo en GitHub entra en el mismo commit del código |
| Múltiples fuentes de verdad | Tabla de fuentes oficiales (sección A); el Project manda en negocio, el repo en código |
| Catálogos duplicados en 5 HTML divergen | Al pasar a Claude Code: extraer constantes a un solo lugar (ítem técnico V2) |
| Conversaciones contradictorias | Instrucciones del Project obligan a verificar el registro de decisiones antes de proponer |
| Exceso de contexto recurrente | PROJECT_CONTEXT como única carga por defecto; el resto bajo demanda |
| Pérdida del Apps Script (sin versionado) | Copia Codigo.gs en el repo en cada cambio |
| Código desconectado de requisitos | Backlog con IDs; cada cambio referencia su ítem |

---

## RECOMENDACIÓN EJECUTIVA FINAL

1. **Arquitectura documental:** 6 documentos (CONTEXT, DECISIONES, BACKLOG, ARQUITECTURA, CATALOGO, MAESTRO) + OPERACIONES al cerrar V1. Fuente de negocio: Claude Project; espejo versionado: /docs del repo.
2. **Arquitectura de desarrollo:** mantener el stack actual (Pages + GAS + Sheets); sin cambios estructurales hasta cerrar V1.
3. **Claude Projects:** un único Project con PROJECT_INSTRUCTIONS en instrucciones y 5 docs en knowledge; el MAESTRO y el código como adjuntos puntuales por conversación.
4. **Claude Code:** adoptarlo al iniciar V2 para todo lo que sea código; primera tarea sugerida allí: unificar catálogos duplicados entre HTML.
5. **Repositorio:** el mismo repo de Pages con /docs y /backend; commit conjunto código+docs.
6. **Flujo próximos meses:** cerrar V1 (prueba punta a punta → alinear MAQUINARIA → completar máquinas) en este Project con chats mono-objetivo → congelar V1 → abrir V2 con Claude Code.
7. **Riesgo principal a evitar:** la deriva entre documentos, chats y código; se controla con la regla "ningún tema se cierra sin su actualización documental".
8. **Ahorro:** ver estimaciones abajo.

---

## ESTIMACIONES SOLICITADAS (Fase 4)

- **Conversación original descartable:** ~90%. Lo vigente (reglas, decisiones, catálogos, arquitectura, pendientes) cabe en estos documentos; el resto es razonamiento histórico, depuración ya resuelta, análisis exploratorios de Excel y versiones intermedias.
- **Documentación final equivalente:** ~14–16 páginas (los 7 documentos), de las cuales solo ~2 (PROJECT_CONTEXT) se cargan siempre.
- **Ahorro de contexto en conversaciones futuras:** ~80–90% por conversación. Hoy retomar el proyecto implica arrastrar un historial de decenas de miles de tokens; con la estructura propuesta, una conversación típica arranca con PROJECT_CONTEXT (~1.200 tokens) + el documento puntual de la tarea + solo el archivo de código afectado.

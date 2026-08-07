/**
 * Módulo de Asistencias de Personal de Tierra — TM2 Sur (Backend, Google Apps Script)
 *
 * AISLADO del reporte diario de obra: Sheet nuevo, script nuevo (URL propia). Nunca toca
 * BANDEJA/DATA/MAQUINARIA ni el Codigo.gs del reporte de obra (D69 del registro de decisiones).
 *
 * Flujo: responsable de cuadrilla reporta su gente (asistencia.html) -> hoja ASISTENCIA (directo,
 * sin bandeja: cada persona tiene un solo responsable; re-envío pisa fecha+cuadrilla, D03).
 * Residente/jeisson consultan el resumen del día y exportan el Excel formato Navision
 * (resumen-asistencia.html, SheetJS en el navegador).
 *
 * Endpoints:
 *   GET  ?action=roster&usuario=…            -> cuadrillas del usuario + personas activas + CONFIG
 *                                                + CAT_CC + motivos FRECUENTES (MOTIVOS_USADOS, D78)
 *                                                + CC recientes por cuadrilla
 *   GET  ?action=asistencia&fecha=…          -> filas del día + estado por cuadrilla + faltantes
 *                                                + catálogos COMPLETOS (CC y motivos, D78)
 *   GET  ?action=personal                    -> PERSONAL completo + CUADRILLAS (gestión)
 *   GET  ?action=export&fecha=…              -> filas crudas del día (todas) + catálogos para el
 *                                                generador Navision (cliente decide por proyecto)
 *   GET  ?action=ausencias&desde=&hasta=…    -> seguimiento de ausencias por RANGO (D94): ausencias
 *                                                reportadas (con motivo) + días sin reportar
 *   GET  ?action=persona&codigo=&cedula=&desde=&hasta=
 *                                             -> horas de UNA persona en un rango (D112): filas CRUDAS
 *                                                + config/festivos/turnos; clasifica el cliente con el
 *                                                mismo `horas-nomina.js` del Parte. Solo lectura.
 *   POST {action:'reporte_asistencia', fecha, cuadrilla, reporta, filas:[…]}
 *                                             -> pisa fecha+cuadrilla, escribe (confirma conteo, D30)
 *   POST {action:'personal', op:'alta'|'retiro'|'mover'|'reactivar', usuario, …}
 *                                             -> valida usuario ∈ {residente, admin} antes de escribir
 *   GET  ?action=extras_admin&fecha=…       -> registro de EXTRAS_ADMIN del día (o null) — prefill (D73)
 *   POST {action:'extras_admin', fecha, cc, horas, tipo}
 *                                             -> upsert por fecha en EXTRAS_ADMIN (deriva proyecto del CC)
 *   POST {action:'extras_admin_delete', fecha} -> elimina la fila del día
 *
 * Reglas técnicas heredadas (obligatorias, ver /docs/02_REGISTRO_DECISIONES.md):
 *   - Fechas SIEMPRE por duck-typing (typeof v.getFullYear==='function'), nunca instanceof Date (D31).
 *   - POST con Content-Type text/plain y confirmación real del servidor (D30).
 *   - Capacidad de grilla: toda escritura en bloque pasa por ensureRows_ (D93). No pre-crear filas.
 *
 * Rendimiento (D99 → D102):
 *   - D99: una sola apertura del Spreadsheet por ejecución (`ss_`), memoria de lectura por petición
 *     (`_memoHoja`), CacheService 6 h para las 10 hojas casi estáticas (NUNCA ASISTENCIA /
 *     NOTAS_ASISTENCIA / EXTRAS_ADMIN) y campo `_ms` en toda respuesta.
 *   - D102: LECTURA EN DOS PASOS de `ASISTENCIA` — los endpoints acotados a una fecha o a un rango
 *     escanean solo la columna `fecha` y traen únicamente los bloques de filas de ese día
 *     (`leerFilasPorFecha_`); los dos cruces que necesitan todo el histórico se acotan por COLUMNAS
 *     (`leerColumnasDeHoja_`). Campo `_celdas` en toda respuesta. Ver el bloque grande de comentarios
 *     sobre `leerFilasPorFecha_` antes de tocar nada de esto.
 */

// El usuario reemplaza este placeholder si crea un Sheet nuevo; ya viene fijado al Sheet entregado.
const SHEET_ID = '1KrhzaIg3BSspyi0oH0gHkAJnSRXaOIdel_pKaMVHX9w';

// D93 — tamaño mínimo de expansión de la grilla (filas). Una hoja de Sheets nace con 1.000 filas;
// cuando se agotan, un setValues en bloque falla entero ("The coordinates of the range are outside
// the dimensions of the sheet") y el usuario tenía que añadir filas a mano para que la información
// volviera a cargar. Se crece en bloques de este tamaño para no fragmentar la grilla. Es el ÚNICO
// número a cambiar si se quiere otro tamaño de bloque.
const BLOQUE_FILAS = 1000;

// D72: `fecha_ingreso` (col 9) hace el roster "date-aware": el alta puede ser retroactiva ("desde
// cierto día") y el retiro lleva su propia fecha. Celda vacía en filas viejas = sin límite inferior
// (siempre estuvo activa) → retrocompatible con lo ya guardado.
const PERSONAL_HEADERS      = ['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'];
// D72: `area` (col 3) etiqueta cada cuadrilla como tierras/odt/odl para que residente_odt/residente_odl
// vean SOLO su área en el resumen. Celda vacía en filas viejas = 'tierras' (retrocompatible).
// D84: `estado` (col 4) saca una cuadrilla de circulación SIN borrar su fila (borrarla dejaría huérfano
// el histórico de ASISTENCIA, que la referencia por nombre). `activa`/`inactiva`; VACÍO = activa
// (retrocompatible). El filtro aplica al ROSTER ESPERADO (roster, faltantes, estado, export, selectores
// y gestión), NO a lo ya reportado: las filas de fechas anteriores de una cuadrilla inactiva siguen
// saliendo en el resumen y el export.
const CUADRILLAS_HEADERS    = ['cuadrilla','responsables','area','estado'];
// D72: `turno` (col 17) guarda el turno con que se reportó cada persona, para que el export conozca la
// jornada programada y calcule las extras (Opción A: extra = lo trabajado más allá de la salida del
// turno). Vacío en filas viejas = turno diurno estándar (el export arma la jornada por defecto del día).
const ASISTENCIA_HEADERS    = ['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre',
  'cargo','cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno'];
const CONFIG_HEADERS        = ['clave','valor'];
const FESTIVOS_HEADERS      = ['fecha'];
const CAT_TRABAJADORES_HEADERS = ['codigo','string_navision'];
// Una sola columna: cada CC va COMPLETO en su celda ("3701.06.67| Box abovedados...", verbatim de
// Navision). El proyecto NO se pide aparte: se deriva del propio prefijo del string (proyectoFromCC).
const CAT_CC_HEADERS        = ['string_cc'];
// CAT_MOTIVOS = catálogo COMPLETO de motivos de ausencia (verbatim de Navision). Lo ve completo quien
// accede al resumen (residentes/jeisson/admin) para poder registrar un motivo especial (D78).
const CAT_MOTIVOS_HEADERS   = ['string_motivo'];
// MOTIVOS_USADOS (D78): subconjunto de CAT_MOTIVOS que se usa a diario — misma filosofía que CC_USADOS.
// Es lo que ve el RESPONSABLE de cuadrilla en asistencia.html (los demás motivos solo confunden).
// Si la hoja está vacía se cae al catálogo completo (retrocompatible: instalaciones sin llenarla
// siguen viendo lo mismo que hoy).
const MOTIVOS_USADOS_HEADERS = ['string_motivo'];
// CC_USADOS: subconjunto de CAT_CC que se usa a diario (≈5-20). El usuario lo mantiene (pega los CC
// frecuentes, mismo string exacto que CAT_CC). El formulario muestra estos por defecto y deja buscar
// el resto del catálogo completo. Si la hoja está vacía, se usa el catálogo completo como antes.
// D72: `area` (col 2) opcional para servir los CC frecuentes SOLO al área que los usa (p. ej. todos
// los `06.*` de drenajes van a ODT y no ensucian el datalist de los capataces de tierra). Celda vacía
// = 'tierras' (retrocompatible con lo ya pegado). Al usuario "sin área" (residente general/admin) se
// le muestran todos.
const CC_USADOS_HEADERS     = ['string_cc','area'];
// D72: catálogo de TURNOS asignados (diurno T1 + nocturnos T2–T5). Cada fila = turno × tipo de día,
// con entrada/salida y el descanso (almuerzo/cena) a descontar. `cruza_medianoche`='SI' cuando la
// salida es del día siguiente (los nocturnos). Sirve para PRE-LLENAR la hora de entrada/salida del
// reporte (captura cruda, D69b) y como ESTÁNDAR de ordinarias del clasificador del export (D72e/D77:
// columnas C–G calculadas por turno; solo el mapeo H–N Dom/Fest c/s compensación sigue abierto).
const TURNOS_HEADERS        = ['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche'];
// EXTRAS_ADMIN (D73): canal "solo extras" del admin — una fila por día (clave lógica = `fecha`, re-guardar
// pisa el día). El admin registra SUS horas extras de días puntuales; su jornada ordinaria se asume por
// fuera del sistema y no aparece en el `Parte` salvo los días con extra. Aislada del roster (PERSONAL/
// CUADRILLAS/ASISTENCIA): el admin NO está en el roster. `proyecto` se deriva del `cc` (proyectoFromCC).
const EXTRAS_ADMIN_HEADERS  = ['fecha','cc','proyecto','horas','tipo','timestamp','reporta'];
// D74: nota libre del día por cuadrilla (el capataz avisa novedades: alguien nuevo, una anomalía, etc.).
// Clave lógica = fecha+cuadrilla (re-enviar la asistencia pisa la nota, igual que las filas, D03). Aislada
// de ASISTENCIA; la ve el residente en el resumen. No va al Excel Navision.
const NOTAS_ASISTENCIA_HEADERS = ['fecha','cuadrilla','reporta','nota','timestamp'];

/* ---------- helpers genéricos (mismo patrón que Codigo.gs) ---------- */
/**
 * D99 (Fase 2, punto 4) — campo `_ms` = milisegundos de SERVIDOR en toda respuesta JSON.
 * Sirve para separar lo que tarda Apps Script de lo que tarda la red/el arranque del contenedor: el
 * frontend (`DEBUG_PERF` en `resumen-asistencia.html`) ya lo lee y muestra `servidor_ms` y `red_ms`
 * en su `console.table`. Si `_ms` sale bajo y el total alto, el problema NO está en este script.
 * `_t0` lo siembran `doGet`/`doPost`; sin él (llamada desde el editor) no se agrega el campo.
 */
var _t0 = null;
/**
 * D102 — campo `_celdas` = celdas de Sheet LEÍDAS en esta ejecución (escaneo de columna + bloques,
 * o la lectura completa si se cayó al fallback). Es el `_ms` del volumen: permite ver en campo si la
 * lectura acotada está entrando o no, sin adivinar, y es lo que disparará el umbral del backlog 4.11
 * cuando llegue. Lo suma `leerRango_`, único punto por el que pasa TODO `getValues` del archivo.
 * Una lectura servida por `CacheService` o por la memoria de ejecución suma 0: eso es lo correcto,
 * porque no tocó el Sheet.
 */
var _celdas = 0;
function json(o){
  if(_t0 !== null && o && typeof o === 'object' && o._ms === undefined) o._ms = Date.now() - _t0;
  if(_t0 !== null && o && typeof o === 'object' && o._celdas === undefined) o._celdas = _celdas;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
/**
 * D102 — ÚNICO punto de lectura del Sheet en todo el archivo. Todo `getValues` pasa por aquí para que
 * el contador de `_celdas` no se pueda quedar desfasado al agregar una lectura nueva.
 */
function leerRango_(sh, fila, col, nFilas, nCols){
  _celdas += nFilas * nCols;
  return sh.getRange(fila, col, nFilas, nCols).getValues();
}
function fdate(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getFullYear === 'function')
    return v.getFullYear()+'-'+('0'+(v.getMonth()+1)).slice(-2)+'-'+('0'+v.getDate()).slice(-2);
  return String(v).slice(0,10);
}
// Hora cruda HH:MM, tolerante a que Sheets la guarde como objeto Date (duck-typing, nunca instanceof Date).
function ftime(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getHours === 'function')
    return ('0'+v.getHours()).slice(-2)+':'+('0'+v.getMinutes()).slice(-2);
  // Texto: normaliza a HH:MM con CERO a la izquierda. Una celda "7:00" (sin cero) rompía el
  // <input type=time> del formulario y la hora AM salía en blanco (D72). "15:30" ya venía bien.
  var s=String(v).trim(), m=s.match(/(\d{1,2}):(\d{2})/);
  if(m) return ('0'+m[1]).slice(-2)+':'+m[2];
  return s.slice(0,5);
}
/* ============ D109 — AUTENTICACIÓN POR TOKEN FIRMADO (backlog 2.25) ============
 *
 * EL AGUJERO QUE CIERRA. Hasta D108 el rol vivía en el navegador y el backend se creía la identidad
 * que le mandaba el cliente (`e.parameter.usuario`, `body.usuario`). Dos consecuencias, las dos
 * comprobadas sobre este mismo código: cualquiera podía escribir `rol: admin` en el almacenamiento de
 * su navegador y entrar al menú; y, peor, la URL del Apps Script está en el código de 13 pantallas, así
 * que se podía llamar a los endpoints desde una terminal diciendo «soy la residente» — sin contraseña.
 * Los cerrojos de área (D69h/D101) eran decorativos frente a eso: el área se derivaba del usuario que
 * el propio cliente declaraba. D108 sacó las claves del archivo público, pero NO arregló nada de esto.
 *
 * CÓMO SE CIERRA. Al entrar, el backend emite un TOKEN que lleva dentro `usuario·rol·áreas` y va
 * FIRMADO con HMAC-SHA256 usando un secreto que vive en las Propiedades del Script — ni en la hoja, ni
 * en el repositorio, ni en el navegador. Cada petición lo trae; cada endpoint verifica la firma y saca
 * la identidad DEL TOKEN, ignorando lo que diga el cliente. Sin el secreto no se puede fabricar ni
 * alterar un token: cambiarle un byte al rol invalida la firma.
 *
 * POR QUÉ NO CADUCA POR TIEMPO — esto es lo que lo hace compatible con el modo sin conexión (D82).
 * Un reporte capturado el viernes en zona muerta puede pasar el fin de semana en la cola del teléfono
 * y subirse el lunes. Con un token «válido 24 h» ese reporte sería rechazado y, como la cola solo
 * suelta lo que el servidor confirma, se quedaría atascado para siempre reintentando. Así que el token
 * no vence por reloj: vence por VERSIÓN.
 *   · `AUTH_V` (Propiedades del Script) — subirlo invalida TODOS los tokens de golpe. Es el botón de
 *     «sacar a todo el mundo» (teléfono perdido). Hay que subirlo en LOS DOS proyectos.
 *   · `estado` en la hoja `USUARIOS` (D108) — ponerlo distinto de `activo` deja fuera a UNA persona.
 *     La hoja `USUARIOS` vive en el Sheet de OBRA, así que aquí ese cerrojo no se comprueba (D69: módulos aislados):
 *     para dejar fuera a alguien de ESTE módulo de inmediato hay que subir `AUTH_V` también aquí.
 *
 * CONSECUENCIA QUE HAY QUE SABER: si sacas a alguien que tiene reportes pendientes en su teléfono,
 * esos reportes ya no suben. Antes de dar de baja a alguien, mirar que su contador esté en cero.
 *
 * `AUTH_ESTRICTO` es la válvula: en `false` se aceptan peticiones sin token válido y solo se anotan en
 * el registro (útil para ver qué teléfono sigue con la app vieja). Se despliega en `true`.
 */
const AUTH_ESTRICTO = true;

/* ¿Este proyecto EMITE tokens o solo los verifica? Solo hay UN emisor: el de obra, que es donde vive
 * la hoja `USUARIOS` y donde ocurre el login. Importa porque las Propiedades del Script son POR
 * PROYECTO, no globales: si el verificador se autogenerara su propio secreto, firmaría distinto que
 * el emisor y rechazaría TODOS los tokens buenos. Por eso el emisor lo crea y el verificador exige
 * que se lo hayan copiado — y si no está, lo dice con todas las letras en vez de inventarse uno. */
const AUTH_EMISOR = false;   // este proyecto SOLO verifica: el login vive en el de obra

function _authProps_(){ return PropertiesService.getScriptProperties(); }
/* El secreto NUNCA sale del servidor por la API. Para rotarlo: borrar la propiedad `AUTH_SECRETO` en
 * los DOS proyectos y volver a copiarla; todos los tokens dejan de valer y la gente entra otra vez. */
function authSecreto_(){
  const p=_authProps_(); let s=p.getProperty('AUTH_SECRETO');
  if(!s){
    if(!AUTH_EMISOR) return '';                       // verificador sin secreto: NO se inventa uno
    s=Utilities.getUuid()+'-'+Utilities.getUuid(); p.setProperty('AUTH_SECRETO', s);
  }
  return s;
}
/* Se ejecuta A MANO desde el editor del proyecto EMISOR (obra) para leer el secreto y copiarlo al de
 * asistencias con `fijarSecretoAuth`. Es el único momento en que el secreto se mira. */
function mostrarSecretoAuth(){
  const s=authSecreto_();
  Logger.log('AUTH_SECRETO = ' + s);
  Logger.log('Cópialo y ejecuta fijarSecretoAuth("'+s+'") en el proyecto de Asistencias.');
  return s;
}
/* Fija el secreto a mano (se usa en el proyecto VERIFICADOR). También sirve aquí para rotarlo. */
function fijarSecretoAuth(valor){
  const v=String(valor||'').trim();
  if(v.length<20) throw new Error('El secreto llegó vacío o demasiado corto. Cópialo de mostrarSecretoAuth() en el proyecto de obra.');
  _authProps_().setProperty('AUTH_SECRETO', v);
  return 'AUTH_SECRETO fijado. Los tokens emitidos por el otro proyecto ya se validan aquí.';
}
function authVersion_(){ return String(_authProps_().getProperty('AUTH_V') || '1'); }
function _b64url_(bytes){ return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/,''); }
function _firmar_(txt){
  return _b64url_(Utilities.computeHmacSha256Signature(txt, authSecreto_(), Utilities.Charset.UTF_8));
}
function emitirToken_(usuario, rol, areas){
  const carga={ u:String(usuario||''), r:String(rol||''), a:areas||[], v:authVersion_(), t:Date.now() };
  const p=_b64url_(Utilities.newBlob(JSON.stringify(carga)).getBytes());
  return p+'.'+_firmar_(p);
}
/* Verifica FIRMA primero y solo después interpreta el contenido: nunca se parsea algo no firmado. */
function verificarToken_(tok){
  const s=String(tok||''), i=s.indexOf('.');
  if(i<1) return {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  const carga=s.slice(0,i), firma=s.slice(i+1);
  if(_firmar_(carga)!==firma) return {ok:false, error:'Sesión no válida. Vuelve a entrar.'};
  let o;
  try{ o=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(carga)).getDataAsString()); }
  catch(err){ return {ok:false, error:'Sesión ilegible. Vuelve a entrar.'}; }
  if(String(o.v)!==authVersion_()) return {ok:false, error:'Sesión cerrada por el administrador. Vuelve a entrar con señal.'};
  return {ok:true, usuario:String(o.u||'').trim().toLowerCase(), rol:String(o.r||''), areas:Array.isArray(o.a)?o.a:[]};
}
/* Punto ÚNICO de autenticación: lo llaman doGet y doPost, nadie más. Devuelve la sesión REAL, la que
 * sale del token; el resto del archivo puede seguir usando `usuario` como siempre porque los puntos de
 * entrada lo sobrescriben con este valor. */
function sesion_(e, body){
  // Diagnóstico explícito: sin secreto configurado NADA validaría, y el error genérico («vuelve a
  // entrar») mandaría a todo el mundo a dar vueltas al login sin que nadie entienda qué pasa.
  if(!authSecreto_()) return {ok:false, error:'El servidor no tiene configurado AUTH_SECRETO. '
    + 'Ejecuta mostrarSecretoAuth() en el Apps Script de obra y fijarSecretoAuth("…") en este.'};
  const tok = (body && body.token) || (e && e.parameter && e.parameter.token) || '';
  const r = tok ? verificarToken_(tok) : {ok:false, error:'Falta el token de sesión. Vuelve a entrar.'};
  if(r.ok) return r;
  if(!AUTH_ESTRICTO){
    Logger.log('AUTH tolerante: petición aceptada SIN token válido ('+r.error+') — action='
      + ((body && body.action) || (e && e.parameter && e.parameter.action) || '?'));
    return {ok:true, usuario:'', rol:'', tolerado:true};
  }
  return r;
}

/* ============ D106 — PORTERO DE FECHAS (incidente "reportes sin fecha", jul-2026) ============
 *
 * EL PROBLEMA QUE ARREGLA. `fdate` NORMALIZA pero no VALIDA: con `''`/`null` devuelve `''` y con
 * basura devuelve los 10 primeros caracteres tal cual (`'15/07/2026'`, `'undefined'`). Las dos rutas
 * que escriben ASISTENCIA (`guardarAsistencia`, `guardarIndividual`) tomaban ese resultado y lo
 * escribían en la columna `fecha` sin preguntar nada. Resultado observado dos veces en producción:
 * el bloque completo de una cuadrilla quedaba en la hoja **con todos sus datos y la columna C vacía**.
 *
 * POR QUÉ ERA GRAVE Y NO SOLO FEO. Una fila sin fecha:
 *   1. es INVISIBLE para todo el módulo — resumen, export del Parte y ausencias filtran por fecha,
 *      así que la cuadrilla aparece como "sin reportar" y su gente no sale en el Parte de Navision;
 *   2. se BORRA sola en el siguiente envío con fecha vacía de la misma cuadrilla: el upsert de D03
 *      quita "todo lo que sea fecha+cuadrilla", y con fecha `''` eso son justo las filas huérfanas
 *      del intento anterior. Ahí es donde el histórico se perdía de verdad;
 *   3. se REALIMENTA desde el resumen: `?action=asistencia&fecha=` (vacía) devolvía exactamente las
 *      filas huérfanas, y "Completar faltantes" las volvía a guardar con la fecha vacía.
 *
 * LA REGLA. Toda fecha que entra por la API pasa por aquí y solo se acepta `yyyy-MM-dd` con un día
 * que exista de verdad (rechaza `2026-02-31` y `2026-13-01`). Duck-typing intacto: primero `fdate`,
 * nunca `instanceof Date` (D31). Escribir mal es peor que no escribir: si la fecha no es válida, la
 * escritura se RECHAZA con un mensaje que dice qué hacer. Para la cola offline (D82) eso es lo
 * correcto: sin `ok:true` el ítem NO sale de la cola, así que el reporte no se pierde — se queda en
 * el teléfono hasta que se reenvíe con una fecha buena.
 */
function fdateValida_(v){
  const s=fdate(v);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const p=s.split('-'), y=Number(p[0]), m=Number(p[1]), d=Number(p[2]);
  const dt=new Date(y, m-1, d);   // aritmética local (Bogotá no tiene DST), mismo patrón que diasDelRango
  return (dt.getFullYear()===y && dt.getMonth()===m-1 && dt.getDate()===d) ? s : '';
}
const ERROR_FECHA = 'La fecha del reporte llegó vacía o con un formato que no se entiende. '
  + 'Vuelve a elegir el día en el campo "Fecha" y envía otra vez. '
  + 'No se guardó nada a propósito: una asistencia sin fecha no aparece en el resumen ni en el Parte.';
/**
 * D93 — Garantiza que la hoja tenga filas suficientes para escribir n filas a partir de la última
 * fila con datos. Crece en bloques (BLOQUE_FILAS) para no fragmentar la grilla. Idempotente y
 * barata: si hay espacio, no hace NADA (una sola lectura de getLastRow/getMaxRows, cero escrituras).
 * La inserción es SIEMPRE después de la última fila de la GRILLA (insertRowsAfter(getMaxRows())),
 * así que jamás desplaza ni pisa filas existentes.
 * NO pre-crea filas vacías "por si acaso": el techo del archivo es de 10 millones de celdas sumando
 * todas las hojas y las filas vacías consumen cupo y degradan el rendimiento.
 * Mismo helper, idéntico, en Codigo.gs (son dos proyectos de Apps Script separados, D69).
 */
function ensureRows_(sheet, n) {
  var necesarias = sheet.getLastRow() + (n || 1);
  var faltan = necesarias - sheet.getMaxRows();
  if (faltan > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), Math.max(faltan, BLOQUE_FILAS));
  }
}

/**
 * D93 — Garantiza que la hoja tenga al menos nCols columnas (el mismo problema, en el otro eje).
 * Solo garantiza CAPACIDAD para los encabezados que el código ya define: no cambia el orden ni el
 * número de columnas de ninguna hoja.
 */
function ensureCols_(sheet, nCols) {
  var faltan = nCols - sheet.getMaxColumns();
  if (faltan > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), faltan);
  }
}

/**
 * D99 (Fase 2, punto 1) — UNA sola apertura del Spreadsheet por ejecución.
 * Antes, `getSheet`/`readSheet` hacían `SpreadsheetApp.openById(SHEET_ID)` en CADA llamada: una
 * petición de `?action=asistencia` abría el archivo 14 veces. La referencia perezosa lo abre la
 * primera vez que hace falta y la reusa el resto de la ejecución.
 * OJO: es una variable de ejecución, NO un caché entre peticiones — Apps Script arranca un contexto
 * nuevo por petición, así que nunca sobrevive a la llamada.
 */
var _ss = null;
function ss_(){ if(!_ss) _ss = SpreadsheetApp.openById(SHEET_ID); return _ss; }

/**
 * D99 (Fase 2, punto 1) — Memoria de lectura DENTRO DE UNA MISMA EJECUCIÓN.
 * Los helpers (`areaDeCuadrillaMap`, `cuadrillasInactivasSet`, `getConfigMap`, `ccUsadosParaArea`…)
 * llaman a `readSheet` cada uno por su cuenta, así que la misma hoja se releía varias veces en la
 * misma petición: CUADRILLAS ×3 y CONFIG ×2 en `asistenciaDia`, y **ASISTENCIA entera ×2** en
 * `exportDia` (punto 3). Con esta memoria, la segunda lectura de una hoja sale gratis.
 *
 * NO es `CacheService`: vive solo lo que dura la petición, así que **no puede devolver datos viejos
 * a otra llamada** — el riesgo de invalidación de la Fase 2 punto 5 no aplica aquí. Aun así, todo
 * punto de escritura invalida su hoja (`invalidarHoja_`) por si en el futuro alguien lee después de
 * escribir en el mismo `doPost`.
 * Los llamadores nunca mutan el arreglo devuelto (usan filter/map/find; `roster` ordena la COPIA que
 * devuelve su `filter`), verificado antes de introducir la memoria.
 */
var _memoHoja = {};

/**
 * D102 — memoria de las lecturas ACOTADAS, SEPARADA de `_memoHoja`.
 *
 * ⚠️ TODO / ADVERTENCIA PARA QUIEN VENGA DESPUÉS ⚠️
 * Una lectura acotada (por fecha o por columnas) NO puede poblar `_memoHoja[hoja]`: ahí vive la hoja
 * COMPLETA. Si se guardaran las filas de un solo día bajo la clave 'ASISTENCIA', cualquier función
 * que después pidiera la hoja entera en el mismo `doPost`/`doGet` recibiría un subconjunto creyendo
 * que es todo — y no fallaría: devolvería datos incompletos en silencio (un export sin la mitad de la
 * gente, un `proyectoDefecto` calculado sobre un día). Por eso van en un diccionario aparte, con clave
 * `hoja + '|' + tipo + '|' + …`, y `invalidarHoja_` limpia LOS DOS.
 * Si algún día añades otra variante de lectura parcial, dale su propia clave con el mismo prefijo de
 * hoja; NO la metas en `_memoHoja`.
 */
var _memoRango = {};
function invalidarHoja_(nombre){
  delete _memoHoja[nombre];
  const pref = nombre + '|';                                   // todas las variantes acotadas de esta hoja
  Object.keys(_memoRango).forEach(function(k){ if(k.indexOf(pref) === 0) delete _memoRango[k]; });
  cacheBorrar_(nombre);
}

/* ================= D99 (Fase 2, punto 5) — CacheService para lo casi estático =================
 * Medido en campo tras el redeploy de los puntos 1–4: `_ms` de servidor **5.200–5.456 ms** de un
 * total de ~7.000 (el pintado del cliente son 2 ms). Con 11 lecturas de hoja por petición, el coste
 * está en el ida-y-vuelta FIJO de cada `getValues`, no en el volumen (<2.000 filas). Cachear las
 * hojas casi estáticas deja `asistenciaDia` en **3 lecturas**.
 *
 * NUNCA se cachean ASISTENCIA, NOTAS_ASISTENCIA ni EXTRAS_ADMIN: cambian durante el día y un caché
 * ahí produciría datos falsos en el resumen (regla explícita del planteamiento).
 *
 * INVALIDACIÓN — dos caminos, porque hay dos formas de cambiar estas hojas:
 *   1. Desde el script (alta/retiro/mover/reingreso de personal, encabezados): `invalidarHoja_` borra
 *      la memoria de la ejecución **y** las claves de caché. Es exacta e inmediata.
 *   2. **A mano en el Sheet** — así se mantienen CAT_CC, CAT_TRABAJADORES, CAT_MOTIVOS, CC_USADOS,
 *      CONFIG, TURNOS y la columna `estado`/`area` de CUADRILLAS (ver 04_ARQUITECTURA). Esas ediciones
 *      NO pasan por aquí, así que el caché las ignoraría hasta que expire. Por eso existe
 *      `?action=cache_reset` (botón "↻ Refrescar catálogos" en el resumen): quien pega un catálogo
 *      nuevo lo ve al instante, sin esperar el TTL ni redesplegar.
 * `CACHE_ON=false` desactiva todo de un tirón si algún día estorba.
 */
const CACHE_ON        = true;
const CACHE_TTL       = 21600;    // 6 h
const CACHE_PREFIJO   = 'asis_v1_';
const CACHE_TROZO     = 90000;    // < 100 KB: tope de CacheService por valor
const CACHE_TROZOS_MAX= 10;       // ~900 KB por hoja; más grande que eso no se cachea (se lee siempre)
// Hojas casi estáticas. Las tres vivas (ASISTENCIA, NOTAS_ASISTENCIA, EXTRAS_ADMIN) NO están y no deben estar.
const HOJAS_CACHEABLES = { CONFIG:1, FESTIVOS:1, TURNOS:1, CAT_CC:1, CAT_TRABAJADORES:1,
                           CAT_MOTIVOS:1, MOTIVOS_USADOS:1, CC_USADOS:1, CUADRILLAS:1, PERSONAL:1 };

/* Normalización ANTES de cachear — el punto delicado de todo esto.
 * Sheets devuelve las celdas de fecha y de hora como objetos Date. Si se cachearan tal cual, el JSON
 * las guardaría en ISO/UTC y al volver serían strings: `fdate` cortaría la fecha en UTC (un día menos
 * si la zona del script tiene desfase positivo) y `ftime` sacaría la hora en UTC (un 07:00 de Bogotá
 * volvería como "12:00"). Por eso cada hoja con fechas/horas se normaliza a su forma FINAL de string
 * con los mismos helpers de siempre (duck-typing, nunca `instanceof Date` — D31).
 * La normalización se aplica SIEMPRE, se cachee o no, para que el resultado sea idéntico con caché
 * frío y caliente. Es idempotente: `fdate('2026-01-01')` y `ftime('07:00')` se devuelven a sí mismos,
 * que es justo lo que ya hacía el código de más abajo con estas columnas.
 * Las hojas que no aparecen aquí son de puro texto y no necesitan nada. */
function esHora_(v){ return v && typeof v === 'object' && typeof v.getHours === 'function'; }
const NORMALIZA_HOJA = {
  CONFIG:   function(r){ if(esHora_(r.valor)) r.valor=ftime(r.valor); },   // solo si es Date: un valor de texto se truncaría
  FESTIVOS: function(r){ r.fecha=fdate(r.fecha); },
  TURNOS:   function(r){ r.entrada=ftime(r.entrada); r.salida=ftime(r.salida);
                         r.descanso_ini=ftime(r.descanso_ini); r.descanso_fin=ftime(r.descanso_fin); },
  PERSONAL: function(r){ r.fecha_ingreso=fdate(r.fecha_ingreso); r.fecha_retiro=fdate(r.fecha_retiro); }
};

function claveCache_(nombre, i){ return CACHE_PREFIJO+nombre+':'+i; }
function cacheLeer_(nombre){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return null;
  try{
    const c=CacheService.getScriptCache();
    const n=Number(c.get(claveCache_(nombre,'n')));
    if(!(n>=1)) return null;
    const claves=[]; for(let i=0;i<n;i++) claves.push(claveCache_(nombre,i));
    const partes=c.getAll(claves);
    let txt='';
    for(let j=0;j<n;j++){ const p=partes[claveCache_(nombre,j)]; if(p==null) return null; txt+=p; }
    return JSON.parse(txt);
  }catch(err){ return null; }   // ante cualquier duda (caché caído, JSON roto), se lee la hoja
}
function cacheGuardar_(nombre, filas){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return;
  try{
    const txt=JSON.stringify(filas), n=Math.ceil(txt.length/CACHE_TROZO)||1;
    if(n>CACHE_TROZOS_MAX) return;                        // hoja enorme: mejor leerla que trocearla
    const mapa={};
    for(let i=0;i<n;i++) mapa[claveCache_(nombre,i)]=txt.substr(i*CACHE_TROZO, CACHE_TROZO);
    const c=CacheService.getScriptCache();
    c.putAll(mapa, CACHE_TTL);
    c.put(claveCache_(nombre,'n'), String(n), CACHE_TTL);  // el contador va AL FINAL: sin él no se lee nada a medias
  }catch(err){}
}
function cacheBorrar_(nombre){
  if(!CACHE_ON || !HOJAS_CACHEABLES[nombre]) return;
  try{
    const c=CacheService.getScriptCache(), claves=[claveCache_(nombre,'n')];
    for(let i=0;i<CACHE_TROZOS_MAX;i++) claves.push(claveCache_(nombre,i));
    c.removeAll(claves);
  }catch(err){}
}
// Encabezados por hoja, para poder releerlas por nombre (el calentador del caché y, desde D102, los
// lectores acotados, que necesitan saber dónde cae la columna `fecha` sin cablear un número).
// Incluye TAMBIÉN las tres hojas vivas (ASISTENCIA/NOTAS_ASISTENCIA/EXTRAS_ADMIN): estar en este mapa
// no tiene nada que ver con ser cacheable — eso lo decide HOJAS_CACHEABLES, y ahí no están ni deben estar.
const HEADERS_DE_HOJA = {
  CONFIG:CONFIG_HEADERS, FESTIVOS:FESTIVOS_HEADERS, TURNOS:TURNOS_HEADERS, CAT_CC:CAT_CC_HEADERS,
  CAT_TRABAJADORES:CAT_TRABAJADORES_HEADERS, CAT_MOTIVOS:CAT_MOTIVOS_HEADERS,
  MOTIVOS_USADOS:MOTIVOS_USADOS_HEADERS, CC_USADOS:CC_USADOS_HEADERS,
  CUADRILLAS:CUADRILLAS_HEADERS, PERSONAL:PERSONAL_HEADERS,
  ASISTENCIA:ASISTENCIA_HEADERS, NOTAS_ASISTENCIA:NOTAS_ASISTENCIA_HEADERS, EXTRAS_ADMIN:EXTRAS_ADMIN_HEADERS
};

/* ---------- Calentador del caché (D99) ----------
 * El caché arregla la 2ª consulta en adelante, pero la PRIMERA del día seguía pagándolo todo: cachés
 * vacíos + contenedor de Apps Script frío. Este disparador por tiempo lo precalienta cada 30 min, así
 * la residente ya encuentra los catálogos listos al abrir la pantalla.
 * Fuerza la RELECTURA (invalida y vuelve a leer) en vez de conformarse con lo que haya: además de
 * renovar el TTL, hace que una edición A MANO en el Sheet se vea sola en ≤30 min, en vez de esperar
 * las 6 h. El botón "↻ Refrescar catálogos" sigue estando para cuando no se quiere esperar nada.
 * INSTALACIÓN (una vez, desde el editor de Apps Script): ejecutar `instalarCalentador`. Para quitarlo,
 * `quitarCalentador`. Coste: ~10 lecturas cada 30 min = 48 ejecuciones/día, muy por debajo de la cuota.
 */
function calentarCache(){
  const t0=Date.now(); let n=0;
  Object.keys(HOJAS_CACHEABLES).forEach(function(nombre){
    try{ invalidarHoja_(nombre); readSheet(nombre, HEADERS_DE_HOJA[nombre]); n++; }catch(err){}
  });
  Logger.log('calentarCache: '+n+' hoja(s) en '+(Date.now()-t0)+' ms');
  return n;
}
function instalarCalentador(){
  quitarCalentador();
  ScriptApp.newTrigger('calentarCache').timeBased().everyMinutes(30).create();
  return 'Calentador instalado: releerá los catálogos cada 30 minutos.';
}
function quitarCalentador(){
  let n=0;
  ScriptApp.getProjectTriggers().forEach(function(t){
    if(t.getHandlerFunction()==='calentarCache'){ ScriptApp.deleteTrigger(t); n++; }
  });
  return 'Calentador retirado ('+n+' disparador/es).';
}

// Borra TODO el caché de catálogos. Lo usan `?action=cache_reset` y `setupHojas`.
function cacheBorrarTodo_(){ Object.keys(HOJAS_CACHEABLES).forEach(function(n){ invalidarHoja_(n); }); }
function cacheReset(e){
  cacheBorrarTodo_();
  return json({ ok:true, msg:'Catálogos refrescados: la próxima consulta los relee del Sheet.',
                hojas:Object.keys(HOJAS_CACHEABLES) });
}

function getSheet(name, headers){
  const ss=ss_(); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  ensureCols_(sh, need);   // D93: ancho de grilla suficiente para los encabezados de esta hoja
  invalidarHoja_(name);    // D99: getSheet puede escribir encabezados y precede a toda escritura
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,need).setValues([headers]); return sh; }
  const cur=leerRango_(sh,1,1,1,need)[0];
  let diff=false; for(let i=0;i<need;i++){ if(String(cur[i]||'')!==headers[i]){ diff=true; break; } }
  if(diff) sh.getRange(1,1,1,need).setValues([headers]);
  return sh;
}
/**
 * D99 (Fase 2, punto 2) — lectura ACOTADA en vez de `getDataRange()`.
 * `getDataRange()` traía todas las columnas que tuviera la hoja, aunque el endpoint solo use las del
 * encabezado. Ahora se lee `getRange(1, 1, lastRow, nCols)` con `nCols` = columnas del encabezado,
 * topado al ancho real de la grilla para no salirse de rango en una hoja más angosta (ahí las
 * columnas que falten quedan `undefined`, exactamente igual que antes con `getDataRange`).
 */
function readSheet(name, headers){
  if(_memoHoja.hasOwnProperty(name)) return _memoHoja[name];   // memoria de esta ejecución (punto 1b)
  let filas = cacheLeer_(name);                                 // caché entre peticiones (punto 5)
  if(filas === null) filas = cacheGuardarYDevolver_(name, headers);
  _memoHoja[name]=filas;
  return filas;
}
function cacheGuardarYDevolver_(name, headers){
  const filas = leerHoja_(name, headers);
  cacheGuardar_(name, filas);
  return filas;
}
// Lectura cruda de la hoja + normalización de fechas/horas (ver NORMALIZA_HOJA).
function leerHoja_(name, headers){
  const sh=ss_().getSheetByName(name), out=[];
  const last = sh ? sh.getLastRow() : 0;
  if(sh && last>=2){
    const nCols = Math.min(headers ? headers.length : sh.getLastColumn(), sh.getMaxColumns());
    const v=leerRango_(sh,1,1,last,nCols), h=headers||v[0];
    const norm=NORMALIZA_HOJA[name];
    for(let i=1;i<v.length;i++){ const o={}; h.forEach((k,j)=>o[k]=v[i][j]); o._row=i+1; if(norm) norm(o); out.push(o); }
  }
  return out;
}
function norm(s){ return String(s==null?'':s).trim().toLowerCase(); }

/* ============ D102 — LECTURA EN DOS PASOS DE LAS HOJAS GRANDES (backlog 3.6 / 4.11) ============
 *
 * EL PROBLEMA. `ASISTENCIA` crece 1 fila por persona y por día: con 300 personas y ~26 días hábiles
 * son 5.200–7.800 filas/mes, 62.000–94.000 al año. Los endpoints acotados a una fecha leían la hoja
 * ENTERA y filtraban en memoria. Medido en banco con 300 personas × 60 días (17.760 filas), una sola
 * petición de `?action=asistencia` leía **301.937 celdas**; con un año de histórico, **1.308.320**.
 * Eso no se pone lento: revienta el tope de 6 minutos de Apps Script. D99 y D100 quitaron el coste
 * FIJO (una apertura del Spreadsheet, caché de catálogos) pero no bajaron una sola celda de las hojas
 * grandes, y es lo único que crece.
 *
 * EL DISEÑO. Dos pasos:
 *   1) Escaneo barato: se lee SOLO la columna `fecha` (1 de 17 columnas) y se anotan los NÚMEROS DE
 *      FILA cuya fecha cae en [desde, hasta], inclusive en ambos extremos (mismo criterio que el
 *      `consolidado` de D65). La normalización es `fdate` — el mismo helper de siempre, duck-typing,
 *      nunca `instanceof Date` ni `Utilities.formatDate` (D31). No se reimplementa nada.
 *   2) Traída acotada: esas filas se agrupan en BLOQUES CONTIGUOS (tolerando huecos de hasta
 *      GAP_TOLERANCIA filas: traer 5 filas de más sale mucho más barato que otra ida y vuelta al
 *      servicio de Sheets) y se trae un `getRange` por bloque. Después del `getValues` se vuelve a
 *      filtrar por fecha FILA A FILA, porque los huecos tolerados cuelan filas de otro día: el
 *      resultado NO puede depender del agrupamiento.
 *
 * EL FALLBACK es lo que garantiza que esto no pueda salir peor. Si la hoja es chica, si el rango es
 * largo, si el día quedó demasiado fragmentado o si habría que traer casi toda la hoja igual, se hace
 * la lectura completa de siempre (`readSheet`, con su caché y su memoria). El helper lo decide solo;
 * los endpoints no se enteran.
 *
 * LO ÚNICO QUE PUEDE LEER MÁS QUE ANTES, dicho sin adornos: si el fallback se dispara DESPUÉS del
 * escaneo (bloques o cobertura), esa petición paga la columna `fecha` de más = **+1/nCols ≈ +5,9 %**
 * sobre lo de hoy. Por eso las tres guardas baratas (hoja chica, rango largo, columna inexistente) van
 * ANTES de escanear: cubren el caso que de verdad ocurre — `?action=ausencias` con rangos largos, que
 * es donde el fallback está previsto que salte siempre. Con un rango ≤ MAX_BLOQUES días, que el
 * fallback salte post-escaneo exige una fragmentación que la simulación no produjo ni con un 60 % de
 * correcciones diarias (máximo medido: 7 bloques/día).
 */

// Huecos de hasta N filas se absorben dentro del mismo bloque en vez de abrir uno nuevo. Medido: con la
// hoja fragmentada por re-envíos, los bloques de un día quedan a miles de filas unos de otros, así que
// este número casi nunca decide nada; está por los huecos DE UNA O DOS FILAS (una persona quitada y
// vuelta a agregar). Coste máximo observado: 15 filas de más.
const GAP_TOLERANCIA = 5;
// Más bloques que esto ⇒ lectura completa. Cada bloque es una ida y vuelta a Sheets, y la lección de
// D99 es que el ida-y-vuelta FIJO es caro. Justificación del 12: simulando un año de operación con 8
// cuadrillas y el patrón real de reescritura (cada upsert reapila su bloque `fecha+cuadrilla` al final
// de la hoja), un día ocupa 1 bloque sin correcciones, 1,9 de media con un 10 % de correcciones
// diarias y **7 en el peor caso con un 60 %**. 12 deja 1,7× de margen sobre ese peor caso.
const MAX_BLOQUES = 12;
// Si habría que traer más de este porcentaje de la hoja, no compensa: se lee entera de una vez.
const UMBRAL_COBERTURA = 0.40;
// Por debajo de esta cantidad de filas de datos, el escaneo extra no se paga solo. Con 300 personas la
// hoja cruza este umbral en una semana de operación; por debajo, el comportamiento es EXACTAMENTE el
// de hoy (misma lectura, mismas celdas).
const MIN_FILAS_PARA_DOS_PASOS = 2000;

// Fallback: la lectura completa de siempre, con su caché y su memoria de ejecución, filtrada por fecha
// igual que lo hacían los endpoints antes de D102.
function leerCompletaPorFecha_(nombreHoja, headers, desde, hasta){
  return readSheet(nombreHoja, headers).filter(function(r){
    const f=fdate(r.fecha); return f>=desde && f<=hasta;
  });
}

/**
 * Lector acotado por fecha. `hasta` = `desde` para un solo día. Devuelve EXACTAMENTE los mismos
 * objetos que `readSheet(...).filter(por fecha)`: mismas claves, mismo `_row`, mismo orden de hoja.
 */
function leerFilasPorFecha_(nombreHoja, desdeISO, hastaISO){
  const headers = HEADERS_DE_HOJA[nombreHoja];
  const desde = fdate(desdeISO), hasta = fdate(hastaISO);
  const clave = nombreHoja+'|fecha|'+desde+'|'+hasta;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];

  // Si la hoja completa YA está en la memoria de esta ejecución, filtrar de ahí no cuesta una celda.
  if(_memoHoja.hasOwnProperty(nombreHoja))
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // Una hoja cacheable nunca se escanea: servirla del CacheService es más barato que cualquier lectura.
  // (Hoy no aplica —solo se llama sobre ASISTENCIA, que jamás se cachea—; es una guarda de futuro.)
  if(!headers || HOJAS_CACHEABLES[nombreHoja])
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers||HEADERS_DE_HOJA[nombreHoja], desde, hasta));

  const sh = ss_().getSheetByName(nombreHoja);
  if(!sh) return (_memoRango[clave] = []);
  const last = sh.getLastRow();
  if(last <= 1) return (_memoRango[clave] = []);        // hoja vacía: ni un getRange (guarda del §4.1)
  const nFilas = last - 1;
  const nCols  = Math.min(headers.length, sh.getMaxColumns());   // hoja más angosta ⇒ columnas `undefined`, igual que hoy
  const colFecha = headers.indexOf('fecha') + 1;                 // por NOMBRE, nunca un 3 cableado

  // --- Guardas de coste CERO (antes del escaneo, para no pagar la columna de más) ---
  if(colFecha < 1 || colFecha > nCols || nFilas < MIN_FILAS_PARA_DOS_PASOS)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));
  // Un rango de D días ocupa al menos D bloques salvo que haya días sin datos, así que con
  // D > MAX_BLOQUES el fallback es prácticamente seguro: mejor no escanear. Esto es lo que hace que
  // `?action=ausencias` con rangos largos lea exactamente lo mismo que antes, ni una celda más.
  if(diasEntre_(desde, hasta) > MAX_BLOQUES)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // --- Paso 1: escaneo de UNA sola columna ---
  const col = leerRango_(sh, 2, colFecha, nFilas, 1);
  const filasOk = [];
  for(let i=0;i<nFilas;i++){
    const f = fdate(col[i][0]);
    if(f>=desde && f<=hasta) filasOk.push(i+2);        // número de fila REAL de la hoja
  }
  if(!filasOk.length) return (_memoRango[clave] = []);  // día sin datos: cero bloques, cero lecturas más

  // --- Agrupación en bloques contiguos, tolerando huecos de hasta GAP_TOLERANCIA ---
  const bloques=[]; let ini=filasOk[0], prev=filasOk[0], traidas=0;
  for(let i=1;i<filasOk.length;i++){
    if(filasOk[i]-prev-1 > GAP_TOLERANCIA){ bloques.push([ini,prev]); traidas+=prev-ini+1; ini=filasOk[i]; }
    prev=filasOk[i];
  }
  bloques.push([ini,prev]); traidas+=prev-ini+1;

  // --- Fallback por fragmentación o por cobertura ---
  if(bloques.length > MAX_BLOQUES || traidas > nFilas*UMBRAL_COBERTURA)
    return (_memoRango[clave] = leerCompletaPorFecha_(nombreHoja, headers, desde, hasta));

  // --- Paso 2: un getValues por bloque, y RE-FILTRO por fecha fila a fila ---
  const out=[], norma=NORMALIZA_HOJA[nombreHoja];
  for(let b=0;b<bloques.length;b++){
    const desdeFila=bloques[b][0], n=bloques[b][1]-desdeFila+1;
    const v=leerRango_(sh, desdeFila, 1, n, nCols);
    for(let i=0;i<n;i++){
      const o={}; headers.forEach((k,j)=>o[k]=v[i][j]); o._row=desdeFila+i; if(norma) norma(o);
      const f=fdate(o.fecha);
      if(f>=desde && f<=hasta) out.push(o);            // los huecos tolerados cuelan filas de otro día
    }
  }
  return (_memoRango[clave] = out);
}

/* ============ D107 — ESCRITURA QUIRÚRGICA (backlog 4.11: la otra mitad de D102) ============
 *
 * EL PROBLEMA. D102 acotó las LECTURAS por fecha, pero dejó las escrituras intactas y lo dijo por
 * escrito: `guardarAsistencia` y `guardarIndividual` hacían `clearContents()` de TODA la hoja y la
 * reescribían entera. Con 17 columnas eso son **17·N celdas leídas + 17·N escritas por cada envío**:
 * ~306.000 + ~306.000 con 2,4 meses de histórico, ~1,3 M + 1,3 M con un año. Y no es un envío al día:
 * son ~11 cuadrillas MÁS cada clic de "Completar faltantes" y cada corrección del detalle — corregirle
 * la hora a UNA persona reescribía las 18.000 filas.
 *
 * EL DISEÑO, igual que el `enviar_data` de obra: en vez de reescribir, se BORRAN las filas que el
 * upsert tiene que pisar y se AÑADEN las nuevas al final.
 *   1) Localizar: se leen SOLO las columnas que deciden (fecha+cuadrilla, o fecha+codigo+cedula), en
 *      UN bloque contiguo. Son 3 y 5 de 17 columnas.
 *   2) Borrar: las filas se agrupan en tramos contiguos y cada tramo sale con UN `deleteRows`. El
 *      bloque de una cuadrilla se escribe junto, así que en la práctica es 1 llamada.
 *   3) Añadir: las nuevas al final, con `ensureRows_` (D93) delante.
 *
 * LO QUE NO CAMBIA — verificado punto por punto antes de tocar nada:
 *   · **Pisado D03.** Se borra exactamente el mismo conjunto que antes quedaba fuera del `keep`: el
 *     predicado es el mismo, solo que ahora decide sobre 3 columnas en vez de sobre las 17.
 *   · **Idempotencia offline D82.** Reenviar el mismo payload borra el bloque recién escrito y vuelve
 *     a escribir lo mismo. Sigue sin necesitar UUID ni dedupe, igual que antes.
 *   · **Orden de las filas.** Antes era `keep + nuevas` (las nuevas al final); ahora es exactamente lo
 *     mismo, porque borrar cierra el hueco y las nuevas van al final de la hoja.
 *   · **Compacidad.** `deleteRows` sube las filas de abajo, así que la hoja no queda con huecos y el
 *     agrupamiento por bloques de D102 sigue siendo tan eficiente como antes.
 *
 * LO QUE SÍ MEJORA DE PROPINA: la hoja deja de barajarse entera en cada envío. Editar el Sheet a mano
 * mientras alguien reporta deja de ser una ruleta (las filas ya no se mueven bajo el cursor).
 */

// Nº de filas de más que se toleran dentro de un mismo `deleteRows`. A diferencia de la LECTURA, aquí
// un hueco NO se puede absorber: borraríamos filas de otro día. Por eso los tramos son estrictamente
// contiguos y esta constante no existe. (Nota deliberada para quien venga a "optimizar" esto.)

/**
 * Localiza los números de fila REALES que cumplen un predicado, leyendo solo las columnas necesarias.
 * `campos` = nombres de columna del encabezado; se lee el bloque contiguo que las cubre a todas.
 * `pred(v)` recibe un objeto {campo: valor} y devuelve true si esa fila hay que borrarla.
 */
function localizarFilas_(sh, headers, campos, pred){
  const last=sh.getLastRow();
  if(last<=1) return [];
  const idx=campos.map(function(c){ return headers.indexOf(c); });
  if(idx.some(function(i){ return i<0; })) throw new Error('localizarFilas_: columna inexistente en '+campos.join(','));
  const desdeCol=Math.min.apply(null, idx)+1, hastaCol=Math.max.apply(null, idx)+1;
  const ancho=Math.min(hastaCol-desdeCol+1, sh.getMaxColumns()-desdeCol+1);
  const v=leerRango_(sh, 2, desdeCol, last-1, ancho);
  const out=[];
  for(let i=0;i<v.length;i++){
    const o={};
    // idx[k] es 0-based y desdeCol 1-based: el desplazamiento dentro del bloque leído es idx[k]-(desdeCol-1).
    for(let k=0;k<campos.length;k++) o[campos[k]]=v[i][idx[k]-desdeCol+1];
    if(pred(o)) out.push(i+2);            // número de fila real de la hoja
  }
  return out;
}

/**
 * Borra las filas indicadas agrupándolas en tramos CONTIGUOS, de abajo hacia arriba (si se borrara de
 * arriba hacia abajo, cada borrado correría los números de las siguientes). Devuelve cuántas borró.
 */
function borrarFilas_(sh, filas){
  if(!filas || !filas.length) return 0;
  const orden=filas.slice().sort(function(a,b){ return a-b; });
  const tramos=[]; let ini=orden[0], prev=orden[0];
  for(let i=1;i<orden.length;i++){
    if(orden[i]!==prev+1){ tramos.push([ini,prev]); ini=orden[i]; }
    prev=orden[i];
  }
  tramos.push([ini,prev]);
  for(let t=tramos.length-1;t>=0;t--) sh.deleteRows(tramos[t][0], tramos[t][1]-tramos[t][0]+1);
  return orden.length;
}

/** Añade filas al final de la hoja, con la guarda de capacidad de D93. */
function anexarFilas_(sh, filas, need){
  if(!filas.length) return;
  ensureRows_(sh, filas.length);
  sh.getRange(sh.getLastRow()+1, 1, filas.length, need).setValues(filas);
}

// Días de calendario que abarca [desde, hasta] (ambos inclusive), sin construir la lista. Aritmética
// con Date local (Bogotá no tiene DST), mismo patrón que `diasDelRango`. Rango vacío o inválido ⇒ 0.
function diasEntre_(desde, hasta){
  if(!desde || !hasta || hasta < desde) return 0;
  const a=String(desde).split('-'), b=String(hasta).split('-');
  const d1=new Date(Number(a[0]), Number(a[1])-1, Number(a[2]));
  const d2=new Date(Number(b[0]), Number(b[1])-1, Number(b[2]));
  return Math.round((d2-d1)/86400000)+1;
}

/**
 * D102 — lector acotado POR COLUMNAS (no por fecha), para los dos cruces que necesitan TODO el
 * histórico y por tanto no se pueden acotar por fecha sin cambiar el resultado:
 *   · `proyectoDefecto` del export (D94 / backlog 4.11) — cuadrilla(5), proyecto(11), presente(14)
 *   · los CC recientes por cuadrilla de `roster`          — timestamp(2), cuadrilla(5), cc(10)
 * Se lee el bloque contiguo mínimo que las cubre. Mismas FILAS y mismos CAMPOS que antes ⇒ mismo
 * resultado por construcción; lo único que cambia es que no se traen las columnas que nadie mira.
 * Memoria propia (`_memoRango`), NUNCA `_memoHoja`: esto tampoco es la hoja completa.
 */
function leerColumnasDeHoja_(nombreHoja, colIni, colFin){
  const headers = HEADERS_DE_HOJA[nombreHoja];
  const clave = nombreHoja+'|cols|'+colIni+'|'+colFin;
  if(_memoRango.hasOwnProperty(clave)) return _memoRango[clave];
  // Si la hoja completa ya está en memoria (o es cacheable), sale gratis de ahí.
  if(_memoHoja.hasOwnProperty(nombreHoja) || !headers || HOJAS_CACHEABLES[nombreHoja])
    return (_memoRango[clave] = readSheet(nombreHoja, headers||HEADERS_DE_HOJA[nombreHoja]));

  const sh = ss_().getSheetByName(nombreHoja);
  if(!sh) return (_memoRango[clave] = []);
  const last = sh.getLastRow();
  if(last <= 1) return (_memoRango[clave] = []);
  const maxCols = sh.getMaxColumns();
  if(colIni > maxCols) return (_memoRango[clave] = []);   // hoja más angosta que el bloque: nada que leer
  const fin = Math.min(colFin, headers.length, maxCols);
  const n = fin - colIni + 1;
  if(n < 1) return (_memoRango[clave] = []);
  const v = leerRango_(sh, 2, colIni, last-1, n);
  // Sin NORMALIZA_HOJA a propósito: un normalizador escribe claves por nombre y, sobre una REBANADA de
  // columnas, inventaría las que no vinieron (`o.fecha_ingreso=''`). Las únicas hojas que llegan aquí
  // son las tres vivas (no cacheables) y ninguna tiene normalizador; las cacheables salen antes por
  // `readSheet`, que sí lo aplica. Si algún día una hoja con normalizador necesita este lector, hay
  // que normalizar SOLO las columnas de la rebanada.
  const out=[];
  for(let i=0;i<v.length;i++){
    const o={};
    for(let j=0;j<n;j++) o[headers[colIni-1+j]] = v[i][j];
    o._row=i+2; out.push(o);
  }
  return (_memoRango[clave] = out);
}

/* ---------- área (D72 / D84) ---------- */
/* D121 — el administrador se llama `cesar`, no `admin`.
 * `admin` era a la vez NOMBRE DE USUARIO y ROL, y este módulo decide por NOMBRE (D119, §4.2 de
 * arquitectura). Al renombrar la fila de la hoja `USUARIOS` a `cesar`, cada `usuario==='admin'` de
 * aquí habría dejado de reconocerlo en silencio: seguiría entrando (el guard de pantalla mira el ROL,
 * que NO cambia) pero se quedaría sin cuadrillas que elegir y sin permiso para completar faltantes ni
 * gestionar personal. Por eso el nombre pasa por esta lista y no por un `===` suelto.
 * Se acepta TAMBIÉN `admin` a propósito, como con `alejo`/`alejandro` (§ `usuarioAliases`): el código y
 * la hoja privada `USUARIOS` se cambian por separado, así que la app funciona igual antes y después de
 * renombrar la fila. Cuando la fila ya diga `cesar`, `admin` deja de existir como login y el alias no
 * abre nada — para retirarlo basta borrarlo de este array. */
const ADMIN_USUARIOS = ['cesar','admin'];
function esAdmin_(usuario){ return ADMIN_USUARIOS.indexOf(norm(usuario)) >= 0; }

// Helper único de áreas por usuario (mismo criterio que el frontend, D84): devuelve el ARRAY de áreas
// que revisa un usuario. residente_odt/odl ven SOLO su área; residente_dren y duvan ven ['odt','odl'];
// el residente "general"/jeisson son de TIERRAS (D74b); admin devuelve [] = SIN filtro (ve todas).
//   residente_odt  -> ['odt']              residente_odl  -> ['odl']
//   residente_dren -> ['odt','odl']        duvan -> ['odt','odl']  (D88: solo asistencias)
//   residente/jeisson -> ['tierras']       admin `cesar` (u otro) -> []   (D121)
function areasDeUsuario(usuario){
  const u=norm(usuario);
  if(u==='residente_odt')  return ['odt'];
  if(u==='residente_odl')  return ['odl'];
  if(u==='residente_dren') return ['odt','odl'];   // D84: residente de drenajes unificado
  // D88: `duvan` = el jeisson de drenajes (asistencias de ODT+ODL y nada más). Mismo alcance de datos
  // que residente_dren en este módulo; lo que NO tiene es el panel/reporte de drenajes (eso va por rol
  // en el frontend, no por este helper).
  if(u==='duvan')          return ['odt','odl'];
  // D101: la residente de UF3 (proyecto 3703). UF3 es un ÁREA MÁS de este mismo módulo, no un sistema
  // aparte: reporta y revisa solo `uf3`, sin acceso a tierras ni a drenajes.
  if(u==='residente_uf3')  return ['uf3'];
  // D119: `angie` — la persona dedicada a asistencias de TM2 Sur (rol `asistencia_plus_tm2`). Es el
  // molde de `duvan` (D88) y `residente_uf3` (D101) pero con TRES áreas a la vez: revisa el resumen de
  // tierras y de drenajes, reporta cualquier cuadrilla activa de las tres y gestiona su personal.
  // UF3 (proyecto 3703) queda FUERA a propósito: la lleva `residente_uf3`. Sumarla algún día es
  // agregar `'uf3'` a este array y nada más.
  if(u==='angie')          return ['tierras','odt','odl'];
  if(u==='residente' || u==='jeisson') return ['tierras'];
  return [];   // admin (`cesar`, D121): sin filtro (puede filtrar por &area=)
}
// Áreas efectivas de una petición: las forzadas por el usuario; si NO tiene (admin), respeta un &area=
// de filtro. [] = sin filtro (admin sin &area). Los usuarios con área forzada no la pueden burlar.
// D116: `&area=` admite VARIAS áreas separadas por coma (`odt,odl`), para que el "Ver como" del admin
// pueda ver DRENAJES completo en una sola vista — lo que `residente_dren` ya veía por su rol (D84) y el
// admin solo podía mirar por separado. Un solo valor sigue funcionando igual (`odt` = `['odt']`), así
// que nada de lo existente cambia. Se valida contra la lista blanca y se deduplica: lo que no esté en
// ella se descarta, y si no queda ninguna válida se cae a [] = sin filtro (el admin ve todas).
const AREAS_VALIDAS = ['tierras','odt','odl','uf3'];   // D101: `uf3` entró en la lista blanca (D74b)
/* D119 — el `&area=` se INTERSECTA con las áreas forzadas, en vez de ignorarse cuando las hay.
 *
 * POR QUÉ. Hasta ahora el "Ver como" era exclusivo del admin: quien tenía área forzada por su rol veía
 * el parámetro descartado entero. Con `angie` (tres áreas) el resumen "todo junto" es ruidoso y el
 * filtro pasa a ser útil de verdad, así que hace falta un `&area=` que ACOTE sin poder AMPLIAR.
 *
 *   areasEfectivas = pedidas.length ? (pedidas ∩ forzadas) : forzadas
 *
 * La intersección solo puede DEVOLVER UN SUBCONJUNTO de lo que el rol ya autorizaba, así que no abre
 * nada: `&area=uf3` con forzadas ['tierras','odt','odl'] da intersección vacía y se ignora el parámetro
 * (se usan las forzadas) — nunca cae en "todas", que es el error que convertiría un filtro en un hueco.
 * Desde D109 esto es un cerrojo real: la identidad llega firmada y el backend la sobrescribe (doGet/
 * doPost), así que no depende de qué mande el cliente.
 *
 * REGRESIÓN CERO. Para `admin` (forzadas []) el camino es idéntico al de D116. Para los roles con área
 * forzada el resultado solo cambiaría si alguien les mandara `&area=`, y ninguno lo hace: el selector
 * se dibuja solo para el admin y para el rol nuevo (resumen-asistencia.html), y el resto de las
 * pantallas manda el parámetro vacío. Y si llegara, el efecto sería acotar dentro de su propia área,
 * nunca ver algo ajeno. */
function areasEfectivas(e){
  const forzadas=areasDeUsuario((e.parameter&&e.parameter.usuario)||'');
  const pedidas=String((e.parameter&&e.parameter.area)||'').split(',')
    .map(function(s){ return norm(s); })
    .filter(function(a,i,arr){ return AREAS_VALIDAS.indexOf(a)>=0 && arr.indexOf(a)===i; });
  if(!pedidas.length) return forzadas;          // sin filtro pedido: manda el rol ([] = admin, todas)
  if(!forzadas.length) return pedidas;          // admin: el filtro manda, exactamente como en D116
  const inter=pedidas.filter(function(a){ return forzadas.indexOf(a)>=0; });
  return inter.length ? inter : forzadas;       // intersección vacía = el parámetro se ignora
}
// ¿La cuadrilla `c` cae dentro de las áreas dadas? [] = sin filtro (todas). Compat con === anterior.
function cuadrillaEnAreas(c, areas, cuadArea){ return !areas.length || areas.indexOf(cuadArea[c]||'tierras')>=0; }
// D101 (regla D69h: validar en el BACKEND, no solo en el frontend): al ESCRIBIR asistencia, un usuario
// con área forzada por su rol solo puede tocar cuadrillas de su área. Quien no tiene área forzada
// (capataces, chequeadoras, mairy, admin) pasa sin restricción — exactamente como hasta ahora, así que
// no cambia nada para los canales existentes. Cierra el hueco de "&usuario= correcto + cuadrilla ajena".
function cuadrillaPermitidaPara(usuario, cuadrilla){
  const areas=areasDeUsuario(usuario);
  if(!areas.length) return true;
  return cuadrillaEnAreas(cuadrilla, areas, areaDeCuadrillaMap());
}
// Mapa cuadrilla -> área desde la hoja CUADRILLAS. Vacío o cuadrilla desconocida = 'tierras'.
function areaDeCuadrillaMap(){
  const m={}; readSheet('CUADRILLAS', CUADRILLAS_HEADERS).forEach(r=>{ m[r.cuadrilla]=norm(r.area)||'tierras'; });
  return m;
}
// D84: ¿la cuadrilla está activa? `estado` vacío = activa (retrocompatible); solo 'inactiva' la saca.
function cuadrillaActiva(r){ return norm(r.estado)!=='inactiva'; }
// Set con los NOMBRES de las cuadrillas inactivas (para filtrar rápido el roster esperado).
function cuadrillasInactivasSet(){
  const s={}; readSheet('CUADRILLAS', CUADRILLAS_HEADERS).forEach(r=>{ if(!cuadrillaActiva(r)) s[r.cuadrilla]=true; });
  return s;
}
// Área de quien REPORTA (para filtrar CC_USADOS): residente de UNA área por su rol; capataz/mairy por
// sus cuadrillas si todas son de la misma área. Mezcla, multi-área (residente_dren) o desconocido =
// '' (sin filtro: ve todas).
// D88: `roster` ya resuelve primero por `areasDeUsuario` (que sí soporta multi-área), así que este
// helper queda como el camino de quien NO tiene área forzada por su rol (capataces, mairy, admin);
// las dos primeras ramas se conservan por si alguien más lo llama.
function areaDeReportante(usuario){
  const porRol=areasDeUsuario(usuario);
  if(porRol.length===1) return porRol[0];   // residente_odt/odl, residente/jeisson (tierras)
  if(porRol.length>1)   return '';           // D84: residente_dren ve los CC de ambas áreas
  const cuads=cuadrillasDeUsuario(usuario), map=areaDeCuadrillaMap(); let a=null;
  for(let i=0;i<cuads.length;i++){ const ar=map[cuads[i]]||'tierras'; if(a===null) a=ar; else if(a!==ar) return ''; }
  return a===null ? '' : a;
}
// D72: CC que NO deben aparecer en el selector de bloques (supervisión del encargado/capataz, p. ej.
// `I010305 ENCARGADOS, INSPECTORES Y CAPATACES`) — confunde al reportar la actividad de la cuadrilla.
// Lista en CONFIG.cc_excluidos_bloque (coma-separada, por código); default `I010305`. Match por substring,
// así aplica a los dos proyectos (3701.I010305… y 3702.I010305…) y en TODAS las áreas.
function ccExcluidosBloque(){
  const raw=String(getConfigMap().cc_excluidos_bloque||'I010305');
  return raw.split(',').map(function(s){return s.trim();}).filter(Boolean);
}
function sinCCexcluidos(list){
  const ex=ccExcluidosBloque(); if(!ex.length) return list;
  return list.filter(function(cc){ const s=String(cc||''); for(var i=0;i<ex.length;i++){ if(ex[i] && s.indexOf(ex[i])>=0) return false; } return true; });
}
// Lee CC_USADOS y devuelve los string_cc que aplican al área dada. Empty en la hoja = tierras.
// D88: acepta un ÁREA ('odt') o un ARRAY de áreas (['odt','odl'], para residente_dren/duvan). '' o []
// = todas (admin y quien no tenga área forzada). Antes, multi-área caía en '' y mezclaba los CC de
// tierras en los "frecuentes"; ahora se limitan a las áreas del usuario (intención de D84).
function ccUsadosParaArea(area){
  const areas = Array.isArray(area) ? area.filter(Boolean) : (area ? [area] : []);
  const rows=readSheet('CC_USADOS', CC_USADOS_HEADERS);
  return sinCCexcluidos(rows.filter(r=> String(r.string_cc||'').trim() && (!areas.length || areas.indexOf(norm(r.area)||'tierras')>=0))
             .map(r=>String(r.string_cc).trim()));
}
// Motivos de ausencia (D78): el catálogo completo (CAT_MOTIVOS) es para quien revisa el resumen;
// el responsable de cuadrilla ve solo los frecuentes (MOTIVOS_USADOS). Hoja vacía = catálogo completo.
function motivosCatalogo(){ return readSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean); }
function motivosUsados(){
  const rows=readSheet('MOTIVOS_USADOS', MOTIVOS_USADOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean);
  return rows.length ? rows : motivosCatalogo();
}

/* ---------- roster date-aware (D72) ----------
 * Una persona "se esperaba" en `fecha` si ya había ingresado y aún no la habían retirado a esa fecha:
 *   [fecha_ingreso, fecha_retiro)  — el retiro cuenta como primer día NO trabajado.
 * Comparación de strings 'yyyy-MM-dd' (orden lexicográfico = cronológico). Sin fecha_retiro se cae al
 * `estado` actual (compat con filas viejas sin fechas). Si no llega `fecha`, no se filtra por ventana. */
function activaEnFecha(p, fecha){
  const ing=fdate(p.fecha_ingreso), ret=fdate(p.fecha_retiro);
  if(ing && fecha && fecha < ing) return false;   // aún no ingresaba ese día
  if(ret) return !(fecha && fecha >= ret);         // retiro con fecha: activa antes de esa fecha
  return String(p.estado||'activo')!=='inactivo';  // sin fecha de retiro: usa el estado actual
}
// D85: personal EVENTUAL (p. ej. el encargado Javier): trabaja solo en ocasiones puntuales (dom/fest),
// así que NO se le espera en el día a día — no aparece en el roster del responsable ni cuenta como
// faltante/sin-reportar — pero queda disponible en "Completar faltantes" del resumen para marcarlo
// presente cuando sí trabaja. Se marca escribiendo `estado = eventual` en su fila de PERSONAL (la
// columna ya existe; `activaEnFecha` lo trata como activo porque solo 'inactivo' desactiva).
function esEventual(p){ return norm(p.estado)==='eventual'; }

/* ============ D118 — UNA PERSONA, UNA FILA (causa raíz de los reportes duplicados) ============
 *
 * SÍNTOMA. El 01-ago-2026 el resumen de ODT mostró 7 personas con DOS filas en ASISTENCIA el mismo día,
 * todas en la MISMA cuadrilla (ENRIQUE) y del MISMO reportante (duvan), algunas con marcas
 * contradictorias (una ausente y otra presente).
 *
 * POR QUÉ NO PODÍA SER UN DOBLE ENVÍO. `guardarAsistencia` borra el bloque fecha+cuadrilla y anexa: un
 * segundo envío de la misma cuadrilla PISA al primero, nunca lo duplica (verificado en `borrarFilas_`,
 * que agrupa en tramos contiguos y los borra de abajo hacia arriba). Si quedan dos filas de la misma
 * persona en la misma cuadrilla, es que el ENVÍO YA TRAÍA DOS: el formulario se las mostró dos veces.
 *
 * LA RAÍZ. `roster` no deduplicaba: devolvía tal cual las filas de PERSONAL que pasaran el filtro. Y
 * nada impedía que la hoja tuviera dos filas ACTIVAS de la misma persona — `alta` hacía `appendRow` sin
 * mirar si ya existía, y `reingreso` (que crea fila nueva a propósito, para conservar el hueco de los
 * días inactivos) no comprobaba que la fila de origen estuviera realmente retirada. Con dos filas vivas,
 * el capataz veía a la persona dos veces, llenaba las dos y el día quedaba con horas duplicadas — que
 * el Parte de Navision se lleva tal cual, porque escribe una línea por fila.
 *
 * EL CIERRE (tres puntos, este helper es el primero):
 *   1. `roster` y el roster esperado de `asistenciaDia` deduplican por persona → el formulario ya no
 *      puede mostrar a nadie dos veces, ni los faltantes contar a nadie dos veces.
 *   2. `alta` rechaza un código/cédula que ya tenga fila activa; `reingreso` exige que la de origen esté
 *      retirada. Se cierra la puerta por la que entraban las filas gemelas.
 *   3. `diagnosticoPersonalDuplicado()` lista las que YA están en la hoja (mantenimiento a mano, mismo
 *      patrón que `diagnosticoFechasAsistencia` de D106). No borra nada: la fila que sobra la decide el
 *      usuario, porque cada una puede tener cuadrilla o fecha_ingreso distintas.
 *
 * Clave de persona: código si lo tiene, si no la cédula — la misma de `guardarIndividual.keyOf` y la de
 * los faltantes, así que "una persona" significa lo mismo en todo el módulo. */
function clavePersona_(p){
  const c=String((p&&p.codigo)||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String((p&&p.cedula)||'').trim());
}
// Primera fila de cada persona, conservando el orden de la hoja. Sin duplicados devuelve la misma lista.
function unicasPorPersona_(lista){
  const vistos={}, out=[];
  (lista||[]).forEach(function(p){
    const k=clavePersona_(p);
    if(k==='COD:' || k==='CED:'){ out.push(p); return; }   // sin código NI cédula: no se puede agrupar
    if(!vistos[k]){ vistos[k]=true; out.push(p); }
  });
  return out;
}

/* ---------- CONFIG / FESTIVOS ---------- */
function getConfigMap(){
  const rows=readSheet('CONFIG', CONFIG_HEADERS), m={};
  rows.forEach(r=>{
    if(!r.clave) return;
    let v=r.valor;
    // Sheets guarda las celdas de hora (entrada_lv, salida_lv, almuerzo_*, nocturno_*) como VALOR de
    // hora → Apps Script las lee como Date (base 1899-12-30) y saldrían como "1899-12-30T..." al JSON.
    // Las normalizamos a "HH:MM" por duck-typing (getHours), nunca instanceof Date (D31). Números y
    // strings (topes, strings de proyecto) pasan tal cual.
    if(v && typeof v==='object' && typeof v.getHours==='function') v=ftime(v);
    m[String(r.clave).trim()]=v;
  });
  return m;
}
function getFestivos(){
  return readSheet('FESTIVOS', FESTIVOS_HEADERS).map(r=>fdate(r.fecha)).filter(Boolean);
}
// Tipo de jornada del día: 'lv' (lunes-viernes) · 'sabado' · 'domfest' (domingo o festivo).
function tipoJornada(fecha, festivos){
  const d=String(fecha||'').split('-');
  if(d.length<3) return 'lv';
  const dt=new Date(Number(d[0]), Number(d[1])-1, Number(d[2]));
  const dow=dt.getDay(); // 0=domingo..6=sabado
  if((festivos||[]).indexOf(fecha)>=0) return 'domfest';
  if(dow===0) return 'domfest';
  if(dow===6) return 'sabado';
  return 'lv';
}
// Jornada estándar (entrada/salida por defecto + tope de ordinarias) según CONFIG y el tipo de día.
function jornadaDelDia(fecha, cfg, festivos){
  const tipo=tipoJornada(fecha, festivos);
  if(tipo==='sabado') return { tipo, entrada:cfg.entrada_sab||'07:00', salida:cfg.salida_sab||'11:30', tope:parseFloat(cfg.ord_sabado)||4.5 };
  // D77: domfest con horario típico pre-llenado (07:00–15:00; 8h − 1h almuerzo = 7h Dom/Fest, dueño
  // jul-2026). El tope ordinario L-V sigue en 0: esas horas van a la col D Dom/Fest, no a ordinarias.
  if(tipo==='domfest') return { tipo, entrada:cfg.entrada_dom||'07:00', salida:cfg.salida_dom||'15:00', tope:parseFloat(cfg.ord_domingo)||0 };
  return { tipo, entrada:cfg.entrada_lv||'07:00', salida:cfg.salida_lv||'15:30', tope:parseFloat(cfg.ord_lun_vie)||7.5 };
}
// D101: ya era GENÉRICO (toma los 4 primeros dígitos del CC, no compara contra una pareja fija), así
// que `3703.02.05| …` devuelve `3703` sin tocar nada. No listar proyectos válidos a mano.
function proyectoFromCC(cc){
  const s=String(cc||'').trim();
  const m=s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

/* ---------- routing ---------- */
function doGet(e){
  _t0 = Date.now();   // D99: siembra el cronómetro de servidor (`_ms` en la respuesta)
  const a=((e.parameter.action)||'').toLowerCase();
  // D109: puerta única. Aquí importa el doble que en obra, porque TODA la autorización de este módulo
  // (áreas, cuadrillas permitidas, quién puede completar faltantes) se derivaba del `usuario` que
  // mandaba el cliente. Ahora sale del token firmado y sobrescribe lo que venga en la petición.
  const ses=sesion_(e, null);
  if(!ses.ok) return json({ok:false, auth:false, error:ses.error});
  if(ses.usuario) e.parameter.usuario = ses.usuario;
  if(a==='roster')     return roster(e);
  if(a==='asistencia') return asistenciaDia(e);
  if(a==='personal')   return personalCompleto(e);
  if(a==='export')     return exportDia(e);
  if(a==='ausencias')  return ausenciasRango(e);   // D94: seguimiento de ausencias por rango
  if(a==='persona')    return horasPersona(e);     // D112: horas de UNA persona en un rango (solo lectura)
  // D99: refresco manual del caché de catálogos, para quien acaba de editar el Sheet a mano
  // (CAT_CC, CAT_MOTIVOS, CC_USADOS, CONFIG, TURNOS, `estado`/`area` de CUADRILLAS…).
  if(a==='cache_reset') return cacheReset(e);
  // EXTRAS_ADMIN (D73): registro del día para prefill/edición en mis-extras.html; `extras_admin_dia`
  // es alias (mismo handler) para el indicador del residente en resumen-asistencia.html.
  if(a==='extras_admin' || a==='extras_admin_dia') return extrasAdminDia(e);
  return json({ok:true, msg:'API Asistencias viva'});
}
function doPost(e){
  _t0 = Date.now();   // D99: cronómetro de servidor también en las escrituras
  try{
    const body=JSON.parse(e.postData.contents);
    // D109: identidad desde el token. Se sobrescriben `usuario` Y `reporta` porque en este módulo los
    // dos son el que está en sesión (el formulario manda su propio usuario en ambos) y de ellos
    // dependen `cuadrillaPermitidaPara` y el guard de "completar faltantes".
    const ses=sesion_(e, body);
    if(!ses.ok) return json({ok:false, auth:false, error:ses.error});
    if(ses.usuario){ body.usuario = ses.usuario; body.reporta = ses.usuario; }
    if(body.action==='reporte_asistencia')  return guardarAsistencia(body);
    if(body.action==='asistencia_individual') return guardarIndividual(body);
    if(body.action==='personal')            return gestionPersonal(body);
    if(body.action==='extras_admin')        return guardarExtrasAdmin(body);    // D73: upsert por fecha
    if(body.action==='extras_admin_delete') return borrarExtrasAdmin(body);     // D73: borra el día
    return json({ok:false, error:'acción no reconocida'});
  }catch(err){ return json({ok:false, error:String(err)}); }
}

/* ---------- CUADRILLAS: usuario -> cuadrillas que le corresponde reportar ---------- */
// alejo/alejandro: mismo capataz, dos nombres (login histórico = 'alejo'; la cuadrilla ALEJANDRO en
// CUADRILLAS puede llevar 'alejandro'). Se tratan como alias para que el match no dependa de cuál
// se haya usado (nota del prompt §3).
function usuarioAliases(u){
  if(u==='alejo' || u==='alejandro') return ['alejo','alejandro'];
  return [u];
}
function cuadrillasDeUsuario(usuario){
  const u=norm(usuario);
  // D84: las cuadrillas inactivas salen de circulación (no se ofrecen para reportar/seleccionar).
  const todas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(cuadrillaActiva);
  if(esAdmin_(u)) return todas.map(r=>r.cuadrilla); // admin (`cesar`, D121) elige cuadrilla (§3)
  // D88: `duvan` reporta la asistencia de TODA su área — igual que el admin (elige la cuadrilla en el
  // formulario), pero acotado a ODT+ODL por `areasDeUsuario`. No va por la columna `responsables`:
  // reporta por todos los capataces de drenajes, sea o no responsable de la cuadrilla.
  // D105: además tiene su PROPIA cuadrilla `DUVAN` (`area=odt`, responsable `duvan`) para la gente que
  // no cuelga de un capataz — el equivalente de `OPERADORES` para `jeisson`. Es solo una fila más en la
  // hoja CUADRILLAS: esta rama ya la devuelve por área (y la de `responsables` también la encontraría),
  // así que no hay nada que codificar. La gente la asigna él desde la gestión de personal del resumen.
  // D101: `residente_uf3` usa EXACTAMENTE la misma rama (acotada a `uf3` por areasDeUsuario). Hoy
  // ninguna cuadrilla de UF3 tiene capataz con login, así que ella reporta por todas. El día que los
  // haya, se agregan a `responsables` y los dos canales coexisten (el envío pisa fecha+cuadrilla, D03)
  // sin tocar una línea de código.
  // D119: `angie` entra en ESTA MISMA rama con sus tres áreas (tierras+ODT+ODL). Es el primer usuario
  // que mezcla tierras y drenajes en un solo selector; el `norm(r.area)||'tierras'` de aquí abajo ya
  // resuelve el caso de las cuadrillas de tierras cargadas con la columna `area` VACÍA (ANGEL,
  // ROBINSON, OPERADORES…), que sin esa normalización no le aparecerían ninguna.
  if(u==='duvan' || u==='residente_uf3' || u==='angie'){
    const suyas=areasDeUsuario(u);
    return todas.filter(r=> suyas.indexOf(norm(r.area)||'tierras')>=0).map(r=>r.cuadrilla);
  }
  const alias=usuarioAliases(u);
  return todas.filter(r=>{
    const lista=String(r.responsables||'').split(',').map(norm);
    return alias.some(a=>lista.indexOf(a)>=0);
  }).map(r=>r.cuadrilla);
}

/* ---------- GET roster: arma el formulario del responsable en una sola llamada ---------- */
function roster(e){
  const usuario=e.parameter.usuario||'';
  const cuadrillas=cuadrillasDeUsuario(usuario);
  const cfg=getConfigMap();
  const festivos=getFestivos();
  // D106: el roster es de solo lectura y abre el formulario del capataz, así que aquí NO se corta la
  // respuesta — una fecha inválida cae al día de hoy (mismo respaldo que ya existía para la ausente).
  const fecha=fdateValida_(e.parameter.fecha) || Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  const personalTodo=readSheet('PERSONAL', PERSONAL_HEADERS);
  // D72: roster date-aware — solo quien ya había ingresado y no estaba retirado a esa fecha.
  // D85: los eventuales no salen en el formulario del responsable (se marcan desde el resumen).
  // D118: deduplicado por persona. Si PERSONAL trae dos filas activas de la misma persona, el formulario
  // se la mostraba DOS veces al responsable y un solo envío escribía dos filas en ASISTENCIA — con horas
  // duplicadas en el Parte. Es la causa raíz de los reportes repetidos de ODT (ago-2026).
  const personas=unicasPorPersona_(personalTodo.filter(p=> activaEnFecha(p, fecha) && !esEventual(p) && cuadrillas.indexOf(p.cuadrilla)>=0))
    .map(p=>({ cedula:p.cedula||'', codigo:p.codigo||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }));
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D72: se excluye el CC de supervisión del encargado/capataz del picker de bloques (confunde al reportar).
  const catCC=sinCCexcluidos(readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean));
  // D72: CC frecuentes del área del reportante. D88: si el usuario tiene áreas FORZADAS por su rol
  // (residente/jeisson=tierras, residente_odt/odl, residente_dren y duvan=odt+odl) mandan esas; si no
  // (capataces, mairy, admin) se deriva de sus cuadrillas como hasta ahora.
  const areasRep=areasDeUsuario(usuario);
  const catCCUsados=ccUsadosParaArea(areasRep.length ? areasRep : areaDeReportante(usuario));
  const catMotivos=motivosUsados();   // D78: el responsable ve solo los motivos frecuentes (fallback: todos)
  // CC usados recientemente por cada cuadrilla (últimos 60 días de ASISTENCIA), más reciente primero.
  const recientesCC={};
  cuadrillas.forEach(c=>{ recientesCC[c]=[]; });
  // D102: este cruce mira TODO el histórico a propósito (el CC más reciente de una cuadrilla puede ser
  // de hace meses), así que NO se acota por fecha: acotarlo cambiaría el resultado. Sí se acota por
  // COLUMNAS — solo usa timestamp(2), cuadrilla(5) y cc(10), que caben en el bloque contiguo 2–10 =
  // 9 de 17 columnas. Mismas filas, mismo orden, mismos campos ⇒ mismo resultado, ~47 % menos celdas.
  const asis=leerColumnasDeHoja_('ASISTENCIA', 2, 10)
    .filter(r=> r.cc && cuadrillas.indexOf(r.cuadrilla)>=0)
    .sort((a,b)=> String(b.timestamp)<String(a.timestamp) ? -1 : 1);
  asis.forEach(r=>{
    const list=recientesCC[r.cuadrilla]; if(!list) return;
    if(list.indexOf(r.cc)<0 && list.length<10) list.push(r.cc);
  });
  // D72: turnos asignados (para pre-llenar entrada/salida en el formulario). Horas por duck-typing.
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // D101: `areas` = las áreas FORZADAS por el rol de quien reporta ([] = sin área forzada: capataces,
  // chequeadoras, mairy, admin). El formulario la necesita para NO caer al catálogo global `catCC`
  // —que es de tierras— cuando el área todavía no tiene sus CC cargados en CC_USADOS. Sin esto, la
  // residente de UF3 veía el selector con UF1/UF2 y a sus capataces les salía el CC con prefijo 3701.
  // D119: área de CADA cuadrilla ofrecida, para que el `<select>` del formulario pueda etiquetarlas
  // (`ANGEL — Tierras` / `JAIRO — ODL`). Hasta ahora nadie mezclaba tierras y drenajes, así que la lista
  // plana bastaba; `angie` ve ~10 cuadrillas con nombre de persona de tres áreas distintas y sin la
  // etiqueta un error de tecleo es cuestión de tiempo. Campo ADITIVO: quien no lo lea sigue igual.
  const cuadArea=areaDeCuadrillaMap(), cuadrillasArea={};
  cuadrillas.forEach(function(c){ cuadrillasArea[c]=cuadArea[c]||'tierras'; });
  return json({ ok:true, cuadrillas, cuadrillasArea, personas, config:cfg, festivos, jornada, catCC, catCCUsados, catMotivos, recientesCC, turnos,
    areas:areasDeUsuario(usuario) });
}

/* ---------- GET asistencia: resumen del día para el residente/jeisson ---------- */
function asistenciaDia(e){
  // D106: sin fecha válida NO se contesta. Antes, `fecha=''` hacía que el lector por rango devolviera
  // justo las filas con la fecha en blanco (`f>='' && f<=''` solo se cumple con `f===''`): el resumen
  // mostraba las huérfanas como si fueran el día pedido y "Completar faltantes" las reescribía otra
  // vez sin fecha. Cortar aquí es lo que rompe ese círculo.
  const fecha=fdateValida_(e.parameter.fecha);
  if(!fecha) return json({ok:false, error:'Falta la fecha del resumen (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".'});
  // D72/D74b/D84: se limita todo (filas, cuadrillas, faltantes) a las áreas del usuario (tierras/odt/odl,
  // o ambas para residente_dren); el admin ve todas o filtra por &area=. Un residente de área/tierras no
  // puede burlar su alcance.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  // Las filas YA reportadas NO se filtran por estado de la cuadrilla (D84): una cuadrilla inactivada
  // hoy debe seguir mostrando sus filas de fechas anteriores. El filtro de inactivas aplica solo al
  // ROSTER ESPERADO (cuadrillasCat / personalActivo → estado y faltantes).
  // D102: lectura ACOTADA al día (escaneo de la columna `fecha` + solo los bloques de filas de ese día).
  // El helper cae solo a la lectura completa de siempre si la hoja es chica o el día quedó demasiado
  // fragmentado, así que el filtro por fecha ya viene aplicado y este `filter` solo mira el área.
  const filas=leerFilasPorFecha_('ASISTENCIA', fecha, fecha).filter(r=> enArea(r.cuadrilla))
    .map(r=>({ id_registro:r.id_registro, timestamp:r.timestamp, fecha:fdate(r.fecha), reporta:r.reporta,
      cuadrilla:r.cuadrilla, codigo:r.codigo, cedula:r.cedula, nombre:r.nombre, cargo:r.cargo, cc:r.cc,
      proyecto:r.proyecto, hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente, motivo_ausencia:r.motivo_ausencia, observacion:r.observacion, turno:String(r.turno||'') }));
  // D84: la lista de cuadrillas del resumen incluye las ACTIVAS (roster de hoy) MÁS cualquier inactiva
  // que TENGA filas reportadas en esa fecha — así una cuadrilla desactivada hoy sigue mostrando su
  // detalle (y su estado "reportó") en fechas anteriores, sin ensuciar el roster de hoy (el filtro de
  // inactivas aplica al roster esperado, no a lo ya reportado).
  const cuadConFilas={}; filas.forEach(f=>{ cuadConFilas[f.cuadrilla]=true; });
  const cuadrillasCat=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(cq=>enArea(cq.cuadrilla) && (cuadrillaActiva(cq) || cuadConFilas[cq.cuadrilla]));
  // D72: roster date-aware + por área — "se esperaba" a esta persona en ESA fecha (no la foto de hoy).
  // D84: excluye a la gente de cuadrillas inactivas del roster esperado (no de las filas reportadas).
  // D85: excluye a los eventuales del roster esperado (nunca cuentan como faltantes/sin-reportar).
  const inactivas=cuadrillasInactivasSet();
  const personalTodo=readSheet('PERSONAL', PERSONAL_HEADERS);
  // D118: mismo deduplicado que el roster. Sin él, una persona con dos filas en PERSONAL salía DOS veces
  // en `faltantes` y el resumen la contaba dos veces como ausente o como sin-reportar.
  const personalActivo=unicasPorPersona_(personalTodo.filter(p=>activaEnFecha(p, fecha) && !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]));
  // D85: personal eventual del área revisada — disponible en "Completar faltantes" del resumen (para
  // marcarlo presente los dom/fest u ocasiones puntuales) SIN aparecer como faltante. El frontend lo
  // ofrece solo si aún no tiene fila reportada ese día.
  const eventuales=personalTodo.filter(p=>esEventual(p) && activaEnFecha(p, fecha) && enArea(p.cuadrilla))
    .map(p=>({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }));
  // Una fila cuenta como REPORTE COMPLETO solo si: ausente con motivo, o presente CON centro de costo.
  // Presente SIN CC (el capataz la dejó pasar sin actividad) = como si NO se hubiera reportado
  // (decisión del residente, jul-2026): NO cuenta presente y va a faltantes para completarla.
  function filaValida(f){ return f.presente==='No' || (f.presente==='Si' && !!String(f.cc||'').trim()); }
  const codigosReportados={}, incompletos={};
  filas.forEach(f=>{
    const k=f.codigo||('CED:'+f.cedula);
    if(filaValida(f)) codigosReportados[k]=f;
    else if(f.presente==='Si') incompletos[k]=f;   // presente sin CC = incompleto (no reportado)
  });

  const cuadrillasEstado=cuadrillasCat.map(cq=>{
    const filasCuad=filas.filter(f=>f.cuadrilla===cq.cuadrilla && filaValida(f));
    return {
      cuadrilla:cq.cuadrilla, responsables:cq.responsables||'',
      reporto: filasCuad.length>0,
      reporta: filasCuad.length? filasCuad[0].reporta : '',
      hora: filasCuad.length? filasCuad[0].timestamp : '',
      total: filasCuad.length
    };
  });

  const faltantes=[];
  personalActivo.forEach(p=>{
    const k=p.codigo||('CED:'+p.cedula);
    const reg=codigosReportados[k];
    if(reg){
      if(reg.presente==='No'){
        faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
          cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'ausente', motivo:reg.motivo_ausencia||'' });
      }
      // presente CON CC = reportado OK, no es faltante
    } else {
      // sin fila válida: nunca reportó, o quedó presente sin CC (incompleto). Ambos = por completar.
      faltantes.push({ codigo:p.codigo||'', cedula:p.cedula||'', nombre:p.nombre||'', cargo:p.cargo||'',
        cuadrilla:p.cuadrilla||'', responsable:p.responsable||'', tipo:'sin_reportar', incompleto: !!incompletos[k] });
    }
  });

  // Catálogos para la mini-interfaz de "completar faltantes" del residente/jeisson (CC, motivos,
  // jornada por defecto del día). Así el resumen puede armar el formulario rápido sin otra llamada.
  const cfg=getConfigMap();
  const festivos=getFestivos();
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  // D78: quien accede al RESUMEN ve los catálogos COMPLETOS — todos los CC (catCC, sin exclusiones)
  // y todos los motivos de ausencia (CAT_MOTIVOS completo) — para poder registrar uno especial.
  // catCCUsados sigue siendo el subconjunto frecuente del área revisada: el frontend lo muestra primero.
  const catCC=readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean);
  // D72/D84: CC frecuentes del área revisada. D88: con varias áreas (residente_dren/duvan) se pasan
  // TODAS las suyas (antes caía en '' y mezclaba tierras); sin filtro (admin) sigue mostrando todos.
  const catCCUsados=ccUsadosParaArea(areas);
  const catMotivos=motivosCatalogo();
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // D73/D84: indicador de extras del admin del día. Son CC de TIERRAS: se muestran solo si la vista
  // incluye tierras (residente/jeisson) o no filtra (admin). ODT/ODL y residente_dren NO las ven.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? extrasAdminDelDia(fecha) : [];
  const notas = notasDelDia(fecha).filter(n=>enArea(n.cuadrilla));   // D74: notas del día del área revisada
  // D76: config + festivos también en el resumen, para que el detalle por cuadrilla clasifique ordinarias/
  // extras EXACTO como el Parte de Navision (mismo clasificarHoras que el export), sin otra llamada.
  // D101: `areas` (las forzadas por el rol; [] = admin sin filtro) para que el resumen no ofrezca los
  // proyectos ni los CC de otra área cuando CC_USADOS del área revisada aún está vacía.
  return json({ ok:true, fecha, filas, cuadrillas:cuadrillasEstado, faltantes, eventuales, jornada, catCC, catCCUsados, catMotivos, turnos, extrasAdmin, notas, config:cfg, festivos,
    areas });
}

/* ---------- POST asistencia_individual: upsert por PERSONA (residente/jeisson completan faltantes) ----------
 * A diferencia de reporte_asistencia (que PISA toda la cuadrilla, D03), este upsert toca SOLO las
 * personas que llegan en `filas`: borra la fila de ESE día de cada persona entrante (si existía) y
 * la reescribe. Así el residente/jeisson pueden agregar faltantes o corregir un presente-sin-CC sin
 * borrar lo que ya reportó el responsable. Permitido a residente, admin y jeisson. */
function guardarIndividual(body){
  const usuario=norm(body.usuario);
  // D72/D84: los residentes de área (odt/odl) y el unificado (residente_dren) también completan faltantes.
  // D88: `duvan` (asistencias de drenajes) igual, acotado a ODT+ODL por areasDeUsuario.
  // D101: `residente_uf3` completa los faltantes de UF3 (acotado a ['uf3'] por areasDeUsuario).
  // D119: `angie` igual, acotada a tierras+ODT+ODL. El cerrojo de área de más abajo
  // (`cuadrillaPermitidaPara`) es el que le impide tocar una cuadrilla de UF3.
  // D121: el admin entra por `esAdmin_` (su usuario pasó de `admin` a `cesar`).
  if(!esAdmin_(usuario) && ['residente','jeisson','duvan','residente_uf3','angie','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado para completar faltantes.'});
  // D106: portero de fecha ANTES de tocar la hoja. Con la fecha vacía este upsert no solo escribía
  // filas huérfanas: su filtro de abajo (`fdate(r[2])===fecha`) borraba las huérfanas que ya hubiera.
  const fecha=fdateValida_(body.fecha), ts=new Date();
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  // D101: mismo cerrojo de área que reporte_asistencia — el "completar faltantes" tampoco puede tocar
  // cuadrillas de otra área (D69h). Se valida cada fila porque este upsert es por persona.
  const ajena=(body.filas||[]).map(f=>String(f.cuadrilla||'')).filter(function(c,i,a){ return a.indexOf(c)===i; })
    .filter(function(c){ return !cuadrillaPermitidaPara(usuario, c); });
  if(ajena.length) return json({ok:false, error:'Esa cuadrilla no es de tu área: '+ajena.join(', ')});
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS), need=ASISTENCIA_HEADERS.length;
  /* D119 — LA EDICIÓN NUNCA DEBE AÑADIR UNA FILA NUEVA. Este upsert borraba la fila vieja buscándola con
   * una clave de precedencia EXCLUSIVA (código; y solo si no había código, cédula). Si el mismo humano
   * estaba guardado con el código vacío y la edición traía el código —o al revés, o con un cero a la
   * izquierda—, las dos claves no coincidían: el borrado no encontraba nada y `anexarFilas_` agregaba la
   * fila igual. Resultado: corregirle la hora a alguien lo DUPLICABA en vez de reemplazarlo, y de ahí
   * salían las horas repetidas en el Parte de Navision. Reproducido en `backend/pruebas/`.
   *
   * Por qué las dos partes pueden no coincidir: la fila guardada trae el código que tenía PERSONAL
   * cuando el capataz reportó, mientras que "Completar faltantes" manda el que tiene PERSONAL AHORA. Si
   * entre medias se le llenó o corrigió el código a esa persona, la vieja y la nueva dejan de casar.
   *
   * Ahora se borra por CUALQUIERA de los dos identificadores: una fila del día se va si su código o su
   * cédula está entre los entrantes. Los valores VACÍOS nunca emparejan (si no, una fila sin código ni
   * cédula arrastraría a todas las demás). Es deliberadamente más ancho que antes: ante dos filas que
   * puedan ser la misma persona, la operación correcta es dejar UNA — que es lo que el usuario pidió al
   * darle a Guardar. */
  const incoming=body.filas||[], codsIn={}, cedsIn={}, nomsIn={};
  // Respaldo para quien no tenga NI código NI cédula: nombre+cuadrilla. Antes esas filas emparejaban
  // todas entre sí (la clave les quedaba en el literal 'CED:'), así que corregir a una de ellas borraba
  // a TODAS las demás sin identificador — pérdida silenciosa, peor que el duplicado.
  function claveNombre_(o){
    const n=norm(o&&o.nombre), c=norm(o&&o.cuadrilla);
    return n ? (n+'|'+c) : '';
  }
  incoming.forEach(function(f){
    const c=String(f.codigo||'').trim(), d=String(f.cedula||'').trim();
    if(c) codsIn[c]=true;
    if(d) cedsIn[d]=true;
    if(!c && !d){ const n=claveNombre_(f); if(n) nomsIn[n]=true; }
  });
  function esDeLosEntrantes(o){
    const c=String(o.codigo||'').trim(), d=String(o.cedula||'').trim();
    if((!!c && !!codsIn[c]) || (!!d && !!cedsIn[d])) return true;
    if(!c && !d){ const n=claveNombre_(o); return !!n && !!nomsIn[n]; }
    return false;
  }
  const nuevas=incoming.map(f=>[
    Utilities.getUuid(), ts, fecha, body.reporta||usuario, f.cuadrilla||'', f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    (f.presente===false||f.presente==='No')?'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  // D107: se borra la fila de ESE día SOLO de las personas entrantes y se anexan las nuevas al final.
  // Se decide leyendo 5 columnas (fecha·codigo·cedula caen en el bloque 3–7) en vez de las 17.
  // D119: el predicado ahora empareja por código O por cédula (ver arriba), no por una clave única.
  // `nombre` y `cuadrilla` entran al bloque leído (cols 3–8 en vez de 3–7) para el respaldo de arriba:
  // una columna más, muy lejos de las 17 que se leían antes de D107.
  const aBorrar=localizarFilas_(sh, ASISTENCIA_HEADERS, ['fecha','cuadrilla','codigo','cedula','nombre'], function(o){
    return fdate(o.fecha)===fecha && esDeLosEntrantes(o);
  });
  borrarFilas_(sh, aBorrar);
  anexarFilas_(sh, nuevas, need);
  invalidarHoja_('ASISTENCIA');   // D99: la memoria de esta ejecución ya no refleja la hoja
  // D119: `reemplazadas` deja ver que la edición SUSTITUYÓ y no añadió. Con 1 fila entrante, un 0 aquí
  // significa que la persona no estaba en el día (alta legítima desde "Completar faltantes"); un 2+
  // significa que venía duplicada de antes y esta operación la dejó en una sola.
  return json({ok:true, filas:nuevas.length, reemplazadas:aBorrar.length});
}

/* ---------- GET personal: gestión (residente general/admin ven todo; residente_odt/odl SOLO su área — D72) ---------- */
function personalCompleto(e){
  // D72/D84: residente/jeisson=tierras, odt/odl su área, residente_dren=ambas, admin todo o filtra por &area=
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS).filter(p=>enArea(p.cuadrilla)).map(p=>({ _row:p._row, cedula:p.cedula||'', codigo:p.codigo||'',
    nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'', responsable:p.responsable||'',
    estado:p.estado||'activo', fecha_retiro:fdate(p.fecha_retiro), fecha_ingreso:fdate(p.fecha_ingreso) }));
  // D84: los SELECTORES de cuadrilla (destinos de alta/mover) excluyen las inactivas.
  const cuadrillas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(c=>enArea(c.cuadrilla) && cuadrillaActiva(c)).map(c=>({ cuadrilla:c.cuadrilla||'', responsables:c.responsables||'' }));
  return json({ ok:true, personal, cuadrillas });
}

/* ---------- GET export: crudo del día completo para el generador Navision (cliente, SheetJS) ---------- */
function exportDia(e){
  // D106: igual que `asistenciaDia` — un Parte de Navision armado sobre las filas sin fecha sería un
  // archivo con gente de días revueltos. Mejor no entregar nada y decir por qué.
  const fecha=fdateValida_(e.parameter.fecha);
  if(!fecha) return json({ok:false, error:'Falta la fecha del día a exportar (o llegó con un formato que no se entiende). Elige el día en el campo "Fecha".'});
  // D72/D74b/D84: residente(tierras)/residente_odt/odl exportan SOLO su área; residente_dren exporta
  // ODT+ODL en un SOLO archivo (el Parte se arma por día×proyecto y los CC ya distinguen el capítulo,
  // así que mezclar áreas no requiere lógica extra); el admin todo o filtra por &area=. Las filas ya
  // reportadas NO se filtran por estado de cuadrilla (D84): una cuadrilla inactivada hoy sigue
  // exportando sus filas de fechas anteriores.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  const filas=leerFilasPorFecha_('ASISTENCIA', fecha, fecha).filter(r=> enArea(r.cuadrilla))   // D102
    .map(r=>({ codigo:r.codigo||'', cedula:r.cedula||'', nombre:r.nombre||'', cargo:r.cargo||'',
      cuadrilla:r.cuadrilla||'', cc:r.cc||'', proyecto:String(r.proyecto||''),
      hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente||'Si', motivo_ausencia:r.motivo_ausencia||'', turno:String(r.turno||''), fecha:fdate(r.fecha) }));
  // proyecto_defecto por cuadrilla: proyecto MÁS FRECUENTE históricamente (para ausentes, que no llevan CC).
  // D102 / backlog 4.11: este cruce lee TODO el histórico y así se queda — es un agregado global, no se
  // puede acotar por fecha sin cambiar lo que devuelve, y D94/4.11 lo marcan como intocable. Lo que sí
  // se acota es el ANCHO: solo usa cuadrilla(5), proyecto(11) y presente(14), que caben en el bloque
  // contiguo 5–14 = 10 de 17 columnas. Mismas filas, mismos campos ⇒ mismo `proyectoDefecto`, ~41 % menos celdas.
  const historico=leerColumnasDeHoja_('ASISTENCIA', 5, 14).filter(r=> r.presente==='Si' && r.proyecto);
  const conteo={}; // cuadrilla -> {proyecto:n}
  historico.forEach(r=>{ const c=r.cuadrilla||''; conteo[c]=conteo[c]||{}; conteo[c][r.proyecto]=(conteo[c][r.proyecto]||0)+1; });
  const proyectoDefecto={};
  Object.keys(conteo).forEach(c=>{
    let best='', bestN=-1;
    Object.keys(conteo[c]).forEach(p=>{ if(conteo[c][p]>bestN){ bestN=conteo[c][p]; best=p; } });
    proyectoDefecto[c]=best;
  });
  const catTrabRows=readSheet('CAT_TRABAJADORES', CAT_TRABAJADORES_HEADERS);
  const catTrabajadores={}; catTrabRows.forEach(r=>{ if(r.codigo) catTrabajadores[String(r.codigo).trim()]=r.string_navision; });
  // D72: catálogo de turnos, para que el export calcule ordinarias/extras según la jornada programada.
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // EXTRAS_ADMIN (D73): registros del admin del día para que el generador Navision inyecte su fila por
  // día×proyecto. Son CC de TIERRAS (3701/3702): solo se incluyen si la vista abarca tierras (residente
  // general/admin); un residente de área (odt/odl) o el unificado (residente_dren) NO las reciben.
  const verExtras = !areas.length || areas.indexOf('tierras')>=0;
  const extrasAdmin = verExtras ? extrasAdminDelDia(fecha) : [];   // D74b/D84
  return json({ ok:true, fecha, filas, proyectoDefecto, catTrabajadores, config:getConfigMap(), festivos:getFestivos(), turnos, extrasAdmin });
}

/* ---------- GET ausencias: seguimiento de ausencias por RANGO de fechas (D94) ----------
 * Para el seguimiento del personal: "de tal fecha a tal fecha, quién faltó y por qué motivo".
 * Devuelve DOS listas, ambas ya acotadas al área del usuario (mismo criterio que el resumen del día):
 *   - `filas`       : ausencias REPORTADAS (presente='No'), con su motivo verbatim. Es lo que se filtra
 *                     por motivo en el frontend. Sin motivo escrito -> '(sin motivo)'.
 *   - `sinReportar` : días en que la CUADRILLA sí reportó pero a la persona no la incluyeron (ni presente
 *                     ni ausente). No es una ausencia confirmada, pero es un hueco de seguimiento; el
 *                     frontend lo suma solo si se pide (checkbox). Se excluyen los domingos/festivos
 *                     (D81: ese día trabaja solo el personal disponible, casi todos quedan sin reportar
 *                     por diseño) y los días en que la cuadrilla NO reportó nada (no se puede concluir).
 * Roster date-aware (D72) y eventuales fuera (D85), igual que los faltantes del día.
 * Solo lectura: no escribe nada. */
const MAX_DIAS_RANGO = 186;   // ~6 meses: tope defensivo para no reventar el tiempo de Apps Script

// Lista de fechas 'yyyy-MM-dd' entre desde y hasta (inclusive). Aritmética con Date local (Bogotá no
// tiene DST); el formateo es el mismo patrón de fdate, nunca toISOString (D50).
function diasDelRango(desde, hasta){
  const p=String(desde).split('-'), out=[];
  let d=new Date(Number(p[0]), Number(p[1])-1, Number(p[2])), guard=0;
  while(guard++ <= MAX_DIAS_RANGO+1){
    const s=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    if(s>hasta) break;
    out.push(s);
    d.setDate(d.getDate()+1);
  }
  return out;
}
// Clave de persona: código si lo tiene, si no la cédula (mismo criterio que faltantes/guardarIndividual).
function keyPersona(codigo, cedula){
  const c=String(codigo||'').trim();
  return c ? ('COD:'+c) : ('CED:'+String(cedula||'').trim());
}
function ausenciasRango(e){
  const desde=fdateValida_(e.parameter.desde), hasta=fdateValida_(e.parameter.hasta);   // D106
  if(!desde || !hasta) return json({ok:false, error:'Faltan las fechas del rango (desde/hasta), o llegaron con un formato que no se entiende.'});
  if(hasta < desde)    return json({ok:false, error:'El rango está invertido: "hasta" es anterior a "desde".'});
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json({ok:false, error:'Rango demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.'});

  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };

  // Filas del rango (todas las áreas del usuario). Las YA reportadas no se filtran por estado de
  // cuadrilla (D84): una cuadrilla inactivada hoy conserva su histórico.
  // D102: lectura acotada al RANGO. Con rangos de más de MAX_BLOQUES días el helper ni escanea: se va
  // derecho a la lectura completa de siempre (un rango largo cubre casi toda la hoja, no hay nada que
  // ganar). Es correcto que el fallback salte aquí seguido; el endpoint no se entera.
  const enRango=leerFilasPorFecha_('ASISTENCIA', desde, hasta).filter(function(r){
    return enArea(r.cuadrilla);
  });

  const filas=enRango.filter(r=> String(r.presente||'')==='No').map(r=>({
    fecha:fdate(r.fecha), codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
    cargo:String(r.cargo||''), cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''),
    motivo: String(r.motivo_ausencia||'').trim() || '(sin motivo)', tipo:'ausente'
  }));

  // Huecos: la cuadrilla reportó ese día pero la persona no salió en el reporte.
  const festivos=getFestivos();
  const repDia={}, cuadRepDia={};
  enRango.forEach(function(r){
    const f=fdate(r.fecha), c=String(r.cuadrilla||'');
    (repDia[f]=repDia[f]||{})[keyPersona(r.codigo, r.cedula)]=true;
    (cuadRepDia[f]=cuadRepDia[f]||{})[c]=true;
  });
  const inactivas=cuadrillasInactivasSet();
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS)
    .filter(p=> !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]);
  const sinReportar=[];
  dias.forEach(function(f){
    if(tipoJornada(f, festivos)==='domfest') return;          // D81: dom/fest no se reporta por roster
    const rep=repDia[f]||{}, cuadOk=cuadRepDia[f]||{};
    personal.forEach(function(p){
      if(!cuadOk[String(p.cuadrilla||'')]) return;             // la cuadrilla no reportó: nada que concluir
      if(!activaEnFecha(p, f)) return;                          // aún no ingresaba / ya estaba retirada
      if(rep[keyPersona(p.codigo, p.cedula)]) return;            // sí salió en el reporte de ese día
      sinReportar.push({ fecha:f, codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
        cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), reporta:'', motivo:'(no reportado)', tipo:'sin_reportar' });
    });
  });

  return json({ ok:true, desde, hasta, dias:dias.length, filas, sinReportar, catMotivos:motivosCatalogo() });
}

/* ---------- GET persona: horas de UNA persona en un RANGO (D112) ----------
 * `?action=persona&codigo=&cedula=&desde=&hasta=` — **solo lectura, no escribe nada.**
 *
 * PARA QUÉ. Es la vista INVERSA del resumen: el resumen está armado por DÍA (un día × todas las
 * cuadrillas), así que para reconstruir el mes de una persona —lo que hace falta cuando alguien
 * reclama por lo que le pagaron— había que abrir 26 días uno por uno. Esto devuelve de una vez sus
 * filas del período.
 *
 * REGLA DE ORO: aquí NO se clasifican horas. Se devuelven las filas CRUDAS de `ASISTENCIA` más
 * `config`, `festivos` y `turnos`, igual que `exportDia`, y la clasificación la hace el cliente con el
 * MISMO `horas-nomina.js` que genera el Parte de Navision. Es lo que garantiza que la pantalla de
 * reclamos y el archivo que se importa a Navision no puedan discrepar: no hay dos cálculos.
 *
 * CERROJO DE ÁREA EN EL BACKEND (D69h/D109), no en la interfaz: la identidad sale del token firmado,
 * así que un `residente_dren` que teclee en la URL el código de alguien de tierras recibe `ok:false`,
 * no los datos. Para el HISTÓRICO manda la cuadrilla de cada FILA de ASISTENCIA, no solo la actual de
 * PERSONAL: si a alguien lo movieron de cuadrilla, el área de sus días pasados es la de cada fila.
 * Por eso: (1) cada fila se filtra por el área de SU cuadrilla; (2) el acceso se concede si la persona
 * es del área hoy (PERSONAL) o lo fue en alguna fila del rango; si no, se rechaza.
 */
function horasPersona(e){
  const desde=fdateValida_(e.parameter.desde), hasta=fdateValida_(e.parameter.hasta);   // D106
  if(!desde || !hasta) return json({ok:false, error:'Faltan las fechas del período (desde/hasta), o llegaron con un formato que no se entiende.'});
  if(hasta < desde)    return json({ok:false, error:'El período está invertido: "hasta" es anterior a "desde".'});
  const dias=diasDelRango(desde, hasta);
  if(dias.length > MAX_DIAS_RANGO) return json({ok:false, error:'Período demasiado largo (máximo '+MAX_DIAS_RANGO+' días). Consulta por tramos.'});

  // Identidad de la persona: `codigo` manda; si viene vacío, `cedula` (mismo criterio que keyPersona/
  // keyOf en el resto del módulo). No se mezclan: buscar por código y "además" por cédula podría traer
  // filas de otra persona cuando una de las dos columnas está vacía en el histórico.
  const codigo=String(e.parameter.codigo||'').trim();
  const cedula=String(e.parameter.cedula||'').trim();
  if(!codigo && !cedula) return json({ok:false, error:'Falta el código (o la cédula) de la persona.'});
  const esLaPersona=function(r){
    return codigo ? (String(r.codigo||'').trim()===codigo) : (String(r.cedula||'').trim()===cedula);
  };

  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return cuadrillaEnAreas(c, areas, cuadArea); };

  // Ficha desde PERSONAL (la de hoy). Puede no existir: alguien reportado y luego borrado de PERSONAL
  // sigue teniendo histórico en ASISTENCIA, y ese histórico es justamente lo que se viene a consultar.
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS).filter(esLaPersona);
  // Si hay varias filas (reingreso, D72: el reingreso crea fila NUEVA), manda la más reciente por
  // fecha_ingreso — es la que describe su situación actual.
  personal.sort(function(a,b){ return fdate(a.fecha_ingreso) < fdate(b.fecha_ingreso) ? -1 : 1; });
  const p=personal.length ? personal[personal.length-1] : null;

  // D102: lectura acotada al rango (escaneo de la columna `fecha` + solo los bloques de esos días; con
  // rangos largos el helper cae solo a la lectura completa de siempre). El filtro por persona va en
  // memoria: NADA de getDataRange() sobre la hoja entera.
  const enRango=leerFilasPorFecha_('ASISTENCIA', desde, hasta).filter(esLaPersona);

  // --- Cerrojo de área ---
  const deSuAreaHoy = p ? enArea(String(p.cuadrilla||'')) : false;
  const deSuAreaAntes = enRango.some(function(r){ return enArea(String(r.cuadrilla||'')); });
  if(areas.length && !deSuAreaHoy && !deSuAreaAntes){
    return json({ok:false, error:'Esa persona no es de tu área.'});
  }

  const filas=enRango.filter(function(r){ return enArea(String(r.cuadrilla||'')); })
    .map(function(r){
      return { fecha:fdate(r.fecha), reporta:String(r.reporta||''), cuadrilla:String(r.cuadrilla||''),
        codigo:String(r.codigo||''), cedula:String(r.cedula||''), nombre:String(r.nombre||''),
        cargo:String(r.cargo||''), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
        hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
        presente:String(r.presente||'Si'), motivo_ausencia:String(r.motivo_ausencia||''),
        observacion:String(r.observacion||''), turno:String(r.turno||'') };
    })
    .sort(function(a,b){ return a.fecha<b.fecha ? -1 : (a.fecha>b.fecha ? 1 : 0); });

  // La ficha se arma con PERSONAL si existe; si no (histórico de alguien ya borrado), con lo que traen
  // sus propias filas, para que la pantalla no salga sin nombre.
  const ult = filas.length ? filas[filas.length-1] : null;
  const persona = p ? {
      codigo:String(p.codigo||''), cedula:String(p.cedula||''), nombre:String(p.nombre||''),
      cargo:String(p.cargo||''), cuadrilla:String(p.cuadrilla||''), estado:String(p.estado||'activo'),
      fecha_ingreso:fdate(p.fecha_ingreso), fecha_retiro:fdate(p.fecha_retiro), enPersonal:true
    } : (ult ? {
      codigo:ult.codigo, cedula:ult.cedula, nombre:ult.nombre, cargo:ult.cargo, cuadrilla:ult.cuadrilla,
      estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false
    } : null);
  if(!persona) return json({ok:false, error:'No se encontró a esa persona (ni en PERSONAL ni en lo reportado del período).'});

  // Mismos catálogos que `exportDia` para que el cliente clasifique IGUAL que el Parte: CONFIG (topes,
  // ventana nocturna, almuerzo), FESTIVOS (tipo de jornada) y TURNOS (jornada programada).
  return json({ ok:true, desde, hasta, dias:dias.length, persona, filas,
    config:getConfigMap(), festivos:getFestivos(),
    turnos: readSheet('TURNOS', TURNOS_HEADERS).map(function(t){
      return { turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia), entrada:ftime(t.entrada), salida:ftime(t.salida),
        descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
        cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' };
    }) });
}

/* ---------- EXTRAS_ADMIN (D73): canal "solo extras" del admin ----------
 * El admin registra sus horas de días puntuales (máx 2h extra en día normal; máx 7h en dom/festivo, que
 * van a las ordinarias dom/fest col D del Parte). Aislado del roster: el admin NO
 * está en PERSONAL/CUADRILLAS/ASISTENCIA. Clave lógica = `fecha` (una fila por día; re-guardar pisa el día,
 * sin bandeja/staging). `proyecto` se deriva del `cc` (proyectoFromCC, misma regla D63 del resto del módulo).
 * Fechas por duck-typing al leer/comparar (fdate), nunca instanceof Date (D31). */
function extrasAdminDelDia(fecha){
  const f=fdate(fecha); if(!f) return [];
  return readSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS)
    .filter(r=> fdate(r.fecha)===f)
    .map(r=>({ fecha:fdate(r.fecha), cc:String(r.cc||''), proyecto:String(r.proyecto||''),
      horas:Number(r.horas)||0, tipo:norm(r.tipo), timestamp:r.timestamp, reporta:String(r.reporta||'') }));
}
// GET ?action=extras_admin&fecha=YYYY-MM-DD → registro del día (o null) para prefill/edición.
function extrasAdminDia(e){
  const fecha=fdateValida_(e.parameter.fecha);   // D106
  const regs=extrasAdminDelDia(fecha);
  return json({ ok:true, fecha, registro: regs.length? regs[0] : null });
}
// POST {action:'extras_admin', fecha, cc, horas, tipo} → upsert por `fecha`. Deriva `proyecto` del CC.
function guardarExtrasAdmin(body){
  const fecha=fdateValida_(body.fecha);   // D106: ya rechazaba la vacía; ahora también la mal formada
  const cc=String(body.cc||'').trim();
  const horas=Number(body.horas);
  const tipo=norm(body.tipo);
  if(!fecha) return json({ok:false, error:'Falta la fecha.'});
  if(!cc)    return json({ok:false, error:'Falta el centro de costo.'});
  if(['diurna','nocturna','domfest'].indexOf(tipo)<0) return json({ok:false, error:'Tipo inválido (usa diurna, nocturna o domfest).'});
  // Tope según el tipo: día normal (diurna/nocturna) máx 2h extra; domingo/festivo máx 7h (van a las
  // ordinarias dom/fest, no a extras — aclaración del dueño, D73).
  const maxH = (tipo==='domfest') ? 7 : 2;
  if(isNaN(horas) || !(horas>0 && horas<=maxH)) return json({ok:false, error:'Las horas deben ser un número mayor que 0 y máximo '+maxH+' ('+(tipo==='domfest'?'domingo/festivo':'día normal')+').'});
  const proyecto=proyectoFromCC(cc);
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  rows = rows.filter(r=> fdate(r[0])!==fecha);         // clave lógica = fecha: re-guardar pisa el día
  rows.push([fecha, cc, proyecto, horas, tipo, new Date(), body.reporta||ADMIN_USUARIOS[0]]);   // D121
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('EXTRAS_ADMIN');   // D99
  return json({ ok:true, msg:'Extra guardada: '+fecha+' · '+horas+'h '+tipo+' · '+cc+' (proyecto '+(proyecto||'?')+').', proyecto });
}
// POST {action:'extras_admin_delete', fecha} → elimina la fila del día.
function borrarExtrasAdmin(body){
  const fecha=fdateValida_(body.fecha);   // D106
  if(!fecha) return json({ok:false, error:'Falta la fecha.'});
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  const antes=rows.length;
  rows = rows.filter(r=> fdate(r[0])!==fecha);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  // D93: aquí el bloque solo puede DECRECER (se filtra el día), así que ensureRows_ nunca expandirá;
  // se llama igual para que toda escritura en bloque pase por el mismo guardián (es barata y no
  // escribe si hay espacio).
  if(rows.length){ ensureRows_(sh, rows.length);
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('EXTRAS_ADMIN');   // D99
  const borradas=antes-rows.length;
  return json({ ok:true, msg: borradas ? ('Extra del '+fecha+' eliminada.') : ('No había extra registrada el '+fecha+'.'), borradas });
}

/* ---------- POST reporte_asistencia: escritura directa (sin bandeja), pisa fecha+cuadrilla (D03) ---------- */
/* D82 — VERIFICADO para el modo offline (no tocar): este upsert BORRA-E-INSERTA el bloque completo de
 * fecha+cuadrilla (filtra `keep` = todo lo que NO es esa fecha+cuadrilla, clearContents y reescribe;
 * NO hace append). Un reenvío idéntico desde la cola offline re-pisa con el mismo contenido =>
 * IDEMPOTENTE POR DISEÑO, no necesita id_registro/UUID de cliente ni dedupe. Si hay dos envíos
 * encolados de la misma fecha+cuadrilla, el orden FIFO de la cola hace que gane el último (correcto:
 * es el más reciente). upsertNotaDia (D74) sigue la misma regla. */
function guardarAsistencia(body){
  const fecha=fdateValida_(body.fecha), cuadrilla=body.cuadrilla||'', reporta=body.reporta||'', ts=new Date();
  // D106: portero de fecha ANTES de tocar la hoja. Es el punto exacto por donde entraron las dos
  // veces los bloques sin fecha: con `fecha=''` este upsert escribía la cuadrilla entera con la
  // columna C en blanco y, en el siguiente envío igual, se borraba a sí mismo (ver fdateValida_).
  if(!fecha) return json({ok:false, error:ERROR_FECHA});
  // D101: quien tiene área forzada por su rol no puede reportar cuadrillas de otra área (D69h).
  if(!cuadrillaPermitidaPara(reporta, cuadrilla))
    return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  const need=ASISTENCIA_HEADERS.length;
  // D119: red de seguridad — si el envío trae DOS renglones de la misma persona, se guarda uno. D118 ya
  // deduplica el roster (que es de donde salía el renglón repetido), pero un teléfono con la pantalla
  // vieja en caché, o un reporte que pasó el fin de semana en la cola offline (D82), puede seguir
  // mandando el payload duplicado. Ese día terminaba con las horas repetidas en el Parte, así que el
  // cerrojo va también aquí, en el punto de escritura.
  const entrantes=unicasPorPersona_(body.filas||[]);
  const nuevas=entrantes.map(f=>[
    Utilities.getUuid(), ts, fecha, reporta, cuadrilla, f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    f.presente===false||f.presente==='No' ? 'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  // D107: borrado quirúrgico del bloque fecha+cuadrilla + anexo al final, en vez de reescribir la hoja
  // entera. Mismo predicado que el `keep` de antes (col C fecha, col E cuadrilla), decidido leyendo
  // solo el bloque de columnas 3–5 (fecha·reporta·cuadrilla) en vez de las 17.
  const aBorrar=localizarFilas_(sh, ASISTENCIA_HEADERS, ['fecha','cuadrilla'], function(o){
    return fdate(o.fecha)===fecha && String(o.cuadrilla)===cuadrilla;
  });
  borrarFilas_(sh, aBorrar);
  anexarFilas_(sh, nuevas, need);
  invalidarHoja_('ASISTENCIA');   // D99
  // D74: nota libre del día por cuadrilla (pisa fecha+cuadrilla, igual que las filas).
  upsertNotaDia(fecha, cuadrilla, reporta, body.nota, ts);
  return json({ ok:true, filas:nuevas.length });
}

/* ---------- NOTAS_ASISTENCIA (D74): nota libre del día por cuadrilla ---------- */
// Upsert por fecha+cuadrilla. Nota vacía = borra la del día (re-envío sin nota la limpia).
function upsertNotaDia(fecha, cuadrilla, reporta, nota, ts){
  const f=fdateValida_(fecha), c=cuadrilla||'', txt=String(nota==null?'':nota).trim();
  if(!f) return;   // D106: su único llamador ya valida; la nota nunca se queda sin fecha por su cuenta
  const sh=getSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS), need=NOTAS_ASISTENCIA_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? leerRango_(sh,2,1,last-1,need) : [];
  rows = rows.filter(r=> !(fdate(r[0])===f && String(r[1])===c));   // quita la del día+cuadrilla
  if(txt) rows.push([f, c, reporta||'', txt, ts||new Date()]);       // si hay texto, la reescribe
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([NOTAS_ASISTENCIA_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  invalidarHoja_('NOTAS_ASISTENCIA');   // D99
}
function notasDelDia(fecha){
  const f=fdate(fecha);
  return readSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS)
    .filter(r=> fdate(r.fecha)===f && String(r.nota||'').trim())
    .map(r=>({ cuadrilla:String(r.cuadrilla||''), reporta:String(r.reporta||''), nota:String(r.nota||'') }));
}

/* ---------- POST personal: alta / retiro / mover / reactivar — SOLO residente/admin ---------- */
function gestionPersonal(body){
  const usuario=norm(body.usuario);
  // D72/D74b/D84: admin gestiona TODO; residente/jeisson gestionan tierras; residente_odt/odl gestionan su
  // área; residente_dren gestiona ODT+ODL (incluido MOVER una persona de una cuadrilla ODT a una ODL y
  // viceversa — la validación de área acepta el ARRAY de áreas del usuario, no un valor único).
  // D88: `duvan` gestiona el personal de ODT+ODL (mismo alcance que residente_dren en asistencias).
  // D101: `residente_uf3` gestiona el personal de UF3 y NADA más — `areasDeUsuario` le devuelve ['uf3'],
  // así que `okArea` le rechaza cualquier alta/mover hacia (o desde) tierras, ODT u ODL.
  // D119: `angie` gestiona el personal de tierras+ODT+ODL — incluido MOVER a alguien de tierras a ODL
  // y viceversa, que `okArea` acepta porque valida contra el ARRAY de áreas. Lo que le rechaza, por la
  // misma vía, es cualquier alta o movimiento hacia (o desde) una cuadrilla de UF3.
  // D121: el admin entra por `esAdmin_` (su usuario pasó de `admin` a `cesar`).
  if(!esAdmin_(usuario) && ['residente','jeisson','duvan','residente_uf3','angie','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado: solo residente o admin.'});
  const areasUsr=areasDeUsuario(usuario);            // [] = todas (residente general/admin)
  const cuadArea=areaDeCuadrillaMap();
  const okArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areasUsr, cuadArea); };
  const sh=getSheet('PERSONAL', PERSONAL_HEADERS);
  const op=body.op||'';

  const hoy=Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  if(op==='alta'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
    const responsable=responsableDeCuadrilla(cuadrilla);
    // D72: fecha_ingreso (col 9) permite el alta retroactiva ("desde cierto día"); por defecto, hoy.
    const fechaIng=fdate(body.fecha_ingreso)||hoy;
    // D118: no se dan de alta dos veces a la misma persona. Un `appendRow` a ciegas dejaba dos filas
    // ACTIVAS con el mismo código y el formulario del capataz mostraba a esa persona dos veces, así que
    // un solo envío escribía dos filas en ASISTENCIA y sus horas salían repetidas al Parte. Para un
    // REINGRESO (persona que ya estuvo y volvió) está `op:'reingreso'`, que sí crea fila nueva pero
    // exige que la anterior esté retirada — así el hueco de días inactivos se conserva.
    const yaExiste=readSheet('PERSONAL', PERSONAL_HEADERS).find(function(p){
      return clavePersona_(p)===clavePersona_(body) && activaEnFecha(p, hoy);
    });
    if(yaExiste){
      return json({ok:false, error:'Ya existe una persona activa con ese '+(String(body.codigo||'').trim()?'código':'documento')
        +' ('+(yaExiste.nombre||'')+', cuadrilla '+(yaExiste.cuadrilla||'')+'). '
        +'Si cambió de cuadrilla usa MOVER; si volvió a la obra usa REINGRESO. Dar de alta otra vez la duplicaría en el Parte.'});
    }
    sh.appendRow([body.cedula||'', body.codigo||'', body.nombre||'', body.cargo||'', cuadrilla, responsable, 'activo', '', fechaIng]);
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'alta'});
  }
  const row=Number(body._row);
  if(!row || row<2) return json({ok:false, error:'Falta identificar la persona (_row).'});
  // D72/D84: un residente de área (o el unificado) solo puede retirar/reactivar/reingresar/mover filas
  // de sus áreas. [] = sin restricción (residente general/admin).
  if(areasUsr.length){
    const srcChk=readSheet('PERSONAL', PERSONAL_HEADERS).find(p=>p._row===row);
    if(!srcChk || !okArea(srcChk.cuadrilla)) return json({ok:false, error:'Esa persona no es de tu área.'});
  }

  if(op==='retiro'){
    // D72: la fecha de retiro la elige el residente (default hoy). Es el PRIMER día NO trabajado:
    // la persona aparece reportable hasta el día anterior (ver activaEnFecha).
    const fechaRet=fdate(body.fecha_retiro)||hoy;
    sh.getRange(row,7).setValue('inactivo');       // col 7 = estado
    sh.getRange(row,8).setValue(fechaRet);         // col 8 = fecha_retiro
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'retiro'});
  }
  if(op==='reactivar'){
    sh.getRange(row,7).setValue('activo');
    sh.getRange(row,8).setValue('');               // limpia el retiro; conserva fecha_ingreso (col 9)
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'reactivar'});
  }
  if(op==='reingreso'){
    // D72: reingreso REAL con historial. NO reactiva la fila vieja (conservaría el hueco perdido);
    // crea una fila NUEVA copiando los datos de la persona con fecha_ingreso = fecha del reingreso.
    // Evita la doble digitación (no se reescribe cédula/código/nombre) y respeta los días inactivos:
    // la fila vieja aplica hasta su retiro y la nueva desde el reingreso; el hueco no lo cubre ninguna.
    const fechaIng=fdate(body.fecha_ingreso)||hoy;
    const src=readSheet('PERSONAL', PERSONAL_HEADERS).find(p=>p._row===row);
    if(!src) return json({ok:false, error:'No se encontró la persona a reingresar.'});
    // D118: la fila de origen tiene que estar RETIRADA. Reingresar a alguien que sigue activo deja dos
    // filas vivas de la misma persona: el formulario se la muestra dos veces al responsable y el día
    // queda con las horas duplicadas. Si solo cambió de cuadrilla, la operación correcta es MOVER.
    if(activaEnFecha(src, fechaIng)){
      return json({ok:false, error:'Esa persona sigue ACTIVA'+(src.cuadrilla?' en la cuadrilla '+src.cuadrilla:'')
        +', así que no hay reingreso que registrar. Retírala primero (con su fecha de salida) y reingrésala, '
        +'o usa MOVER si lo que cambió fue la cuadrilla.'});
    }
    const responsable=responsableDeCuadrilla(src.cuadrilla)||src.responsable||'';
    sh.appendRow([src.cedula||'', src.codigo||'', src.nombre||'', src.cargo||'', src.cuadrilla||'', responsable, 'activo', '', fechaIng]);
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'reingreso'});
  }
  if(op==='mover'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
    const responsable=responsableDeCuadrilla(cuadrilla);
    sh.getRange(row,5).setValue(cuadrilla);        // col 5 = cuadrilla
    sh.getRange(row,6).setValue(responsable);       // col 6 = responsable
    invalidarHoja_('PERSONAL');   // D99
    return json({ok:true, op:'mover'});
  }
  return json({ok:false, error:'op no reconocida'});
}
function responsableDeCuadrilla(cuadrilla){
  const rows=readSheet('CUADRILLAS', CUADRILLAS_HEADERS);
  const r=rows.find(x=>x.cuadrilla===cuadrilla);
  return r ? String(r.responsables||'') : '';
}

/* ---------- setupHojas(): un solo uso, crea hojas + encabezados + semillas fijas ----------
 * Ejecutar UNA VEZ desde el editor de Apps Script tras crear el Sheet y pegar el SHEET_ID arriba.
 * NO pisa datos si la hoja ya tiene filas (salvo encabezados, que se auto-sanan con getSheet).
 * PERSONAL (semilla PERSONAL_seed.csv), CAT_TRABAJADORES, CAT_CC y CAT_MOTIVOS los pega el usuario
 * a mano (catálogos de la plantilla Navision, no se inventan aquí). CONFIG/CUADRILLAS/FESTIVOS sí
 * llevan semilla fija porque el prompt las define explícitamente. */
function setupHojas(){
  getSheet('PERSONAL', PERSONAL_HEADERS);
  getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  getSheet('CAT_TRABAJADORES', CAT_TRABAJADORES_HEADERS);
  getSheet('CAT_CC', CAT_CC_HEADERS);
  getSheet('CC_USADOS', CC_USADOS_HEADERS);   // el usuario pega aquí los ~5-20 CC frecuentes (opcional)
  getSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS);
  getSheet('MOTIVOS_USADOS', MOTIVOS_USADOS_HEADERS);   // D78: motivos frecuentes para el capataz (opcional; vacía = todos)
  getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS);   // D73: canal "solo extras" del admin (mis-extras.html)
  getSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS);   // D74: nota libre del día por cuadrilla

  // D72: TURNOS asignados (5 turnos × tipo de día). Semilla fija con los horarios entregados; si el
  // usuario ya cargó la hoja, no se pisa. Horas como texto 'HH:MM' (00:00 = medianoche, fin de cena).
  const turSh=getSheet('TURNOS', TURNOS_HEADERS);
  if(turSh.getLastRow()<2){
    ensureRows_(turSh, 10);   // D93 (no-op en hoja nueva: la semilla cabe de sobra en las 1.000 filas)
    turSh.getRange(2,1,10,7).setValues([
      ['1','lv',     '07:00','15:30','12:00','13:00','NO'],
      ['1','sabado', '07:00','11:30','',     '',     'NO'],
      ['2','lv',     '17:30','02:00','22:00','23:00','SI'],
      ['2','sabado', '13:30','18:00','',     '',     'NO'],
      ['3','lj',     '17:00','02:30','23:00','00:00','SI'],
      ['3','viernes','17:00','02:00','23:00','00:00','SI'],
      ['4','lj',     '19:00','04:30','23:00','00:00','SI'],
      ['4','viernes','19:00','04:00','23:00','00:00','SI'],
      ['5','lv',     '18:00','02:30','23:00','00:00','SI'],
      ['5','sabado', '14:00','18:30','',     '',     'NO']
    ]);
    turSh.getRange(2,3,10,4).setNumberFormat('@'); // entrada/salida/descanso como TEXTO, no como hora
  }

  const cuadSh=getSheet('CUADRILLAS', CUADRILLAS_HEADERS);
  if(cuadSh.getLastRow()<2){
    // D72: 3ª columna = área. D84: 4ª columna = estado (vacío = activa). Las cuadrillas de drenajes
    // (ODT/ODL) las pega el usuario cuando llegue el listado real (cuadrilla · responsables(login) ·
    // odt|odl · estado); aquí solo van las de tierras.
    // D84 (post-salida a UF3): ALBERT queda con `maleja` como ÚNICA responsable (albert salió a UF3;
    // maleja ya la reportaba, D75). ARIEL queda INACTIVA y sin responsable (ariel salió a UF3; su gente
    // se movió a ROBINSON). Ambas conservan su nombre para no dejar huérfano el histórico de ASISTENCIA.
    ensureRows_(cuadSh, 7);   // D93
    cuadSh.getRange(2,1,7,4).setValues([
      ['ANGEL','angel','tierras',''], ['ROBINSON','robinson','tierras',''], ['ALBERT','maleja','tierras',''],
      ['ARIEL','','tierras','inactiva'], ['ALEJANDRO','alejandro','tierras',''], ['OPERADORES','jeisson','tierras',''],
      ['VOLQUETEROS','mairy','tierras','']
    ]);
  }

  const cfgSh=getSheet('CONFIG', CONFIG_HEADERS);
  if(cfgSh.getLastRow()<2){
    ensureRows_(cfgSh, 16);   // D93
    cfgSh.getRange(2,1,16,2).setValues([
      ['ord_lun_vie','7.5'], ['ord_sabado','4.5'], ['ord_domingo','0'],
      ['entrada_lv','07:00'], ['salida_lv','15:30'], ['entrada_sab','07:00'], ['salida_sab','11:30'],
      ['almuerzo_ini','12:00'], ['almuerzo_fin','13:00'],
      ['max_extras_dia','2'], ['nocturno_desde','19:00'], ['nocturno_hasta','06:00'],
      // Dom/Fest (criterio de nómina, D72): MÁXIMO de horas ordinarias Dom/Fest (col D); nada en col L.
      ['domfest_tope','7'],
      // D77: horario típico de domingo/festivo (07:00–15:00 = 8h − 1h almuerzo = 7h Dom/Fest). Solo
      // pre-llena el formulario; instalaciones viejas sin estas claves usan el mismo default del cliente.
      ['entrada_dom','07:00'], ['salida_dom','15:00'],
      ['proyecto_3701','3701| T2 - UF1 - R4513 PR 09+800 - PR 30+000']
    ]);
    cfgSh.appendRow(['proyecto_3702','PENDIENTE']); // parámetro abierto (§2 del prompt)
    // D101: proyecto 3703 (UF3). String EXACTO tomado de la hoja `Proyectos` de la plantilla Navision
    // de UF3 que entregó el usuario (jul-2026) — no se inventó. El generador lo lee por clave
    // (`proyecto_` + prefijo del CC), así que un proyecto nuevo solo necesita su fila en CONFIG.
    // En la instalación VIVA hay que agregar esta fila A MANO en la hoja CONFIG (setupHojas solo
    // siembra con la hoja vacía). Sin ella, el export avisa y usa "3703" pelado.
    cfgSh.appendRow(['proyecto_3703','3703| T2 - UF3 - R4513 PR 09+800 - PR 90+718']);
    // D73: No. Recurso del admin en Navision ("código| NOMBRE"), string EXACTO tal cual el listado de
    // Trabajadores (Navision lo lee verbatim). Valor del dueño (jul-2026). Si se deja vacío, el generador
    // NO agrega la fila del admin y avisa. OJO: debe coincidir carácter por carácter con Navision.
    cfgSh.appendRow(['admin_recurso','77463| CESAR AUGUSTO GALVIS SANDINO']);
    // Corrección jul-2026 (extiende D72f): SUFIJO del CC propio del capataz (sin prefijo de proyecto).
    // El frontend antepone el prefijo 3701/3702 por mayoría de UF. Si esta clave no existe, asistencia.html
    // usa su valor por defecto (mismo string), así que NO exige redeploy en instalaciones ya andando.
    cfgSh.appendRow(['cc_capataz','I010305| ENCARGADOS, INSPECTORES Y CAPATACES']);
  }

  const festSh=getSheet('FESTIVOS', FESTIVOS_HEADERS);
  if(festSh.getLastRow()<2){
    // Colombia 2026-2027, Ley Emiliani aplicada (verificado contra el algoritmo de Pascua + traslado a lunes).
    // '2026-07-13' NO es festivo de calendario: se decretó como día no laboral puntual para la obra
    // (jul-2026). Va en la semilla para instalaciones nuevas; en una hoja ya sembrada hay que añadir la
    // fila '2026-07-13' a mano en FESTIVOS (el seed solo corre con la hoja vacía).
    const festivos=[
      '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18',
      '2026-06-08','2026-06-15','2026-06-29','2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12',
      '2026-11-02','2026-11-16','2026-12-08','2026-12-25',
      '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26','2027-05-01','2027-05-10',
      '2027-05-31','2027-06-07','2027-07-05','2027-07-20','2027-08-07','2027-08-16','2027-10-18',
      '2027-11-01','2027-11-15','2027-12-08','2027-12-25'
    ];
    ensureRows_(festSh, festivos.length);   // D93
    festSh.getRange(2,1,festivos.length,1).setValues(festivos.map(f=>[f]));
  }
  cacheBorrarTodo_();   // D99: siembra hojas nuevas -> el caché de catálogos queda obsoleto
}

/**
 * D93 — Diagnóstico de CAPACIDAD de la grilla. Ejecutar desde el editor de Apps Script y revisar el
 * log (Ver > Registro de ejecución). Muestra, por hoja: filas usadas / filas totales / columnas
 * usadas / columnas totales y cuántas filas libres quedan. NO escribe datos: es solo lectura.
 */
function diagnosticoCapacidad() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  ss.getSheets().forEach(function (sh) {
    Logger.log(
      sh.getName() + ' → filas ' + sh.getLastRow() + '/' + sh.getMaxRows() +
      ' (libres ' + (sh.getMaxRows() - sh.getLastRow()) + ')' +
      ' · cols ' + sh.getLastColumn() + '/' + sh.getMaxColumns()
    );
  });
}

/* ---------- D106 — FILAS SIN FECHA: diagnóstico y reparación puntual ----------
 * Herramientas de MANTENIMIENTO, no endpoints: se corren A MANO desde el editor de Apps Script
 * (basta guardar el archivo, no exigen redesplegar). Mismo patrón previsualizar/aplicar que
 * `previsualizarDescripcionesData` / `actualizarDescripcionesData` de Codigo.gs.
 *
 *   1) diagnosticoFechasAsistencia()      -> SOLO LEE. Lista en el Log las filas de ASISTENCIA cuya
 *      columna `fecha` está vacía o mal formada, con su fila real, cuadrilla, quién reportó y su
 *      `timestamp`. Sirve para saber si el problema volvió sin tener que revisar la hoja a ojo.
 *   2) repararFechasAsistencia(false)     -> PREVISUALIZA la reparación (no escribe nada).
 *      repararFechasAsistencia(true)      -> aplica: escribe SOLO la celda de la columna `fecha` de
 *      esas filas, tomando el DÍA DEL `timestamp` (hora de Bogotá). No toca ninguna otra columna,
 *      ninguna otra hoja ni los .xlsx maestros (D24).
 *
 * ⚠️ DOS LÍMITES QUE HAY QUE LEER ANTES DE APLICAR:
 *   · El `timestamp` es CUÁNDO SE SUBIÓ, no el día trabajado. Coinciden en el envío normal del mismo
 *     día, pero NO en un reporte que salió de la cola offline al día siguiente (D82) ni en un
 *     "completar faltantes" hecho días después. Por eso la previsualización imprime fila por fila lo
 *     que pondría: hay que mirarla contra lo que se sabe del día antes de aplicar.
 *   · Esto NO resucita filas borradas. Si un segundo envío con la fecha vacía pisó al primero (el
 *     upsert de D03 quita "fecha+cuadrilla", y con fecha vacía eso son las huérfanas anteriores), esas
 *     filas ya no están en la hoja: para eso está el historial de versiones del Sheet.
 */
function _fechasAsistenciaPass(aplicar, soloListar){
  const sh=ss_().getSheetByName('ASISTENCIA');
  if(!sh || sh.getLastRow()<2){ Logger.log('ASISTENCIA vacía: nada que revisar.'); return 0; }
  const need=ASISTENCIA_HEADERS.length, nFilas=sh.getLastRow()-1;
  const colFecha=ASISTENCIA_HEADERS.indexOf('fecha')+1;       // por NOMBRE, nunca un 3 cableado
  const v=leerRango_(sh, 2, 1, nFilas, need);
  const tz='America/Bogota';
  let malas=0, reparables=0;
  for(let i=0;i<nFilas;i++){
    const fila=i+2, cruda=v[i][colFecha-1];
    if(fdateValida_(cruda)) continue;                          // fecha buena: no se toca
    malas++;
    const ts=v[i][1];                                          // col B timestamp
    const propuesta=(ts && typeof ts==='object' && typeof ts.getFullYear==='function')
      ? Utilities.formatDate(ts, tz, 'yyyy-MM-dd') : fdateValida_(ts);
    Logger.log('fila '+fila+' · cuadrilla '+JSON.stringify(String(v[i][4]||''))
      +' · reportó '+JSON.stringify(String(v[i][3]||''))+' · '+JSON.stringify(String(v[i][7]||''))
      +' · fecha actual '+JSON.stringify(String(cruda==null?'':cruda))
      +' · timestamp '+String(ts)+' -> propuesta '+(propuesta||'(no se puede deducir)'));
    if(soloListar || !propuesta) continue;
    reparables++;
    if(aplicar) sh.getRange(fila, colFecha).setValue(propuesta);   // SOLO la celda de fecha
  }
  if(aplicar && reparables) invalidarHoja_('ASISTENCIA');
  Logger.log((soloListar ? 'DIAGNÓSTICO (solo lectura).'
              : (aplicar ? 'APLICADO.' : 'PREVISUALIZACIÓN (no se escribió nada).'))
    +' Filas revisadas: '+nFilas+' · sin fecha válida: '+malas
    +(soloListar ? '' : ' · reparables desde el timestamp: '+reparables));
  return malas;
}
function diagnosticoFechasAsistencia(){ return _fechasAsistenciaPass(false, true); }
function repararFechasAsistencia(aplicar){ return _fechasAsistenciaPass(aplicar===true, false); }

/* ---------- D118 — mantenimiento a mano: personas repetidas en la hoja PERSONAL ----------
 * Mismo patrón que `diagnosticoFechasAsistencia` (D106): se ejecuta desde el editor de Apps Script y
 * SOLO LISTA — no borra ni modifica nada, porque cuál de las dos filas sobra lo tiene que decidir el
 * usuario (pueden diferir en cuadrilla, cargo o fecha_ingreso, y la buena es la que refleje la realidad).
 *
 * Qué busca: personas con MÁS DE UNA fila ACTIVA hoy (misma clave que el resto del módulo: código, o
 * cédula si no tiene código). Son las que el formulario del responsable muestra dos veces y las que
 * terminan con horas repetidas en el Parte de Navision.
 *
 * Cómo corregir cada una: dejar UNA fila y, en la sobrante, borrar la fila o ponerle `estado=inactivo`
 * con su `fecha_retiro`. Después hay que pedirle a esa cuadrilla que VUELVA A ENVIAR los días afectados
 * (el envío pisa fecha+cuadrilla, así que el reenvío deja el día limpio). Los días ya exportados a
 * Navision hay que revisarlos aparte: el archivo salió con la línea repetida. */
function diagnosticoPersonalDuplicado(){
  const hoy=Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  const activos=readSheet('PERSONAL', PERSONAL_HEADERS).filter(function(p){ return activaEnFecha(p, hoy); });
  const grupos={};
  activos.forEach(function(p){
    const k=clavePersona_(p);
    if(k==='COD:' || k==='CED:') return;             // sin código ni cédula: no se puede agrupar
    (grupos[k]=grupos[k]||[]).push(p);
  });
  const dups=Object.keys(grupos).filter(function(k){ return grupos[k].length>1; });
  const lineas=dups.map(function(k){
    const g=grupos[k];
    return '  · '+k+' '+(g[0].nombre||'(sin nombre)')+' — '+g.length+' filas: '
      + g.map(function(p){ return 'fila '+p._row+' ('+(p.cuadrilla||'sin cuadrilla')+')'; }).join(' · ');
  });
  const msg='PERSONAL — personas con más de una fila activa: '+dups.length
    + ' (de '+activos.length+' filas activas).'
    + (lineas.length ? '\n'+lineas.join('\n')
        + '\n\nDeja UNA fila por persona (borra la sobrante o ponle estado=inactivo con su fecha_retiro)'
        + '\ny pide a esas cuadrillas que vuelvan a enviar los días afectados.'
      : '\nSin duplicados.');
  Logger.log(msg);
  return { total:dups.length, detalle:lineas };
}

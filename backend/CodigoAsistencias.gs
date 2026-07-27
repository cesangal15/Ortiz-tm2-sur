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
function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
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

function getSheet(name, headers){
  const ss=SpreadsheetApp.openById(SHEET_ID); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  ensureCols_(sh, need);   // D93: ancho de grilla suficiente para los encabezados de esta hoja
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,need).setValues([headers]); return sh; }
  const cur=sh.getRange(1,1,1,need).getValues()[0];
  let diff=false; for(let i=0;i<need;i++){ if(String(cur[i]||'')!==headers[i]){ diff=true; break; } }
  if(diff) sh.getRange(1,1,1,need).setValues([headers]);
  return sh;
}
function readSheet(name, headers){
  const ss=SpreadsheetApp.openById(SHEET_ID), sh=ss.getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return [];
  const v=sh.getDataRange().getValues(), h=headers||v[0], out=[];
  for(let i=1;i<v.length;i++){ const o={}; h.forEach((k,j)=>o[k]=v[i][j]); o._row=i+1; out.push(o); }
  return out;
}
function norm(s){ return String(s==null?'':s).trim().toLowerCase(); }

/* ---------- área (D72 / D84) ---------- */
// Helper único de áreas por usuario (mismo criterio que el frontend, D84): devuelve el ARRAY de áreas
// que revisa un usuario. residente_odt/odl ven SOLO su área; residente_dren y duvan ven ['odt','odl'];
// el residente "general"/jeisson son de TIERRAS (D74b); admin devuelve [] = SIN filtro (ve todas).
//   residente_odt  -> ['odt']              residente_odl  -> ['odl']
//   residente_dren -> ['odt','odl']        duvan -> ['odt','odl']  (D88: solo asistencias)
//   residente/jeisson -> ['tierras']       admin (u otro) -> []
function areasDeUsuario(usuario){
  const u=norm(usuario);
  if(u==='residente_odt')  return ['odt'];
  if(u==='residente_odl')  return ['odl'];
  if(u==='residente_dren') return ['odt','odl'];   // D84: residente de drenajes unificado
  // D88: `duvan` = el jeisson de drenajes (asistencias de ODT+ODL y nada más). Mismo alcance de datos
  // que residente_dren en este módulo; lo que NO tiene es el panel/reporte de drenajes (eso va por rol
  // en el frontend, no por este helper).
  if(u==='duvan')          return ['odt','odl'];
  if(u==='residente' || u==='jeisson') return ['tierras'];
  return [];   // admin: sin filtro (puede filtrar por &area=)
}
// Áreas efectivas de una petición: las forzadas por el usuario; si NO tiene (admin), respeta un &area=
// de filtro. [] = sin filtro (admin sin &area). Los usuarios con área forzada no la pueden burlar.
function areasEfectivas(e){
  let areas=areasDeUsuario((e.parameter&&e.parameter.usuario)||'');
  if(!areas.length){ const af=norm(e.parameter&&e.parameter.area); if(af==='tierras'||af==='odt'||af==='odl') areas=[af]; }
  return areas;
}
// ¿La cuadrilla `c` cae dentro de las áreas dadas? [] = sin filtro (todas). Compat con === anterior.
function cuadrillaEnAreas(c, areas, cuadArea){ return !areas.length || areas.indexOf(cuadArea[c]||'tierras')>=0; }
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
function proyectoFromCC(cc){
  const s=String(cc||'').trim();
  const m=s.match(/^(\d{4})/);
  return m ? m[1] : '';
}

/* ---------- routing ---------- */
function doGet(e){
  const a=((e.parameter.action)||'').toLowerCase();
  if(a==='roster')     return roster(e);
  if(a==='asistencia') return asistenciaDia(e);
  if(a==='personal')   return personalCompleto(e);
  if(a==='export')     return exportDia(e);
  // EXTRAS_ADMIN (D73): registro del día para prefill/edición en mis-extras.html; `extras_admin_dia`
  // es alias (mismo handler) para el indicador del residente en resumen-asistencia.html.
  if(a==='extras_admin' || a==='extras_admin_dia') return extrasAdminDia(e);
  return json({ok:true, msg:'API Asistencias viva'});
}
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents);
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
  if(u==='admin') return todas.map(r=>r.cuadrilla); // admin elige cuadrilla (§3)
  // D88: `duvan` reporta la asistencia de TODA su área — igual que el admin (elige la cuadrilla en el
  // formulario), pero acotado a ODT+ODL por `areasDeUsuario`. No va por la columna `responsables`:
  // no es responsable de ninguna cuadrilla, reporta por todos los capataces de drenajes.
  if(u==='duvan'){
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
  const fecha=e.parameter.fecha || Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
  const personalTodo=readSheet('PERSONAL', PERSONAL_HEADERS);
  // D72: roster date-aware — solo quien ya había ingresado y no estaba retirado a esa fecha.
  // D85: los eventuales no salen en el formulario del responsable (se marcan desde el resumen).
  const personas=personalTodo.filter(p=> activaEnFecha(p, fecha) && !esEventual(p) && cuadrillas.indexOf(p.cuadrilla)>=0)
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
  const asis=readSheet('ASISTENCIA', ASISTENCIA_HEADERS)
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
  return json({ ok:true, cuadrillas, personas, config:cfg, festivos, jornada, catCC, catCCUsados, catMotivos, recientesCC, turnos });
}

/* ---------- GET asistencia: resumen del día para el residente/jeisson ---------- */
function asistenciaDia(e){
  const fecha=fdate(e.parameter.fecha);
  // D72/D74b/D84: se limita todo (filas, cuadrillas, faltantes) a las áreas del usuario (tierras/odt/odl,
  // o ambas para residente_dren); el admin ve todas o filtra por &area=. Un residente de área/tierras no
  // puede burlar su alcance.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  // Las filas YA reportadas NO se filtran por estado de la cuadrilla (D84): una cuadrilla inactivada
  // hoy debe seguir mostrando sus filas de fechas anteriores. El filtro de inactivas aplica solo al
  // ROSTER ESPERADO (cuadrillasCat / personalActivo → estado y faltantes).
  const filas=readSheet('ASISTENCIA', ASISTENCIA_HEADERS).filter(r=> fdate(r.fecha)===fecha && enArea(r.cuadrilla))
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
  const personalActivo=personalTodo.filter(p=>activaEnFecha(p, fecha) && !esEventual(p) && enArea(p.cuadrilla) && !inactivas[p.cuadrilla]);
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
  return json({ ok:true, fecha, filas, cuadrillas:cuadrillasEstado, faltantes, eventuales, jornada, catCC, catCCUsados, catMotivos, turnos, extrasAdmin, notas, config:cfg, festivos });
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
  if(['residente','admin','jeisson','duvan','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado para completar faltantes.'});
  const fecha=fdate(body.fecha), ts=new Date();
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS), need=ASISTENCIA_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? sh.getRange(2,1,last-1,need).getValues() : [];
  function keyOf(codigo,cedula){
    const c=String(codigo||'').trim();
    return c ? ('COD:'+c) : ('CED:'+String(cedula||'').trim());
  }
  const incoming=body.filas||[], keys={};
  incoming.forEach(f=>{ keys[keyOf(f.codigo,f.cedula)]=true; });
  // quita la fila existente de ese día SOLO para las personas entrantes (col C=fecha, F=codigo, G=cedula)
  rows = rows.filter(r=> !(fdate(r[2])===fecha && keys[keyOf(r[5], r[6])]));
  const nuevas=incoming.map(f=>[
    Utilities.getUuid(), ts, fecha, body.reporta||usuario, f.cuadrilla||'', f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    (f.presente===false||f.presente==='No')?'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  const todas=rows.concat(nuevas);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([ASISTENCIA_HEADERS]);
  // D93: capacidad antes de la escritura en bloque. Va DESPUÉS del encabezado a propósito: tras el
  // clearContents la hoja queda con getLastRow()=1 (el encabezado), así que ensureRows_ pide
  // exactamente 1+todas.length filas — las que ocupa la reescritura completa.
  if(todas.length){ ensureRows_(sh, todas.length);
    sh.getRange(2,1,todas.length,need).setValues(todas); }
  return json({ok:true, filas:nuevas.length});
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
  const fecha=fdate(e.parameter.fecha);
  // D72/D74b/D84: residente(tierras)/residente_odt/odl exportan SOLO su área; residente_dren exporta
  // ODT+ODL en un SOLO archivo (el Parte se arma por día×proyecto y los CC ya distinguen el capítulo,
  // así que mezclar áreas no requiere lógica extra); el admin todo o filtra por &area=. Las filas ya
  // reportadas NO se filtran por estado de cuadrilla (D84): una cuadrilla inactivada hoy sigue
  // exportando sus filas de fechas anteriores.
  const areas=areasEfectivas(e);
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return cuadrillaEnAreas(cuadrilla, areas, cuadArea); };
  const filas=readSheet('ASISTENCIA', ASISTENCIA_HEADERS).filter(r=> fdate(r.fecha)===fecha && enArea(r.cuadrilla))
    .map(r=>({ codigo:r.codigo||'', cedula:r.cedula||'', nombre:r.nombre||'', cargo:r.cargo||'',
      cuadrilla:r.cuadrilla||'', cc:r.cc||'', proyecto:String(r.proyecto||''),
      hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente||'Si', motivo_ausencia:r.motivo_ausencia||'', turno:String(r.turno||''), fecha:fdate(r.fecha) }));
  // proyecto_defecto por cuadrilla: proyecto MÁS FRECUENTE históricamente (para ausentes, que no llevan CC).
  const historico=readSheet('ASISTENCIA', ASISTENCIA_HEADERS).filter(r=> r.presente==='Si' && r.proyecto);
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
  const fecha=fdate(e.parameter.fecha);
  const regs=extrasAdminDelDia(fecha);
  return json({ ok:true, fecha, registro: regs.length? regs[0] : null });
}
// POST {action:'extras_admin', fecha, cc, horas, tipo} → upsert por `fecha`. Deriva `proyecto` del CC.
function guardarExtrasAdmin(body){
  const fecha=fdate(body.fecha);
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
  let rows = last>1 ? sh.getRange(2,1,last-1,need).getValues() : [];
  rows = rows.filter(r=> fdate(r[0])!==fecha);         // clave lógica = fecha: re-guardar pisa el día
  rows.push([fecha, cc, proyecto, horas, tipo, new Date(), body.reporta||'admin']);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
  return json({ ok:true, msg:'Extra guardada: '+fecha+' · '+horas+'h '+tipo+' · '+cc+' (proyecto '+(proyecto||'?')+').', proyecto });
}
// POST {action:'extras_admin_delete', fecha} → elimina la fila del día.
function borrarExtrasAdmin(body){
  const fecha=fdate(body.fecha);
  if(!fecha) return json({ok:false, error:'Falta la fecha.'});
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? sh.getRange(2,1,last-1,need).getValues() : [];
  const antes=rows.length;
  rows = rows.filter(r=> fdate(r[0])!==fecha);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  // D93: aquí el bloque solo puede DECRECER (se filtra el día), así que ensureRows_ nunca expandirá;
  // se llama igual para que toda escritura en bloque pase por el mismo guardián (es barata y no
  // escribe si hay espacio).
  if(rows.length){ ensureRows_(sh, rows.length);
    sh.getRange(2,1,rows.length,need).setValues(rows); }
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
  const fecha=fdate(body.fecha), cuadrilla=body.cuadrilla||'', reporta=body.reporta||'', ts=new Date();
  const sh=getSheet('ASISTENCIA', ASISTENCIA_HEADERS);
  const need=ASISTENCIA_HEADERS.length;
  const last=sh.getLastRow();
  let keep=[];
  if(last>1){
    const v=sh.getRange(2,1,last-1,need).getValues();
    keep=v.filter(row=> !(fdate(row[2])===fecha && String(row[4])===cuadrilla)); // col C fecha, col E cuadrilla
  }
  const nuevas=(body.filas||[]).map(f=>[
    Utilities.getUuid(), ts, fecha, reporta, cuadrilla, f.codigo||'', f.cedula||'', f.nombre||'', f.cargo||'',
    f.cc||'', f.proyecto||'', f.hora_entrada||'', f.hora_salida||'',
    f.presente===false||f.presente==='No' ? 'No':'Si', f.motivo_ausencia||'', f.observacion||'', f.turno||''
  ]);
  const todas=keep.concat(nuevas);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([ASISTENCIA_HEADERS]);
  // D93: capacidad antes de reescribir el bloque completo (ver nota en guardarIndividual: tras el
  // clearContents + encabezado, getLastRow()=1, así que se piden 1+todas.length filas).
  if(todas.length){ ensureRows_(sh, todas.length);
    sh.getRange(2,1,todas.length,need).setValues(todas); }
  // D74: nota libre del día por cuadrilla (pisa fecha+cuadrilla, igual que las filas).
  upsertNotaDia(fecha, cuadrilla, reporta, body.nota, ts);
  return json({ ok:true, filas:nuevas.length });
}

/* ---------- NOTAS_ASISTENCIA (D74): nota libre del día por cuadrilla ---------- */
// Upsert por fecha+cuadrilla. Nota vacía = borra la del día (re-envío sin nota la limpia).
function upsertNotaDia(fecha, cuadrilla, reporta, nota, ts){
  const f=fdate(fecha), c=cuadrilla||'', txt=String(nota==null?'':nota).trim();
  const sh=getSheet('NOTAS_ASISTENCIA', NOTAS_ASISTENCIA_HEADERS), need=NOTAS_ASISTENCIA_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? sh.getRange(2,1,last-1,need).getValues() : [];
  rows = rows.filter(r=> !(fdate(r[0])===f && String(r[1])===c));   // quita la del día+cuadrilla
  if(txt) rows.push([f, c, reporta||'', txt, ts||new Date()]);       // si hay texto, la reescribe
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([NOTAS_ASISTENCIA_HEADERS]);
  if(rows.length){ ensureRows_(sh, rows.length);   // D93
    sh.getRange(2,1,rows.length,need).setValues(rows); }
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
  if(['residente','admin','jeisson','duvan','residente_odt','residente_odl','residente_dren'].indexOf(usuario)<0)
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
    sh.appendRow([body.cedula||'', body.codigo||'', body.nombre||'', body.cargo||'', cuadrilla, responsable, 'activo', '', fechaIng]);
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
    return json({ok:true, op:'retiro'});
  }
  if(op==='reactivar'){
    sh.getRange(row,7).setValue('activo');
    sh.getRange(row,8).setValue('');               // limpia el retiro; conserva fecha_ingreso (col 9)
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
    const responsable=responsableDeCuadrilla(src.cuadrilla)||src.responsable||'';
    sh.appendRow([src.cedula||'', src.codigo||'', src.nombre||'', src.cargo||'', src.cuadrilla||'', responsable, 'activo', '', fechaIng]);
    return json({ok:true, op:'reingreso'});
  }
  if(op==='mover'){
    const cuadrilla=body.cuadrilla||'';
    if(!okArea(cuadrilla)) return json({ok:false, error:'Esa cuadrilla no es de tu área.'});
    const responsable=responsableDeCuadrilla(cuadrilla);
    sh.getRange(row,5).setValue(cuadrilla);        // col 5 = cuadrilla
    sh.getRange(row,6).setValue(responsable);       // col 6 = responsable
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

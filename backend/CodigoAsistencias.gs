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
 *                                                + CAT_CC + CAT_MOTIVOS + CC recientes por cuadrilla
 *   GET  ?action=asistencia&fecha=…          -> filas del día + estado por cuadrilla + faltantes
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

// D72: `fecha_ingreso` (col 9) hace el roster "date-aware": el alta puede ser retroactiva ("desde
// cierto día") y el retiro lleva su propia fecha. Celda vacía en filas viejas = sin límite inferior
// (siempre estuvo activa) → retrocompatible con lo ya guardado.
const PERSONAL_HEADERS      = ['cedula','codigo','nombre','cargo','cuadrilla','responsable','estado','fecha_retiro','fecha_ingreso'];
// D72: `area` (col 3) etiqueta cada cuadrilla como tierras/odt/odl para que residente_odt/residente_odl
// vean SOLO su área en el resumen. Celda vacía en filas viejas = 'tierras' (retrocompatible).
const CUADRILLAS_HEADERS    = ['cuadrilla','responsables','area'];
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
const CAT_MOTIVOS_HEADERS   = ['string_motivo'];
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
// reporte (captura cruda, D69b); la clasificación de extras/recargos sigue calculándose aparte y su
// mapeo fino a las columnas G–N Navision sigue siendo parámetro abierto hasta confirmarlo la empresa.
const TURNOS_HEADERS        = ['turno','tipo_dia','entrada','salida','descanso_ini','descanso_fin','cruza_medianoche'];
// EXTRAS_ADMIN (D73): canal "solo extras" del admin — una fila por día (clave lógica = `fecha`, re-guardar
// pisa el día). El admin registra SUS horas extras de días puntuales; su jornada ordinaria se asume por
// fuera del sistema y no aparece en el `Parte` salvo los días con extra. Aislada del roster (PERSONAL/
// CUADRILLAS/ASISTENCIA): el admin NO está en el roster. `proyecto` se deriva del `cc` (proyectoFromCC).
const EXTRAS_ADMIN_HEADERS  = ['fecha','cc','proyecto','horas','tipo','timestamp','reporta'];

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
function getSheet(name, headers){
  const ss=SpreadsheetApp.openById(SHEET_ID); let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  if(sh.getMaxColumns()<need) sh.insertColumnsAfter(sh.getMaxColumns(), need-sh.getMaxColumns());
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

/* ---------- área (D72) ---------- */
// Área que revisa un usuario en el resumen: residente_odt/odl ven SOLO su área; el resto (residente
// general, admin, jeisson) ven todas ('' = sin filtro).
function areaDeUsuario(usuario){
  const u=norm(usuario);
  if(u==='residente_odt') return 'odt';
  if(u==='residente_odl') return 'odl';
  return '';
}
// Mapa cuadrilla -> área desde la hoja CUADRILLAS. Vacío o cuadrilla desconocida = 'tierras'.
function areaDeCuadrillaMap(){
  const m={}; readSheet('CUADRILLAS', CUADRILLAS_HEADERS).forEach(r=>{ m[r.cuadrilla]=norm(r.area)||'tierras'; });
  return m;
}
// Área de quien REPORTA (para filtrar CC_USADOS): residente de área por su rol; capataz/mairy por sus
// cuadrillas si todas son de la misma área. Mezcla o desconocido = '' (sin filtro: ve todas).
function areaDeReportante(usuario){
  const porRol=areaDeUsuario(usuario); if(porRol) return porRol;
  const cuads=cuadrillasDeUsuario(usuario), map=areaDeCuadrillaMap(); let a=null;
  for(let i=0;i<cuads.length;i++){ const ar=map[cuads[i]]||'tierras'; if(a===null) a=ar; else if(a!==ar) return ''; }
  return a===null ? '' : a;
}
// Lee CC_USADOS y devuelve los string_cc que aplican al área dada ('' = todas). Empty en la hoja = tierras.
function ccUsadosParaArea(area){
  const rows=readSheet('CC_USADOS', CC_USADOS_HEADERS);
  return rows.filter(r=> String(r.string_cc||'').trim() && (!area || (norm(r.area)||'tierras')===area))
             .map(r=>String(r.string_cc).trim());
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
  if(tipo==='domfest') return { tipo, entrada:'', salida:'', tope:parseFloat(cfg.ord_domingo)||0 };
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
  const todas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS);
  if(u==='admin') return todas.map(r=>r.cuadrilla); // admin elige cuadrilla (§3)
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
  const personas=personalTodo.filter(p=> activaEnFecha(p, fecha) && cuadrillas.indexOf(p.cuadrilla)>=0)
    .map(p=>({ cedula:p.cedula||'', codigo:p.codigo||'', nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'' }));
  const jornada=jornadaDelDia(fecha, cfg, festivos);
  const catCC=readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean);
  const catCCUsados=ccUsadosParaArea(areaDeReportante(usuario));   // D72: CC frecuentes del área del reportante
  const catMotivos=readSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean);
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
  // D72: si el usuario es residente_odt/odl, se limita todo (filas, cuadrillas, faltantes) a su área.
  const area=areaDeUsuario(e.parameter.usuario||'');
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return !area || (cuadArea[cuadrilla]||'tierras')===area; };
  const filas=readSheet('ASISTENCIA', ASISTENCIA_HEADERS).filter(r=> fdate(r.fecha)===fecha && enArea(r.cuadrilla))
    .map(r=>({ id_registro:r.id_registro, timestamp:r.timestamp, fecha:fdate(r.fecha), reporta:r.reporta,
      cuadrilla:r.cuadrilla, codigo:r.codigo, cedula:r.cedula, nombre:r.nombre, cargo:r.cargo, cc:r.cc,
      proyecto:r.proyecto, hora_entrada:ftime(r.hora_entrada), hora_salida:ftime(r.hora_salida),
      presente:r.presente, motivo_ausencia:r.motivo_ausencia, observacion:r.observacion, turno:String(r.turno||'') }));
  const cuadrillasCat=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(cq=>enArea(cq.cuadrilla));
  // D72: roster date-aware + por área — "se esperaba" a esta persona en ESA fecha (no la foto de hoy).
  const personalActivo=readSheet('PERSONAL', PERSONAL_HEADERS).filter(p=>activaEnFecha(p, fecha) && enArea(p.cuadrilla));
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
  const catCC=readSheet('CAT_CC', CAT_CC_HEADERS).map(r=>String(r.string_cc||'')).filter(Boolean);
  const catCCUsados=ccUsadosParaArea(area);   // D72: en el resumen, CC frecuentes del área revisada ('' = todas)
  const catMotivos=readSheet('CAT_MOTIVOS', CAT_MOTIVOS_HEADERS).map(r=>String(r.string_motivo||'')).filter(Boolean);
  const turnos=readSheet('TURNOS', TURNOS_HEADERS).map(t=>({ turno:String(t.turno||''), tipo_dia:norm(t.tipo_dia),
    entrada:ftime(t.entrada), salida:ftime(t.salida), descanso_ini:ftime(t.descanso_ini), descanso_fin:ftime(t.descanso_fin),
    cruza_medianoche: String(t.cruza_medianoche||'').toUpperCase()==='SI' }));
  // D73: indicador de extras del admin del día (solo para el residente general/admin; un residente de área
  // no las ve — son de tierras). El resumen muestra "Extras admin: registradas ✓ / sin registrar".
  const extrasAdmin = area ? [] : extrasAdminDelDia(fecha);
  return json({ ok:true, fecha, filas, cuadrillas:cuadrillasEstado, faltantes, jornada, catCC, catCCUsados, catMotivos, turnos, extrasAdmin });
}

/* ---------- POST asistencia_individual: upsert por PERSONA (residente/jeisson completan faltantes) ----------
 * A diferencia de reporte_asistencia (que PISA toda la cuadrilla, D03), este upsert toca SOLO las
 * personas que llegan en `filas`: borra la fila de ESE día de cada persona entrante (si existía) y
 * la reescribe. Así el residente/jeisson pueden agregar faltantes o corregir un presente-sin-CC sin
 * borrar lo que ya reportó el responsable. Permitido a residente, admin y jeisson. */
function guardarIndividual(body){
  const usuario=norm(body.usuario);
  // D72: los residentes de área (odt/odl) también completan faltantes de SU gente.
  if(['residente','admin','jeisson','residente_odt','residente_odl'].indexOf(usuario)<0)
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
  if(todas.length) sh.getRange(2,1,todas.length,need).setValues(todas);
  return json({ok:true, filas:nuevas.length});
}

/* ---------- GET personal: gestión (residente general/admin ven todo; residente_odt/odl SOLO su área — D72) ---------- */
function personalCompleto(e){
  const area=areaDeUsuario(e.parameter.usuario||'');   // '' = todas (residente general/admin/jeisson)
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(c){ return !area || (cuadArea[c]||'tierras')===area; };
  const personal=readSheet('PERSONAL', PERSONAL_HEADERS).filter(p=>enArea(p.cuadrilla)).map(p=>({ _row:p._row, cedula:p.cedula||'', codigo:p.codigo||'',
    nombre:p.nombre||'', cargo:p.cargo||'', cuadrilla:p.cuadrilla||'', responsable:p.responsable||'',
    estado:p.estado||'activo', fecha_retiro:fdate(p.fecha_retiro), fecha_ingreso:fdate(p.fecha_ingreso) }));
  const cuadrillas=readSheet('CUADRILLAS', CUADRILLAS_HEADERS).filter(c=>enArea(c.cuadrilla)).map(c=>({ cuadrilla:c.cuadrilla||'', responsables:c.responsables||'' }));
  return json({ ok:true, personal, cuadrillas });
}

/* ---------- GET export: crudo del día completo para el generador Navision (cliente, SheetJS) ---------- */
function exportDia(e){
  const fecha=fdate(e.parameter.fecha);
  // D72: residente_odt/odl exportan SOLO su área; el residente general/admin exportan todo.
  const area=areaDeUsuario(e.parameter.usuario||'');
  const cuadArea=areaDeCuadrillaMap();
  const enArea=function(cuadrilla){ return !area || (cuadArea[cuadrilla]||'tierras')===area; };
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
  // día×proyecto. Solo al residente general/admin (area=''); un residente de área (odt/odl) NO recibe las
  // extras del admin (son CC de tierras 3701/3702, ajenas a su archivo).
  const extrasAdmin = area ? [] : extrasAdminDelDia(fecha);
  return json({ ok:true, fecha, filas, proyectoDefecto, catTrabajadores, config:getConfigMap(), festivos:getFestivos(), turnos, extrasAdmin });
}

/* ---------- EXTRAS_ADMIN (D73): canal "solo extras" del admin ----------
 * El admin registra sus horas extras de días puntuales (máx 2h/día). Aislado del roster: el admin NO
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
  if(isNaN(horas) || !(horas>0 && horas<=2)) return json({ok:false, error:'Las horas deben ser un número mayor que 0 y máximo 2.'});
  if(['diurna','nocturna','domfest'].indexOf(tipo)<0) return json({ok:false, error:'Tipo inválido (usa diurna, nocturna o domfest).'});
  const proyecto=proyectoFromCC(cc);
  const sh=getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS), need=EXTRAS_ADMIN_HEADERS.length, last=sh.getLastRow();
  let rows = last>1 ? sh.getRange(2,1,last-1,need).getValues() : [];
  rows = rows.filter(r=> fdate(r[0])!==fecha);         // clave lógica = fecha: re-guardar pisa el día
  rows.push([fecha, cc, proyecto, horas, tipo, new Date(), body.reporta||'admin']);
  sh.clearContents();
  sh.getRange(1,1,1,need).setValues([EXTRAS_ADMIN_HEADERS]);
  if(rows.length) sh.getRange(2,1,rows.length,need).setValues(rows);
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
  if(rows.length) sh.getRange(2,1,rows.length,need).setValues(rows);
  const borradas=antes-rows.length;
  return json({ ok:true, msg: borradas ? ('Extra del '+fecha+' eliminada.') : ('No había extra registrada el '+fecha+'.'), borradas });
}

/* ---------- POST reporte_asistencia: escritura directa (sin bandeja), pisa fecha+cuadrilla (D03) ---------- */
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
  if(todas.length) sh.getRange(2,1,todas.length,need).setValues(todas);
  return json({ ok:true, filas:nuevas.length });
}

/* ---------- POST personal: alta / retiro / mover / reactivar — SOLO residente/admin ---------- */
function gestionPersonal(body){
  const usuario=norm(body.usuario);
  // D72: residente general/admin gestionan TODO; los residentes de área (odt/odl) gestionan SOLO su área.
  if(['residente','admin','residente_odt','residente_odl'].indexOf(usuario)<0)
    return json({ok:false, error:'No autorizado: solo residente o admin.'});
  const areaUsr=areaDeUsuario(usuario);              // '' = todas (residente general/admin)
  const cuadArea=areaDeCuadrillaMap();
  const okArea=function(cuadrilla){ return !areaUsr || (cuadArea[cuadrilla]||'tierras')===areaUsr; };
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
  // D72: un residente de área solo puede retirar/reactivar/reingresar/mover filas de SU área.
  if(areaUsr){
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
  getSheet('EXTRAS_ADMIN', EXTRAS_ADMIN_HEADERS);   // D73: canal "solo extras" del admin (mis-extras.html)

  // D72: TURNOS asignados (5 turnos × tipo de día). Semilla fija con los horarios entregados; si el
  // usuario ya cargó la hoja, no se pisa. Horas como texto 'HH:MM' (00:00 = medianoche, fin de cena).
  const turSh=getSheet('TURNOS', TURNOS_HEADERS);
  if(turSh.getLastRow()<2){
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
    // D72: 3ª columna = área. Las cuadrillas de drenajes (ODT/ODL) las pega el usuario cuando llegue
    // el listado real (cuadrilla · responsables(login) · odt|odl); aquí solo van las de tierras.
    cuadSh.getRange(2,1,7,3).setValues([
      ['ANGEL','angel','tierras'], ['ROBINSON','robinson','tierras'], ['ALBERT','albert','tierras'],
      ['ARIEL','ariel','tierras'], ['ALEJANDRO','alejandro','tierras'], ['OPERADORES','jeisson','tierras'],
      ['VOLQUETEROS','mairy','tierras']
    ]);
  }

  const cfgSh=getSheet('CONFIG', CONFIG_HEADERS);
  if(cfgSh.getLastRow()<2){
    cfgSh.getRange(2,1,16,2).setValues([
      ['ord_lun_vie','7.5'], ['ord_sabado','4.5'], ['ord_domingo','0'],
      ['entrada_lv','07:00'], ['salida_lv','15:30'], ['entrada_sab','07:00'], ['salida_sab','11:30'],
      ['almuerzo_ini','12:00'], ['almuerzo_fin','13:00'],
      ['max_extras_dia','2'], ['nocturno_desde','19:00'], ['nocturno_hasta','06:00'],
      // Dom/Fest (criterio de nómina, D72): de la jornada base se reparten así las horas ordinarias.
      ['domfest_ord_base','8'], ['domfest_ord_horas','7.33'], ['domfest_scomp_horas','0.67'],
      ['proyecto_3701','3701| T2 - UF1 - R4513 PR 09+800 - PR 30+000']
    ]);
    cfgSh.appendRow(['proyecto_3702','PENDIENTE']); // parámetro abierto (§2 del prompt)
    // D73: No. Recurso del admin en Navision ("código| NOMBRE"), string EXACTO tal cual el listado de
    // Trabajadores (Navision lo lee verbatim). Valor del dueño (jul-2026). Si se deja vacío, el generador
    // NO agrega la fila del admin y avisa. OJO: debe coincidir carácter por carácter con Navision.
    cfgSh.appendRow(['admin_recurso','77463| CESAR AUGUSTO GALVIS SANDINO']);
  }

  const festSh=getSheet('FESTIVOS', FESTIVOS_HEADERS);
  if(festSh.getLastRow()<2){
    // Colombia 2026-2027, Ley Emiliani aplicada (verificado contra el algoritmo de Pascua + traslado a lunes).
    const festivos=[
      '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03','2026-05-01','2026-05-18',
      '2026-06-08','2026-06-15','2026-06-29','2026-07-20','2026-08-07','2026-08-17','2026-10-12',
      '2026-11-02','2026-11-16','2026-12-08','2026-12-25',
      '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26','2027-05-01','2027-05-10',
      '2027-05-31','2027-06-07','2027-07-05','2027-07-20','2027-08-07','2027-08-16','2027-10-18',
      '2027-11-01','2027-11-15','2027-12-08','2027-12-25'
    ];
    festSh.getRange(2,1,festivos.length,1).setValues(festivos.map(f=>[f]));
  }
}

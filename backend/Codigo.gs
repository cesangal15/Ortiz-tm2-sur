/**
 * Reporte Diario de Obra — Backend con BANDEJA (Google Apps Script)
 *
 * Flujo: capataz/chequeadora -> BANDEJA (crudo) ; equipos -> MAQUINARIA
 *        encargado revisa la bandeja y "Envía a DATA" -> DATA (oficial, limpio)
 *
 * Endpoints:
 *   GET  ?action=bandeja&fecha=YYYY-MM-DD[&proyecto=3701]   -> {cantidades:[](crudo), maquinas:[]}
 *   GET  ?action=consolidado&fecha=...   -> {cantidades:[](de DATA, ya enviado)}
 *   GET  ?action=estado&fecha=...        -> {reportadas:[{id_maquina,capataz}]}
 *   GET  ?action=debug&fecha=...
 *   POST  reporte: {fecha,rol,capataz,cantidades:[{...,equipos:[]}]}   -> BANDEJA
 *   POST  {action:'enviar_data', fecha, cantidades:[...incluidas...]}  -> DATA
 */

const SHEET_ID = '1OEAZCcj_kgVS6jWXxOSgyvm57sOsJ7fA1mRTJPU-icM';

// DATA: A–T orden del maestro ; U–AA internas
const DATA_HEADERS = ['FECHA','ORDEN','GRUPO','CENTRO DE COSTO','CAPITULO','DESCRIPCION',
  'UNIDAD FUNCIONAL','PROYECTO','ELEMENTO','ABS INICIAL','ABS FINAL','LIBERACION','ACTA',
  'UNIDAD MEDIDA','LARGO','ESPESOR','FC','CANTIDAD','OBSERVACION','Columna1',
  'id_registro','timestamp','capataz','rol','actividad','pk_inicial','pk_final'];
const C = { FECHA:0, LARGO:14, OBS:18 };

// BANDEJA: llaves limpias (lo crudo que reportan)
const BANDEJA_HEADERS = ['id_registro','timestamp','fecha','reporta','rol','grupo','capitulo',
  'actividad','descripcion','centro_costo','unidad','uf','proyecto','elemento',
  'pk_inicial','pk_final','abs_inicial','abs_final','liberacion','largo','observacion','estado'];

const MAQ_HEADERS = ['id_registro','id_cantidad','timestamp','fecha','reporta','id_maquina','tipo_equipo',
  'operador','actividad','descripcion','uf','proyecto','horas_programadas','horas_operadas','horas_muertas','motivo','produccion','unidad_prod'];

/* ---------- helpers ---------- */
function json(o){ return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
let _shTZ; function shTZ(){ if(!_shTZ) _shTZ=SpreadsheetApp.openById(SHEET_ID).getSpreadsheetTimeZone(); return _shTZ; }
function fdate(v){
  if(v === null || v === undefined || v === '') return '';
  if(typeof v === 'object' && typeof v.getFullYear === 'function')
    return v.getFullYear()+'-'+('0'+(v.getMonth()+1)).slice(-2)+'-'+('0'+v.getDate()).slice(-2);
  return String(v).slice(0,10);
}
function toDate(s){ const p=String(s||'').slice(0,10).split('-'); if(p.length<3) return ''; return new Date(Number(p[0]),Number(p[1])-1,Number(p[2])); }
function getSheet(name, headers){
  const ss=SpreadsheetApp.openById(SHEET_ID); let sh=ss.getSheetByName(name);
  if(!sh){ sh=ss.insertSheet(name); sh.appendRow(headers); }
  else if(sh.getLastRow()===0){ sh.appendRow(headers); }
  return sh;
}
function readSheet(name){
  const ss=SpreadsheetApp.openById(SHEET_ID), sh=ss.getSheetByName(name);
  if(!sh || sh.getLastRow()<2) return [];
  const v=sh.getDataRange().getValues(), h=v[0], out=[];
  for(let i=1;i<v.length;i++){ const o={}; h.forEach((k,j)=>o[k]=v[i][j]); o.fecha=fdate(o.fecha); o._row=i+1; out.push(o); }
  return out;
}
function buildDataRow(c, fecha, ts, reporta, rol, idC){
  return [ toDate(fecha), '', c.grupo||'', c.centro_costo||'', c.capitulo||'', c.descripcion||'',
    c.uf||'', c.proyecto||'', c.elemento||'', (c.abs_inicial!=null?c.abs_inicial:''), (c.abs_final!=null?c.abs_final:''),
    c.liberacion||'CAMPO', '', c.unidad||'', (c.largo!=null?c.largo:''), '', '', '', c.observacion||'', '',
    idC, ts, reporta||'', rol||'', c.actividad||'', c.pk_inicial||'', c.pk_final||'' ];
}

/* ---------- routing ---------- */
function doGet(e){
  const a=((e.parameter.action)||'').toLowerCase();
  if(a==='bandeja')     return bandeja(e);
  if(a==='consolidado') return consolidado(e);
  if(a==='estado')      return estado(e);
  if(a==='debug')       return debug(e);
  return json({ok:true, msg:'API viva', version:'v6'});
}
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents);
    if(body.action==='enviar_data') return enviarData(body);
    return guardarReporte(body);
  }catch(err){ return json({ok:false, error:String(err)}); }
}

/* ---------- capataz / chequeadora -> BANDEJA ---------- */
function guardarReporte(body){
  const fecha=fdate(body.fecha), reporta=body.capataz||'', rol=body.rol||'capataz', ts=new Date();
  const banSh=getSheet('BANDEJA', BANDEJA_HEADERS), maqSh=getSheet('MAQUINARIA', MAQ_HEADERS);
  const banRows=[], maqRows=[];
  (body.cantidades||[]).forEach(c=>{
    const idC=Utilities.getUuid();
    // todo entra a BANDEJA; cereo (data:false) marcado como 'no_data' para que el encargado lo vea pero no lo envíe a DATA
    banRows.push([idC, ts, fecha, reporta, rol, c.grupo||'', c.capitulo||'', c.actividad||'', c.descripcion||'', c.centro_costo||'',
      c.unidad||'', c.uf||'', c.proyecto||'', c.elemento||'', c.pk_inicial||'', c.pk_final||'', c.abs_inicial||'', c.abs_final||'', c.liberacion||'CAMPO',
      c.largo||0, c.observacion||'', (c.data===false)?'no_data':'pendiente']);
    // ZODME automático tras excavación no aprovechable
    if(c.data!==false && String(c.descripcion||'').toUpperCase().indexOf('NO APROVECHABLE')>=0){
        const proy=c.proyecto||'';
        banRows.push([Utilities.getUuid(), ts, fecha, reporta, rol, 'TIERRAS', 'EXPLANACIONES',
          'Conformación y disposición de sobrantes (ZODME)', 'Conformación y disposición de sobrantes',
          proy?(proy+'.02.08'):'', 'm3', c.uf, proy, c.elemento, c.pk_inicial, c.pk_final, c.abs_inicial, c.abs_final,
          c.liberacion, c.largo, 'Auto · secuencial a no aprovechable', 'pendiente']);
    }
    // equipos -> MAQUINARIA; vibrocompactadores y actividades de apoyo van sin producción
    (c.equipos||[]).forEach(m=>{
      const esVibro = m.tipo_equipo === 'VIBROCOMPACTADOR';
      const prod = (!esVibro && c.largo != null) ? c.largo : '';
      const uProd = (!esVibro && c.largo != null) ? c.unidad : '';
      maqRows.push([Utilities.getUuid(), idC, ts, fecha, reporta, m.id_maquina, m.tipo_equipo, m.operador,
        c.actividad, c.descripcion, c.uf, c.proyecto, m.horas_programadas, m.horas_operadas, m.horas_muertas, m.motivo,
        prod, uProd]);
    });
  });
  if(banRows.length) banSh.getRange(banSh.getLastRow()+1,1,banRows.length,BANDEJA_HEADERS.length).setValues(banRows);
  if(maqRows.length) maqSh.getRange(maqSh.getLastRow()+1,1,maqRows.length,MAQ_HEADERS.length).setValues(maqRows);
  return json({ok:true, cantidades:banRows.length, maquinas:maqRows.length});
}

/* ---------- bandeja para el encargado ---------- */
function bandeja(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  const cantidades=readSheet('BANDEJA').filter(r=> r.fecha===fecha && (!proy||String(r.proyecto)===proy));
  const maquinas=readSheet('MAQUINARIA').filter(r=> r.fecha===fecha && (!proy||String(r.proyecto)===proy));
  return json({fecha, cantidades, maquinas});
}

/* ---------- DATA ya enviada (para verificar) ---------- */
function consolidado(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  const ss=SpreadsheetApp.openById(SHEET_ID), sh=ss.getSheetByName('DATA');
  let cantidades=[];
  if(sh && sh.getLastRow()>1){
    const v=sh.getDataRange().getValues();
    for(let i=1;i<v.length;i++){
      if(fdate(v[i][C.FECHA])!==fecha) continue;
      if(proy && String(v[i][7])!==proy) continue;
      cantidades.push({ fecha, descripcion:v[i][5], actividad:v[i][24], uf:v[i][6], proyecto:String(v[i][7]||''),
        pk_inicial:v[i][25], largo:v[i][14], unidad:v[i][13] });
    }
  }
  return json({fecha, cantidades});
}

/* ---------- estado de maquinaria ---------- */
function estado(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  const maquinas=readSheet('MAQUINARIA').filter(r=> r.fecha===fecha && (!proy||String(r.proyecto)===proy));
  const seen={}, reportadas=[];
  maquinas.forEach(m=>{ if(!m.id_maquina||seen[m.id_maquina]) return; seen[m.id_maquina]=1; reportadas.push({id_maquina:m.id_maquina, capataz:m.reporta}); });
  return json({reportadas});
}

/* ---------- enviar lo aprobado a DATA ---------- */
function enviarData(body){
  const fecha=fdate(body.fecha), incluidas=body.cantidades||[], ts=new Date();
  // 1) DATA: borrar el día y reescribir
  const sh=getSheet('DATA', DATA_HEADERS);
  const v=sh.getDataRange().getValues(), del=[];
  for(let i=1;i<v.length;i++){ if(fdate(v[i][C.FECHA])===fecha) del.push(i+1); }
  del.sort((a,b)=>b-a).forEach(r=>sh.deleteRow(r));
  const rows=incluidas.filter(c=>c.estado!=='no_data').map(c=> buildDataRow(c, fecha, ts, c.reporta||'(encargado)', c.rol||'encargado', Utilities.getUuid()));
  if(rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,DATA_HEADERS.length).setValues(rows);
  // 2) BANDEJA: marcar incluido / descartado
  const banSh=getSheet('BANDEJA', BANDEJA_HEADERS);
  const bv=banSh.getDataRange().getValues(), bh=bv[0];
  const idCol=bh.indexOf('id_registro'), fCol=bh.indexOf('fecha'), eCol=bh.indexOf('estado');
  const inc={}; incluidas.forEach(c=>{ if(c.id_registro) inc[c.id_registro]=1; });
  for(let i=1;i<bv.length;i++){ if(fdate(bv[i][fCol])!==fecha) continue;
    banSh.getRange(i+1, eCol+1).setValue(inc[bv[i][idCol]]?'incluido':'descartado'); }
  return json({ok:true, enviadas:rows.length});
}

/* ---------- debug ---------- */
function debug(e){
  const fechaQ=fdate(e.parameter.fecha||'');
  const ban=readSheet('BANDEJA').filter(r=>r.fecha===fechaQ);
  const data=readSheet('DATA') ? '' : '';
  return json({version:'v6', sheetTZ:shTZ(), queryFecha:fechaQ, bandejaFilas:ban.length,
    muestra: ban.slice(0,5).map(r=>({reporta:r.reporta, rol:r.rol, actividad:r.actividad, pk:r.pk_inicial, largo:r.largo, estado:r.estado})) });
}

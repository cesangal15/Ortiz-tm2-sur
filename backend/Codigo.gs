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
 *   GET  ?action=cubicaje                -> {cubicaje:{PLACA:cubicaje,...}}  (catálogo placa→m³/viaje, D53)
 *   GET  ?action=debug&fecha=...
 *   POST  reporte: {fecha,rol,capataz,cantidades:[{...,equipos:[]}],volquetas:[{origen,destino,tipo_destino,uf,placas:[{placa,viajes}]}],maquinaria:[{id_maquina,...}]}
 *           -> BANDEJA (+ MAQUINARIA) ; chequeadora además -> VOLQUETAS (una fila por placa)
 *           y, si envía maquinaria, sus excavadoras -> MAQUINARIA (producción = total excavado ÷ nº máquinas, D54)
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

// MAQUINARIA: layout alineado a Captura_Diaria (fact_produccion, A1:AA) — D52.
// A→AA = columnas de la tabla Excel (entrada con valor; fórmula/no-captura en BLANCO);
// internos del app DESPUÉS de AA (trazabilidad y valores reales que en Captura son fórmula).
// El usuario pega el bloque A:AA (Pegado especial → Omitir blancos) de las filas con a_captura='SI'.
const MAQ_HEADERS = [
  // A    B        C      D          E             F             G
  'id_registro','fecha','dia','proyecto','id_maquina','tipo_equipo','operador',
  // H        I               J         K                   L                M
  'actividad','sub_actividad','unidad','horas_programadas','horas_operadas','pct_util',
  // N             O                    P            Q                  R        S
  'horas_muertas','horas_mantenimiento','pct_muerto','horas_facturadas','estado','clima',
  // T          U      V        W             X          Y        Z       AA
  'produccion','meta','pct_ef','rendimiento','unitario','viajes','costo','observacion',
  // ---- internos del app (después de AA) ----
  'app_id_registro','id_cantidad','timestamp','reporta','app_tipo_equipo',
  'app_horas_programadas','app_horas_muertas','motivo','unidad_prod','cap_actividad','a_captura'];

// Mapa actividad del capataz → [actividad(H), SUB ACTIVIDAD(I)] de Captura_Diaria (05_CATALOGO §1, D52)
const CAPTURA_ACT_MAP = {
  'Excavación aprovechable (masivo)':                 ['EXCAVACION COMUN','EXCAVACION APROVECHABLE'],
  'Excavación no aprovechable':                       ['EXCAVACION COMUN','EXCAVACION NO APROVECHABLE'],
  'Excavación de préstamo (Diviso)':                  ['EXCAVACION PRESTAMO','EXCAVACION APROVECHABLE'],
  'Núcleo de terraplén':                              ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'Corona de terraplén':                              ['TERRAPLEN','CORONA DE TERRAPLEN'],
  'Cereo de corona':                                  ['TERRAPLEN','CEREO CORONA'],
  'Conformación y disposición de sobrantes (ZODME)':  ['CONFORMACION','ZODME'],
  'Conformación de subbase':                          ['SUBBASE','CONFORMACION SUBBASE'],
  'Cereo de subbase':                                 ['SUBBASE','CEREO SUBBASE'],
  'Base estabilizada con cemento (BTC)':              ['BASE','BTC'],
  'Desmonte y limpieza en bosque':                    ['DESMONTE','DESMONTE'],
  'Descapote / zonas no boscosas':                    ['DESMONTE','DESCAPOTE']
};
// Apoyo de compactación: hereda H/I del frente que apoya (sub_actividad del catálogo del capataz)
const CAPTURA_APOYO_MAP = {
  'COMPACT_TERRAPLEN': ['TERRAPLEN','NUCLEO DE TERRAPLEN'],
  'COMPACT_SUBBASE':   ['SUBBASE','CONFORMACION SUBBASE'],
  'COMPACT_BTC':       ['BASE','BTC']
};
// Deriva {h, i, aCaptura} de la actividad del capataz (c). Sin par definido → a_captura='NO'
// (paisajeo, adecuación de caminos, limpieza de derrumbe, MSR, pedraplén).
function derivarActividad(c){
  if((c.actividad||'')==='APOYO'){
    const sub=c.sub_actividad||'';
    if(CAPTURA_APOYO_MAP[sub]) return {h:CAPTURA_APOYO_MAP[sub][0], i:CAPTURA_APOYO_MAP[sub][1], aCaptura:'SI'};
    return {h:'', i:'', aCaptura:'NO'}; // paisajeo / adecuación / derrumbe
  }
  const par=CAPTURA_ACT_MAP[c.actividad||''];
  if(par) return {h:par[0], i:par[1], aCaptura:'SI'};
  return {h:'', i:'', aCaptura:'NO'}; // MSR, pedraplén, sin par
}
// Deriva R (ESTADO) del motivo (05_CATALOGO §5, D52). Sin horas muertas → OPERANDO.
function derivarEstado(motivo, muertas){
  if(!(parseFloat(muertas)>0.01)) return 'OPERANDO';
  const m=(motivo||'').trim().toLowerCase();
  if(!m) return 'OPERANDO';
  if(m.indexOf('mantenimiento')>=0) return 'MANTENIMIENTO';
  if(m.indexOf('falla')>=0)         return 'VARADO';
  if(m.indexOf('sin operador')>=0)  return 'SIN OPERADOR';
  if(m.indexOf('lluvia')>=0 || m.indexOf('clima')>=0) return 'LLUVIAS';
  if(m.indexOf('bloqueo')>=0)       return 'BLOQUEO';
  // Sin frente / Esperando material / Abastecimiento / Traslado/movilización / Otro / texto libre
  return 'ESPERA';
}

const OBS_HEADERS = ['id_registro','timestamp','fecha','reporta','observacion'];

// VOLQUETAS: desglose por placa de la chequeadora (una fila por placa). No toca DATA ni MAQUINARIA.
// cubicaje·m3_placa·cubicaje_origen añadidos en D53 (2.10): cubicaje real por placa.
const VOLQUETAS_HEADERS = ['id_registro','timestamp','fecha','reporta','origen','destino',
  'tipo_destino','uf','placa','viajes','cubicaje','m3_placa','cubicaje_origen'];

// CUBICAJE: catálogo placa→cubicaje (m³/viaje) que mantiene el usuario como espejo de la
// Bitácora de Transporte. Lo lee el backend; no va a DATA (D53). `tipo` es opcional/informativo.
const CUBICAJE_HEADERS = ['placa','cubicaje','tipo'];

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
  if(!sh) sh=ss.insertSheet(name);
  const need=headers.length;
  // asegura ancho de grilla suficiente (p. ej. MAQUINARIA pasó de 18 a 38 columnas en D52)
  if(sh.getMaxColumns()<need) sh.insertColumnsAfter(sh.getMaxColumns(), need-sh.getMaxColumns());
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,need).setValues([headers]); return sh; }
  // auto-sana la fila de encabezados si no coincide con el esquema actual del código.
  // (tras el realineado de MAQUINARIA a Captura_Diaria, las filas con layout viejo quedan
  // con `fecha` ilegible y el filtro por fecha de la bandeja/estado las descarta solas.)
  const cur=sh.getRange(1,1,1,need).getValues()[0];
  let diff=false; for(let i=0;i<need;i++){ if(String(cur[i]||'')!==headers[i]){ diff=true; break; } }
  if(diff) sh.getRange(1,1,1,need).setValues([headers]);
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
  // ELEMENTO oficial: se busca en la hoja BASE por CC + descripción + abscisa (no se construye a mano).
  const lk = lookupElemento(c.centro_costo, c.descripcion, c.abs_inicial);
  const elemento = lk.elem ? lk.elem
                 : lk.revisar ? ('REVISAR · ' + (c.elemento || ('pk ' + (c.pk_inicial||''))))
                 : (c.elemento||''); // BASE vacía / sin candidato -> respaldo al texto previo
  return [ toDate(fecha), '', c.grupo||'', c.centro_costo||'', c.capitulo||'', c.descripcion||'',
    c.uf||'', c.proyecto||'', elemento, (c.abs_inicial!=null?c.abs_inicial:''), (c.abs_final!=null?c.abs_final:''),
    c.liberacion||'CAMPO', '', c.unidad||'', (c.largo!=null?c.largo:''), '', '', '', c.observacion||'', '',
    idC, ts, reporta||'', rol||'', c.actividad||'', c.pk_inicial||'', c.pk_final||'' ];
}

/* ---------- BASE: ELEMENTO fijo por CC + descripción + abscisa ----------
 * La hoja BASE (mismo Sheet) es la fuente del ELEMENTO oficial.
 * Columnas usadas: A=CC, F=DESCRIPCION, J=ELEMENTO, K=ABSCISA INICIO(m), L=ABSCISA FIN(m).
 * Cruce: misma actividad (CC, y descripción si está) + el PK reportado dentro del rango [K,L].
 * Error humano: si el PK cae justo fuera de un tramo pero a <= BASE_TOL_M metros, se ajusta
 * al tramo más cercano de esa actividad; si está más lejos, se marca REVISAR (visible en DATA
 * antes de pegar al maestro) en vez de inventar un elemento. */
const BASE_TOL_M = 30; // metros de tolerancia para ajustar un PK cercano (editable)
let _baseRows;
function normKey(s){
  return String(s==null?'':s).toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // sin acentos
    .replace(/\s+/g,' ').trim();
}
function getBaseRows(){
  if(_baseRows) return _baseRows;
  _baseRows = [];
  const ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName('BASE');
  if(!sh || sh.getLastRow() < 2) return _baseRows;
  const v = sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){
    const cc=v[i][0], desc=v[i][5], elem=v[i][9];
    if(elem==='' || elem==null) continue;
    let ini=Number(v[i][10]), fin=Number(v[i][11]);
    if(isNaN(ini)) ini=null;
    if(isNaN(fin)) fin=(ini!=null?ini:null);
    if(ini!=null && fin!=null && fin<ini){ const t=ini; ini=fin; fin=t; }
    _baseRows.push({ cc:normKey(cc), desc:normKey(desc), elem:String(elem), ini:ini, fin:fin });
  }
  return _baseRows;
}
// -> { elem:'<ELEMENTO>'|'' , revisar:true|false }
function lookupElemento(cc, descripcion, pkMeters){
  const rows=getBaseRows();
  if(!rows.length) return { elem:'', revisar:false };
  const nCC=normKey(cc), nDesc=normKey(descripcion);
  const pk=(pkMeters===''||pkMeters==null||isNaN(Number(pkMeters)))?null:Number(pkMeters);
  // candidatos: 1º CC+descripción, 2º solo CC, 3º solo descripción
  let cand = (nCC&&nDesc) ? rows.filter(r=>r.cc===nCC && r.desc===nDesc) : [];
  if(!cand.length && nCC)   cand = rows.filter(r=>r.cc===nCC);
  if(!cand.length && nDesc) cand = rows.filter(r=>r.desc===nDesc);
  if(!cand.length) return { elem:'', revisar:false };
  if(pk==null) return cand.length===1 ? { elem:cand[0].elem, revisar:false } : { elem:'', revisar:false };
  // 1) PK dentro del rango del tramo
  const hit = cand.filter(r=>r.ini!=null && r.fin!=null && pk>=r.ini && pk<=r.fin);
  if(hit.length) return { elem:hit[0].elem, revisar:false };
  // 2) PK cercano (error humano): ajustar al tramo más próximo dentro de la tolerancia
  let best=null, bestD=Infinity;
  cand.forEach(r=>{ if(r.ini==null||r.fin==null) return;
    const d = pk<r.ini ? (r.ini-pk) : (pk-r.fin);
    if(d<bestD){ bestD=d; best=r; } });
  if(best && bestD<=BASE_TOL_M) return { elem:best.elem, revisar:false };
  // 3) sin coincidencia razonable -> marcar para revisión del encargado
  return { elem:'', revisar:true };
}

/* ---------- CUBICAJE: cubicaje real por placa (D53 / 2.10) ----------
 * Hoja CUBICAJE (mismo Sheet): placa · cubicaje [· tipo]. Devuelve un mapa
 * placa(6 chars normalizada) -> cubicaje (m³/viaje). La placa se normaliza EXACTAMENTE
 * igual que el parser de D48 (sin espacios ni guion, MAYÚSCULAS, últimos 6 alfanuméricos)
 * para que el cruce con las placas que teclea la chequeadora calce. Si la hoja no existe,
 * está vacía o un valor es inválido, esa placa simplemente no entra al mapa (todo cae al
 * fallback del factor editable, 14 por defecto). */
function normPlaca(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(-6); }
let _cubMap;
function getCubicajeMap(){
  if(_cubMap) return _cubMap;
  _cubMap = {};
  const ss=SpreadsheetApp.openById(SHEET_ID), sh=ss.getSheetByName('CUBICAJE');
  if(!sh || sh.getLastRow()<2) return _cubMap;
  const v=sh.getDataRange().getValues(), h=v[0];
  // ubica columnas por nombre de cabecera (tolerante); por defecto A=placa, B=cubicaje
  let pi=0, ci=1;
  for(let j=0;j<h.length;j++){
    const k=String(h[j]==null?'':h[j]).toLowerCase().trim();
    if(k.indexOf('placa')>=0) pi=j;
    else if(k.indexOf('cubicaje')>=0 || k.indexOf('m3')>=0 || k.indexOf('m³')>=0) ci=j;
  }
  for(let i=1;i<v.length;i++){
    const placa=normPlaca(v[i][pi]);
    const cub=parseFloat(v[i][ci]);
    if(placa && !isNaN(cub) && cub>0) _cubMap[placa]=cub;
  }
  return _cubMap;
}

/* ---------- routing ---------- */
function doGet(e){
  const a=((e.parameter.action)||'').toLowerCase();
  if(a==='bandeja')     return bandeja(e);
  if(a==='consolidado') return consolidado(e);
  if(a==='estado')      return estado(e);
  if(a==='cubicaje')    return json({ok:true, cubicaje:getCubicajeMap()});
  if(a==='debug')       return debug(e);
  return json({ok:true, msg:'API viva', version:'v8'});
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
  // D53: cubicaje real por placa. Procesamos VOLQUETAS antes que las cantidades para que el
  // volumen oficial de excavación/terraplén use Σ(viajes_placa × cubicaje_placa) en vez de total×14.
  // El factor editable del reporte (14 por defecto) es el fallback para placas no catalogadas.
  const cubMap=getCubicajeMap();
  const factorReporte=parseFloat(body.m3viaje)>0 ? parseFloat(body.m3viaje) : 14;
  const lineVol={}; // _linea -> volumen real (m³) calculado desde las placas
  const volRows=[];
  (body.volquetas||[]).forEach(line=>{
    const idV=Utilities.getUuid();
    let m3line=0;
    (line.placas||[]).forEach(p=>{
      const placaN=normPlaca(p.placa);
      const viajes=Number(p.viajes)||0;
      const found=Object.prototype.hasOwnProperty.call(cubMap, placaN);
      const cub=found ? cubMap[placaN] : factorReporte;          // catálogo o fallback
      const m3p=viajes*cub;
      m3line+=m3p;
      volRows.push([idV, ts, fecha, reporta, line.origen||'', line.destino||'', line.tipo_destino||'',
        line.uf||'', p.placa||'', (p.viajes!=null?p.viajes:''), cub, m3p, found?'catalogo':'default']);
    });
    if(line._linea!=null) lineVol[line._linea]=m3line;
  });
  (body.cantidades||[]).forEach(c=>{
    // D53: la chequeadora es la fuente del volumen (D06); para sus líneas el largo oficial = m³ real
    // por placa calculado arriba (excavación y, si aplica, terraplén comparten _linea).
    if(rol==='chequeadora' && c._linea!=null && lineVol[c._linea]!=null) c.largo=lineVol[c._linea];
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
    // equipos -> MAQUINARIA (layout Captura A→AA + internos del app, D52)
    const der = derivarActividad(c);
    (c.equipos||[]).forEach(m=>{
      const esVibro = (m.tipo_equipo||'').toUpperCase() === 'VIBROCOMPACTADOR';
      const esApoyo = (c.actividad||'') === 'APOYO';
      // T Producción: largo de la actividad EXCEPTO vibros y actividades de apoyo → blanco (D41/D44)
      const prod  = (esVibro || esApoyo || c.largo == null || c.largo === '') ? '' : c.largo;
      const uProd = (prod === '') ? '' : (c.unidad || '');
      // O Horas Mantenimiento: prog−oper solo si motivo=Mantenimiento; en otro caso blanco
      const esMant = (m.motivo||'').trim().toLowerCase().indexOf('mantenimiento') >= 0;
      const hMant  = esMant ? Math.max(0, (parseFloat(m.horas_programadas)||0) - (parseFloat(m.horas_operadas)||0)) : '';
      // R ESTADO derivado del motivo
      const estado = derivarEstado(m.motivo, m.horas_muertas);
      maqRows.push([
        // A vacío (autonumera Captura) · B fecha · C vacío · D proyecto · E id_maquina · F vacío · G operador
        '', fecha, '', c.proyecto, m.id_maquina, '', m.operador,
        // H actividad(der) · I sub(der) · J vacío · K vacío(fórmula) · L horas_operadas · M vacío
        der.h, der.i, '', '', m.horas_operadas, '',
        // N vacío(fórmula) · O h_mantenimiento · P vacío · Q vacío · R estado · S vacío(clima)
        '', hMant, '', '', estado, '',
        // T produccion · U–X vacío · Y vacío(viajes) · Z vacío · AA observacion
        prod, '', '', '', '', '', '', c.observacion||'',
        // internos del app
        Utilities.getUuid(), idC, ts, reporta, m.tipo_equipo, m.horas_programadas, m.horas_muertas,
        m.motivo, uProd, c.actividad, der.aCaptura]);
    });
  });
  // Maquinaria de la chequeadora (D54): excavadoras que alimentaron el origen. Una vez por reporte.
  // Producción = total excavado del día (Σ líneas, con cubicaje real) REPARTIDO en partes iguales
  // entre las máquinas (cada una cumple su papel). Va a MAQUINARIA; el encargado reconcilia si un
  // capataz reportó la misma máquina (D51). D06: el volumen sigue viniendo de la chequeadora.
  (function(){
    const maqList=body.maquinaria||[];
    if(!maqList.length) return;
    const totalExc=Object.keys(lineVol).reduce((s,k)=>s+lineVol[k],0);
    const nProd=maqList.filter(m=>(m.tipo_equipo||'').toUpperCase()!=='VIBROCOMPACTADOR').length || 1;
    const prodCada=totalExc/nProd;
    // proyecto y actividad del frente de excavación (todas las líneas comparten origen)
    let proyMaq='', actMaq='';
    (body.cantidades||[]).forEach(c=>{ if(!actMaq && String(c.actividad||'').indexOf('Excavaci')>=0){ actMaq=c.actividad; proyMaq=c.proyecto||''; } });
    if(!proyMaq && (body.cantidades||[]).length) proyMaq=body.cantidades[0].proyecto||'';
    const der=derivarActividad({actividad:actMaq});
    maqList.forEach(m=>{
      const esVibro=(m.tipo_equipo||'').toUpperCase()==='VIBROCOMPACTADOR';
      const prod=esVibro ? '' : prodCada;          // vibros nunca llevan producción (D44)
      const uProd=(prod==='') ? '' : 'm3';
      const esMant=(m.motivo||'').trim().toLowerCase().indexOf('mantenimiento')>=0;
      const hMant=esMant ? Math.max(0,(parseFloat(m.horas_programadas)||0)-(parseFloat(m.horas_operadas)||0)) : '';
      const estado=derivarEstado(m.motivo, m.horas_muertas);
      maqRows.push([
        '', fecha, '', proyMaq, m.id_maquina, '', m.operador,
        der.h, der.i, '', '', m.horas_operadas, '',
        '', hMant, '', '', estado, '',
        prod, '', '', '', '', '', '', '',
        Utilities.getUuid(), '', ts, reporta, m.tipo_equipo, m.horas_programadas, m.horas_muertas,
        m.motivo, uProd, actMaq, der.aCaptura]);
    });
  })();
  if(banRows.length) banSh.getRange(banSh.getLastRow()+1,1,banRows.length,BANDEJA_HEADERS.length).setValues(banRows);
  if(maqRows.length) maqSh.getRange(maqSh.getLastRow()+1,1,maqRows.length,MAQ_HEADERS.length).setValues(maqRows);
  // chequeadora: desglose por placa -> VOLQUETAS (una fila por placa). No toca DATA ni MAQUINARIA.
  // Un id_registro por línea de PK destino (placas de la misma línea comparten id).
  // Las filas (con cubicaje·m3_placa·cubicaje_origen) se construyeron arriba junto al cálculo del volumen.
  if(volRows.length){ const volSh=getSheet('VOLQUETAS', VOLQUETAS_HEADERS);
    volSh.getRange(volSh.getLastRow()+1,1,volRows.length,VOLQUETAS_HEADERS.length).setValues(volRows); }
  const obs=(body.observacion_general||'').trim();
  if(obs) getSheet('OBSERVACIONES', OBS_HEADERS).appendRow([Utilities.getUuid(), ts, fecha, reporta, obs]);
  return json({ok:true, cantidades:banRows.length, maquinas:maqRows.length, volquetas:volRows.length});
}

/* ---------- bandeja para el encargado ---------- */
function bandeja(e){
  const fecha=fdate(e.parameter.fecha), proy=e.parameter.proyecto||'';
  getSheet('MAQUINARIA', MAQ_HEADERS); // auto-sana encabezados al layout D52 antes de leer
  const cantidades=readSheet('BANDEJA').filter(r=> r.fecha===fecha && (!proy||String(r.proyecto)===proy));
  const maquinas=readSheet('MAQUINARIA').filter(r=> r.fecha===fecha && (!proy||String(r.proyecto)===proy));
  const observaciones=readSheet('OBSERVACIONES').filter(r=>r.fecha===fecha).map(r=>({reporta:r.reporta||'', observacion:r.observacion||''}));
  return json({fecha, cantidades, maquinas, observaciones});
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
  getSheet('MAQUINARIA', MAQ_HEADERS); // auto-sana encabezados al layout D52 antes de leer
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
  return json({version:'v8', sheetTZ:shTZ(), queryFecha:fechaQ, bandejaFilas:ban.length,
    muestra: ban.slice(0,5).map(r=>({reporta:r.reporta, rol:r.rol, actividad:r.actividad, pk:r.pk_inicial, largo:r.largo, estado:r.estado})) });
}

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
 *   GET  ?action=maquinaria_produccion&fecha=...  -> cruce MAQUINARIA(CC 02.05-08) × volumen oficial DATA (2.4/D55)
 *   POST {action:'maquinaria_produccion', fecha, ajustes:[{id_registro,produccion}]} -> parcha SOLO col T de MAQUINARIA
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
// col 23 `origen`: banco de material (Masivo 1, Masivo 2, Complementario, Otro) para filas de
// excavación aprovechable de la chequeadora; vacío para capataz/encargado (D56).
const BANDEJA_HEADERS = ['id_registro','timestamp','fecha','reporta','rol','grupo','capitulo',
  'actividad','descripcion','centro_costo','unidad','uf','proyecto','elemento',
  'pk_inicial','pk_final','abs_inicial','abs_final','liberacion','largo','observacion','estado','origen'];

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
  'app_horas_programadas','app_horas_muertas','motivo','unidad_prod','cap_actividad','a_captura',
  // produccion_capataz_orig: estimado geométrico original del capataz (largo, D20) que el panel
  // produccion-maquinaria.html (2.4/D55) sustituye por el volumen oficial de la chequeadora.
  // Se escribe SOLO la primera vez que se ajusta la fila, para conservar el estimado original.
  'produccion_capataz_orig'];

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
// Tipos cuya producción (T) es SIEMPRE nula: vibrocompactadores + minicargador/minibuldozer (D41/D44).
// Estas máquinas compactan/apoyan frentes de otras; no generan producción propia.
function esTipoSinProduccion(tipo){
  const t=(tipo||'').toUpperCase();
  return t==='VIBROCOMPACTADOR' || t==='MINICARGADOR' || t==='MINIBULDOZER';
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
  // Ubicación (UF/PROYECTO/CC/ABS) derivada del PK con el helper único (Problema 2.12, D04).
  const mi = pkMeters(c.pk_inicial), mf = pkMeters(c.pk_final);
  let uf = c.uf||'', proy = c.proyecto||'', cc = c.centro_costo||'';
  if(mi != null){                                   // D04: PK≤30→UF1/3701; >30→UF2/3702
    uf   = mi <= 30000 ? 'UF1' : 'UF2';
    proy = uf === 'UF1' ? '3701' : '3702';
    const cod = ccCorto(c.centro_costo);            // "02.05" -> reancla el proyecto correcto al CC
    cc = cod ? (proy + '.' + cod) : cc;
  }
  // ELEMENTO oficial desde la hoja BASE (catálogo de elementos), eligiendo la FUENTE según la
  // actividad (D63): préstamo→EL DIVISO, estructuras/MSR→elemento MSR del PK, conformación→RCD,
  // resto (aprovechable/no aprovechable/terraplén/subbase/base)→tramo "tm2 pk X-Y" por abscisa. Si no
  // hay elemento para esa actividad/PK, se arma desde el PK con el helper único (sin "Pk Pk"). REVISAR
  // queda SÓLO para el caso legítimo (el PK no pertenece a ningún tramo del eje / falta el marcador).
  const lk = lookupElemento(cc, c.descripcion, mi);
  const pkElem = buildElemento(c.pk_inicial, c.pk_final);
  const elem = lk.elem ? lk.elem
             : lk.revisar ? ('REVISAR · ' + (pkElem || c.elemento || ('pk ' + (c.pk_inicial||''))))
             : (pkElem || c.elemento || '');
  const absIni = mi != null ? mi : (c.abs_inicial!=null ? c.abs_inicial : '');
  const absFin = mf != null ? mf : (c.abs_final!=null ? c.abs_final : '');
  return [ toDate(fecha), '', c.grupo||'', cc, c.capitulo||'', c.descripcion||'',
    uf, proy, elem, absIni, absFin,
    c.liberacion||'CAMPO', '', c.unidad||'', (c.largo!=null?c.largo:''), '', '', '', c.observacion||'', '',
    idC, ts, reporta||'', rol||'', c.actividad||'', c.pk_inicial||'', c.pk_final||'' ];
}

/* ---------- ELEMENTO + PK: helper único (Problema 2.12) ----------
 * Un solo lugar arma el ELEMENTO y normaliza el PK (misma lógica en backend y en los HTML).
 *   - un solo PK:  "tm2 pk NN+NNN"
 *   - con final:   "tm2 pk NN+NNN - NN+NNN"
 * Nunca duplica el token "pk"/"Pk": lo quita antes de anteponer "tm2 pk". Si el PK final viene
 * embebido en el campo inicial ("20+830 - 20+800") lo separa. Devuelve '' si no hay PK legible.
 * pkMeters() tolera "20+875", "Pk 20+875", espacios y el prefijo pk; un número suelto = kilómetro. */
function pkMeters(s){
  if(s==null) return null;
  const t=String(s).toLowerCase().replace(/pk/g,'').replace(/\s+/g,'');
  const m=t.match(/(\d+)\+(\d+)/);
  if(m) return parseInt(m[1],10)*1000 + parseInt(m[2],10);
  const n=parseFloat(t);
  return isNaN(n) ? null : n*1000;
}
function pkFmt(meters){
  if(meters==null || isNaN(meters)) return '';
  const km=Math.floor(meters/1000), r=Math.round(meters-km*1000);
  return km + '+' + ('00'+r).slice(-3);
}
function pkNorm(s){ return pkFmt(pkMeters(s)); }
function buildElemento(pkIni, pkFin){
  let ini=pkIni, fin=pkFin;
  if((fin==null||fin==='') && pkIni!=null){           // rango tecleado en un solo campo
    const p=String(pkIni).split(/\s*-\s*/);
    if(p.length>=2){ ini=p[0]; fin=p.slice(1).join(' - '); }
  }
  const a=pkNorm(ini);
  if(!a) return '';                                    // sin PK válido: el llamador decide
  const b=pkNorm(fin);
  return b ? ('tm2 pk '+a+' - '+b) : ('tm2 pk '+a);
}

/* ---------- BASE: ELEMENTO oficial, fuente por ACTIVIDAD (D63) ----------
 * La hoja BASE (mismo Sheet) tiene VARIAS tablas lado a lado (ítems, elementos, liberación, acta…),
 * alineadas por fila sólo por accidente — NO es una sola tabla. La de elementos vive en J/K/L:
 * J=ELEMENTO, K=ABSCISA INICIO, L=ABSCISA FIN. Por eso NO se cruza por la descripción/CC de la tabla
 * de ítems (es OTRA tabla); el ELEMENTO se elige según la ACTIVIDAD del reporte y se cruza por abscisa.
 *
 * Tipos de elemento en esa tabla y a qué actividad pertenecen (confirmado por el usuario):
 *   - TRAMO  "tm2 pk X - Y"  → explanaciones/bases: excavación aprovechable y NO aprovechable,
 *                              terraplén, subbase, base. Parten el eje (9+800→39+560) por abscisa.
 *   - DIVISO "EL DIVISO"     → excavación de PRÉSTAMO (CC 02.06).
 *   - MSR    "MSR …"         → estructuras / MSR (CC 05.* y 02.12); por abscisa entre las MSR.
 *   - RCD    "RCD …"         → conformación / disposición (CC 02.08). (Por ahora todo 02.08 va a RCD;
 *                              distinguir ZODME "ZODME PK30" queda PENDIENTE — el usuario trabaja sólo RCD.)
 *   - ODT*   (drenajes)      → FUERA de alcance (V1, D22). Se ignoran; comparten PK con los tramos.
 * REVISAR sólo para el caso legítimo: el PK no pertenece a ningún tramo del eje, o falta el marcador. */
const BASE_TOL_M = 30; // metros de tolerancia para ajustar un PK cercano a un tramo (error humano)
let _baseRows;
// Abscisa de la BASE a metros: número = metros tal cual; texto con '+' = PK ("20+875"→20875).
function baseAbs(v){
  if(v===''||v==null) return null;
  if(typeof v==='number') return isNaN(v)?null:v;
  const s=String(v).trim();
  if(s.indexOf('+')>=0) return pkMeters(s);
  const n=Number(s);
  return isNaN(n)?null:n;
}
// Tipo de un elemento de la BASE por su texto. '' = fuera de alcance (ODT/drenajes u otros).
function baseTipo(elem){
  const e=String(elem==null?'':elem);
  if(/^\s*tm2\s*pk/i.test(e)) return 'TRAMO';
  if(/diviso/i.test(e))       return 'DIVISO';
  if(/^\s*msr/i.test(e))      return 'MSR';
  if(/^\s*rcd/i.test(e))      return 'RCD';
  if(/zodme/i.test(e))        return 'ZODME';   // clasificado pero aún sin actividad asignada (pendiente)
  return '';                                     // ODT* y demás -> fuera
}
// Conjunto de elementos a usar según el CC corto de la actividad (NN.NN).
function baseSetFor(ccCortoStr){
  const c=String(ccCortoStr||'');
  if(c==='02.06') return 'DIVISO';                       // excavación de préstamo
  if(c.indexOf('05.')===0 || c==='02.12') return 'MSR';  // estructuras / MSR
  if(c==='02.08') return 'RCD';                          // conformación/disposición (ZODME pendiente)
  return 'TRAMO';                                        // aprovechable/no aprovechable/terraplén/subbase/base
}
function getBaseRows(){
  if(_baseRows) return _baseRows;
  _baseRows = [];
  const ss = SpreadsheetApp.openById(SHEET_ID), sh = ss.getSheetByName('BASE');
  if(!sh || sh.getLastRow() < 2) return _baseRows;
  const v = sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++){
    const elem=v[i][9];                                   // J = ELEMENTO
    if(elem==='' || elem==null) continue;
    const tipo=baseTipo(elem);
    if(!tipo) continue;                                   // ODT/drenajes y otros -> fuera
    let ini=baseAbs(v[i][10]), fin=baseAbs(v[i][11]);     // K = ABS INICIO, L = ABS FIN
    if(fin==null) fin=ini;
    if(ini==null) ini=fin;
    if(ini!=null && fin!=null && fin<ini){ const t=ini; ini=fin; fin=t; }
    _baseRows.push({ elem:String(elem), ini:ini, fin:fin, tipo:tipo });
  }
  return _baseRows;
}
// -> { elem:'<ELEMENTO>'|'' , revisar:true|false }
function lookupElemento(cc, descripcion, pkMetersIn){
  const all=getBaseRows();
  if(!all.length) return { elem:'', revisar:false };
  const set=baseSetFor(ccCorto(cc));
  const rows=all.filter(r=>r.tipo===set);
  // DIVISO / RCD: marcador ligado a la ACTIVIDAD (no al PK) -> se devuelve directo.
  if(set==='DIVISO' || set==='RCD'){
    return rows.length ? { elem:rows[0].elem, revisar:false } : { elem:'', revisar:true };
  }
  // TRAMO / MSR: por abscisa dentro del conjunto.
  if(!rows.length) return { elem:'', revisar:false };     // sin filas de ese tipo -> respaldo PK
  const pk=(pkMetersIn===''||pkMetersIn==null||isNaN(Number(pkMetersIn)))?null:Number(pkMetersIn);
  if(pk==null) return { elem:'', revisar:false };
  // 1) PK dentro de un tramo (sin solape → uno solo; si lo hubiera, gana el de rango más angosto).
  const hits=rows.filter(r=>r.ini!=null && r.fin!=null && pk>=r.ini && pk<=r.fin);
  if(hits.length){
    hits.sort((a,b)=>(a.fin-a.ini)-(b.fin-b.ini));
    return { elem:hits[0].elem, revisar:false };
  }
  // 2) PK cercano (error humano): ajustar al tramo más próximo dentro de la tolerancia
  let best=null, bestD=Infinity;
  rows.forEach(r=>{ if(r.ini==null||r.fin==null) return;
    const d = pk<r.ini ? (r.ini-pk) : (pk-r.fin);
    if(d<bestD){ bestD=d; best=r; } });
  if(best && bestD<=BASE_TOL_M) return { elem:best.elem, revisar:false };
  // 3) el PK no pertenece a ningún tramo/zona del conjunto -> revisión humana
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
  if(a==='maquinaria_produccion') return maquinariaProduccion(e);
  if(a==='debug')       return debug(e);
  return json({ok:true, msg:'API viva', version:'v9'});
}
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents);
    if(body.action==='enviar_data') return enviarData(body);
    if(body.action==='maquinaria_produccion') return maquinariaProduccionGuardar(body);
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
  // Problema 2.12: la EXCAVACIÓN de la chequeadora se acumula al ORIGEN (una sola fila por reporte =
  // Σ de todas las líneas, al PK del origen). El TERRAPLÉN no cambia: sigue 1 fila por línea al PK
  // destino. D06: el volumen sigue viniendo de la chequeadora (cubicaje real por placa, D53).
  const totalExc=Object.keys(lineVol).reduce((s,k)=>s+(lineVol[k]||0),0);
  (body.cantidades||[]).forEach(c=>{
    if(rol==='chequeadora'){
      if(c._acumOrigen) c.largo=totalExc;                                  // excavación acumulada al origen
      else if(c._linea!=null && lineVol[c._linea]!=null) c.largo=lineVol[c._linea]; // terraplén por línea
    }
    const idC=Utilities.getUuid();
    // D56: origen del banco de material para la fila de excavación acumulada de la chequeadora; la
    // chequeadora lo manda en c.origen (la fila acumulada ya no tiene un _linea único).
    const origenBandeja = (rol==='chequeadora') ? (c.origen||'') : '';
    // todo entra a BANDEJA; cereo (data:false) marcado como 'no_data' para que el encargado lo vea pero no lo envíe a DATA
    banRows.push([idC, ts, fecha, reporta, rol, c.grupo||'', c.capitulo||'', c.actividad||'', c.descripcion||'', c.centro_costo||'',
      c.unidad||'', c.uf||'', c.proyecto||'', c.elemento||'', c.pk_inicial||'', c.pk_final||'', c.abs_inicial||'', c.abs_final||'', c.liberacion||'CAMPO',
      c.largo||0, c.observacion||'', (c.data===false)?'no_data':'pendiente', origenBandeja]);
    // ZODME automático tras excavación no aprovechable (origen vacío: no es excavación aprovechable).
    // D58: si la no aprovechable nació de descapote/desmonte (c.derivada), el ZODME hereda el sello
    // 'orig:descapote/desmonte' en su observación para que la reconciliación del encargado no lo apague
    // por una no aprovechable de chequeadora de otro frente.
    if(c.data!==false && String(c.descripcion||'').toUpperCase().indexOf('NO APROVECHABLE')>=0){
        const proy=c.proyecto||'';
        const obsZodme = c.derivada ? 'Auto · ZODME de descapote/desmonte · orig:descapote/desmonte'
                                    : 'Auto · secuencial a no aprovechable';
        banRows.push([Utilities.getUuid(), ts, fecha, reporta, rol, 'TIERRAS', 'EXPLANACIONES',
          'Conformación y disposición de sobrantes (ZODME)', 'Conformación y disposición de sobrantes',
          proy?(proy+'.02.08'):'', 'm3', c.uf, proy, c.elemento, c.pk_inicial, c.pk_final, c.abs_inicial, c.abs_final,
          c.liberacion, c.largo, obsZodme, 'pendiente', '']);
    }
    // equipos -> MAQUINARIA (layout Captura A→AA + internos del app, D52)
    const der = derivarActividad(c);
    (c.equipos||[]).forEach(m=>{
      const esVibro = esTipoSinProduccion(m.tipo_equipo);
      const esApoyo = (c.actividad||'') === 'APOYO';
      // T Producción: largo de la actividad EXCEPTO vibros/minis y actividades de apoyo → blanco (D41/D44).
      // D58: desmonte/descapote llevan la producción de la máquina aparte (m²/m³), distinta del largo
      // contractual de la fila (Ha). Si la fila trae prod_maquina, ese valor (y su unidad) manda en T.
      const tieneProdMaq = (c.prod_maquina != null && c.prod_maquina !== '');
      const baseProd = tieneProdMaq ? c.prod_maquina : c.largo;
      const prod  = (esVibro || esApoyo || baseProd == null || baseProd === '') ? '' : baseProd;
      const uProd = (prod === '') ? '' : (tieneProdMaq ? (c.unidad_maquina || '') : (c.unidad || ''));
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
        m.motivo, uProd, c.actividad, der.aCaptura, '']);
    });
  });
  // Maquinaria de la chequeadora (D54): excavadoras que alimentaron el origen. Una vez por reporte.
  // Producción = total excavado del día (Σ líneas, con cubicaje real) REPARTIDO en partes iguales
  // entre las máquinas (cada una cumple su papel). Va a MAQUINARIA; el encargado reconcilia si un
  // capataz reportó la misma máquina (D51). D06: el volumen sigue viniendo de la chequeadora.
  (function(){
    const maqList=body.maquinaria||[];
    if(!maqList.length) return;
    // totalExc (Σ líneas) ya calculado arriba para la excavación acumulada al origen (Problema 2.12).
    const nProd=maqList.filter(m=>!esTipoSinProduccion(m.tipo_equipo)).length || 1;
    const prodCada=totalExc/nProd;
    // proyecto y actividad del frente de excavación (todas las líneas comparten origen)
    let proyMaq='', actMaq='';
    (body.cantidades||[]).forEach(c=>{ if(!actMaq && String(c.actividad||'').indexOf('Excavaci')>=0){ actMaq=c.actividad; proyMaq=c.proyecto||''; } });
    if(!proyMaq && (body.cantidades||[]).length) proyMaq=body.cantidades[0].proyecto||'';
    const der=derivarActividad({actividad:actMaq});
    maqList.forEach(m=>{
      const esVibro=esTipoSinProduccion(m.tipo_equipo);
      const prod=esVibro ? '' : prodCada;          // vibros/minis nunca llevan producción (D44)
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
        m.motivo, uProd, actMaq, der.aCaptura, '']);
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

/* ---------- ajuste de producción de maquinaria (2.4 / D55 / D59 / D60) ----------
 * Sustituye el estimado geométrico del capataz (largo, D20) por el volumen OFICIAL de la
 * chequeadora (D06) en la fila de MAQUINARIA, SOLO para los frentes de excavación/terraplén/
 * ZODME (CC 02.05/02.06/02.07/02.08). LEE DATA y MAQUINARIA; ESCRIBE SOLO MAQUINARIA.
 * NUNCA escribe en DATA ni en BANDEJA.
 * El panel muestra el panorama del día: frentes ajustables con su volumen oficial (aunque no
 * tengan máquina, para redirigir esa producción, D60), las demás máquinas productivas en lectura
 * y el indicador de máquina multi-actividad (D46). */
const MAQ_PROD_CC = {'02.05':1,'02.06':1,'02.07':1,'02.08':1};
// Buckets de frente (granularidad de actividad, no solo CC: separa aprovechable / no aprovechable
// / préstamo / terraplén / ZODME). Cada uno trae el par H/I de Captura para crear filas (D52).
const MAQ_BUCKETS = {
  EXC_APRO:    {cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION APROVECHABLE',    label:'Excavación aprovechable',    tipo:'excavacion'},
  EXC_NOAPRO:  {cc:'02.05', h:'EXCAVACION COMUN',    i:'EXCAVACION NO APROVECHABLE', label:'Excavación no aprovechable', tipo:'excavacion'},
  EXC_PRESTAMO:{cc:'02.06', h:'EXCAVACION PRESTAMO', i:'EXCAVACION APROVECHABLE',    label:'Excavación de préstamo',     tipo:'excavacion'},
  TERRAPLEN:   {cc:'02.07', h:'TERRAPLEN',           i:'NUCLEO DE TERRAPLEN',        label:'Terraplén',                  tipo:'terraplen'},
  ZODME:       {cc:'02.08', h:'CONFORMACION',        i:'ZODME',                      label:'Conformación / ZODME',       tipo:'terraplen'}
};
// Actividades complementarias SIN producción que el panel puede asignar a una máquina faltante (D62):
// cereo y apoyos. Llevan par H/I (a_captura=SI) salvo paisajeo/adecuación/derrumbe (sin par, NO a Captura).
const MAQ_COMPLEM = {
  CEREO_CORONA:      {h:'TERRAPLEN', i:'CEREO CORONA',        label:'Cereo de corona',           aCaptura:'SI'},
  CEREO_SUBBASE:     {h:'SUBBASE',   i:'CEREO SUBBASE',       label:'Cereo de subbase',          aCaptura:'SI'},
  COMPACT_TERRAPLEN: {h:'TERRAPLEN', i:'NUCLEO DE TERRAPLEN', label:'Compactación de terraplén', aCaptura:'SI'},
  COMPACT_SUBBASE:   {h:'SUBBASE',   i:'CONFORMACION SUBBASE',label:'Compactación de subbase',   aCaptura:'SI'},
  COMPACT_BTC:       {h:'BASE',      i:'BTC',                 label:'Compactación de BTC',       aCaptura:'SI'},
  PAISAJEO:          {h:'',          i:'',                    label:'Paisajeo / ornato',         aCaptura:'NO'},
  ADECUACION:        {h:'',          i:'',                    label:'Adecuación de caminos',     aCaptura:'NO'},
  DERRUMBE:          {h:'',          i:'',                    label:'Limpieza de derrumbe',      aCaptura:'NO'}
};
// Catálogo de máquinas (05_CATALOGO §4): tipo + horas programadas. Para crear filas y poblar el
// selector de "redirigir producción" (solo las que generan producción; vibros/minis fuera).
const MAQ_CATALOGO = {
  BL005:{tipo:'BULLDOZER',prog:6.4}, BL009:{tipo:'BULLDOZER',prog:6.4}, NH69:{tipo:'BULLDOZER',prog:5},
  EXC001:{tipo:'EXCAVADORA',prog:6.4}, EXC013:{tipo:'EXCAVADORA',prog:6.4}, EXC014:{tipo:'EXCAVADORA',prog:6.4}, EXC015:{tipo:'EXCAVADORA',prog:6.4},
  MO03:{tipo:'MOTONIVELADORA',prog:6.4}, MO04:{tipo:'MOTONIVELADORA',prog:6.4}, MO09:{tipo:'MOTONIVELADORA',prog:6.4},
  FNG02:{tipo:'FINISHER',prog:6.4},
  CR019:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR013:{tipo:'VIBROCOMPACTADOR',prog:6.4}, CR016:{tipo:'VIBROCOMPACTADOR',prog:6.4},
  CS78B:{tipo:'VIBROCOMPACTADOR',prog:5}, NH403:{tipo:'VIBROCOMPACTADOR',prog:5}, NH404:{tipo:'VIBROCOMPACTADOR',prog:5}, NH420:{tipo:'VIBROCOMPACTADOR',prog:5}, CAT900:{tipo:'VIBROCOMPACTADOR',prog:5},
  NH421:{tipo:'MINICARGADOR',prog:5}, CR026:{tipo:'MINIBULDOZER',prog:6.4}
};
// Flota "requerida" diaria (mismo conjunto que estado.html): máquinas productivas cuya presencia se
// espera cada día. El panel la usa para mostrar las FALTANTES (sin reporte) y permitir registrar sus
// horas manualmente (D61). CAT320 y MC705 retiradas de la obra (jun-2026).
const MAQ_FLOTA_ESPERADA = ['BL005','BL009','EXC001','EXC013','EXC014','EXC015','MO03','MO04','MO09','NH69'];
// Bucket de una fila de MAQUINARIA a partir de su par H/I derivado (CAPTURA_ACT_MAP). '' = no editable.
function bucketDeMaqRow(r){
  const h=String(r.actividad||'').toUpperCase(), i=String(r.sub_actividad||'').toUpperCase();
  if(h.indexOf('EXCAVACION COMUN')>=0)    return i.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(h.indexOf('EXCAVACION PRESTAMO')>=0) return 'EXC_PRESTAMO';
  if(h.indexOf('TERRAPLEN')>=0)           return 'TERRAPLEN';
  if(h.indexOf('CONFORMACION')>=0)        return 'ZODME';
  return '';
}
// Bucket de una fila de DATA a partir de su CC + descripción (mismo discriminante que arriba).
function bucketDeData(cc, descripcion){
  const d=String(descripcion||'').toUpperCase();
  if(cc==='02.05') return d.indexOf('NO APRO')>=0 ? 'EXC_NOAPRO' : 'EXC_APRO';
  if(cc==='02.06') return 'EXC_PRESTAMO';
  if(cc==='02.07') return 'TERRAPLEN';
  if(cc==='02.08') return 'ZODME';
  return '';
}
// CC corto (NN.NN) desde el centro de costo de DATA (formato "3701.02.05" o "02.05").
function ccCorto(centroCosto){ const m=String(centroCosto==null?'':centroCosto).match(/(\d{2}\.\d{2})\s*$/); return m?m[1]:''; }

// GET: panorama del día. Cruza el volumen oficial de DATA (por proyecto+bucket) con las filas de
// MAQUINARIA del día. Devuelve:
//  - frentes[]: buckets ajustables (02.05-08) con su oficial, los PK oficiales de DATA, sus máquinas
//    (id_registro interno, PK del capataz y horas) y el indicador multi-actividad; aparecen aunque NO
//    tengan máquina (oficial>0).
//  - otras[]: máquinas productivas en CC no ajustables (subbase/base/BTC/MSR/desmonte) en LECTURA.
//  - flota_produccion[]: máquinas que generan producción (para redirigir producción huérfana, D60).
//  - faltantes[]: flota requerida sin reporte ese día, para registrar sus horas manualmente (D61).
function maquinariaProduccion(e){
  const fecha=fdate(e.parameter.fecha);
  getSheet('MAQUINARIA', MAQ_HEADERS); // auto-sana encabezados al layout D52 (+ produccion_capataz_orig)
  function pkRange(pki,pkf){ const a=String(pki==null?'':pki).trim(), b=String(pkf==null?'':pkf).trim();
    if(a&&b&&b!==a) return a+'–'+b; return a||b||''; }
  // Volúmenes y PK oficiales de DATA por proyecto|bucket (solo LECTURA; jamás se escribe DATA aquí)
  const dataVol={}, dataPk={};
  const ss=SpreadsheetApp.openById(SHEET_ID), dsh=ss.getSheetByName('DATA');
  if(dsh && dsh.getLastRow()>1){
    const v=dsh.getDataRange().getValues();
    for(let i=1;i<v.length;i++){
      if(fdate(v[i][C.FECHA])!==fecha) continue;
      const cc=ccCorto(v[i][3]); if(!MAQ_PROD_CC[cc]) continue;
      const b=bucketDeData(cc, v[i][5]); if(!b) continue;       // col F = DESCRIPCION
      const key=String(v[i][7]||'')+'|'+b;                      // col H = PROYECTO
      dataVol[key]=(dataVol[key]||0)+(parseFloat(v[i][C.LARGO])||0);
      const pk=pkRange(v[i][25], v[i][26]);                     // cols Z/AA internas = pk_inicial/pk_final
      if(pk){ (dataPk[key]=dataPk[key]||[]); if(dataPk[key].indexOf(pk)<0) dataPk[key].push(pk); }
    }
  }
  // PK del capataz por id de cantidad (BANDEJA): la fila de MAQUINARIA enlaza con id_cantidad.
  const banPk={};
  readSheet('BANDEJA').filter(r=>r.fecha===fecha).forEach(r=>{ banPk[String(r.id_registro||'')]=pkRange(r.pk_inicial, r.pk_final); });
  // Todas las filas de MAQUINARIA del día (para presentes/faltantes) y las que generan producción.
  const todas=readSheet('MAQUINARIA').filter(r=> r.fecha===fecha);
  const presentes={}; todas.forEach(r=>{ if(r.id_maquina) presentes[r.id_maquina]=1; });
  const producen=todas.filter(r=> !esTipoSinProduccion(r.app_tipo_equipo) && String(r.cap_actividad||'')!=='APOYO');
  function rowLabel(r){ const b=bucketDeMaqRow(r); return b?MAQ_BUCKETS[b].label:(r.cap_actividad||r.actividad||'—'); }
  function rowHoras(r){ const ho=r.horas_operadas; return (ho===''||ho==null)?'':ho; }
  // multi-actividad (D46): todas las actividades del día por id_maquina
  const actsPorMaq={};
  producen.forEach(r=>{ const id=r.id_maquina||''; (actsPorMaq[id]=actsPorMaq[id]||[]).push(rowLabel(r)); });
  // Frentes ajustables: unión de buckets con oficial>0 y buckets con máquina presente
  const fMap={}, fOrder=[];
  function ensureF(proy,b){ const k=proy+'|'+b;
    if(!fMap[k]){ const m=MAQ_BUCKETS[b]; fMap[k]={proyecto:proy,bucket:b,cc:m.cc,label:m.label,tipo:m.tipo,oficial:0,_filas:[]}; fOrder.push(k); }
    return fMap[k]; }
  Object.keys(dataVol).forEach(k=>{ const p=k.slice(0,k.indexOf('|')), b=k.slice(k.indexOf('|')+1); ensureF(p,b).oficial=dataVol[k]; });
  const otras=[];
  producen.forEach(r=>{
    const b=bucketDeMaqRow(r);
    if(b){ ensureF(String(r.proyecto||''),b)._filas.push(r); }
    else { otras.push({ id_maquina:r.id_maquina||'', actividad:r.cap_actividad||r.actividad||'—',
      produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion, unidad:r.unidad_prod||'',
      reporta:r.reporta||'', pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) }); }
  });
  const frentes=fOrder.map(k=>{
    const f=fMap[k], n=f._filas.length;
    // Prellenado proporcional a lo que cada máquina reportó (D62): como multi-máquina muestra el
    // TOTAL de la actividad (D36), repartir por reportado equivale a partes iguales (oficial÷n) cuando
    // todas marcan lo mismo, y al 100% si es una sola. Respaldo a partes iguales si no hay reportado.
    const sumRep=f._filas.reduce((s,r)=> s+(parseFloat(r.produccion)||0), 0);
    const filas=f._filas.map(r=>{
      const rep=parseFloat(r.produccion)||0;
      const prefill = sumRep>0 ? Math.round(f.oficial*rep/sumRep*100)/100 : Math.round((f.oficial/(n||1))*100)/100;
      const orig=r.produccion_capataz_orig;
      const otrasAct=(actsPorMaq[r.id_maquina]||[]).filter(x=>x!==f.label);
      return { id_registro:String(r.app_id_registro||''), id_maquina:r.id_maquina||'',
        actividad:r.cap_actividad||r.actividad||f.label, tipo_equipo:r.app_tipo_equipo||'',
        produccion_actual:(r.produccion===''||r.produccion==null)?'':r.produccion,
        produccion_orig:(orig===''||orig==null)?'':orig, prefill:prefill, otras_actividades:otrasAct,
        pk:banPk[String(r.id_cantidad||'')]||'', horas:rowHoras(r) };
    });
    return { proyecto:f.proyecto, bucket:f.bucket, cc:f.cc, label:f.label, tipo:f.tipo,
      oficial:f.oficial, n_maquinas:n, pk_oficial:(dataPk[k]||[]), filas:filas };
  });
  const flota_produccion=Object.keys(MAQ_CATALOGO).filter(id=>!esTipoSinProduccion(MAQ_CATALOGO[id].tipo))
    .map(id=>({ id_maquina:id, tipo:MAQ_CATALOGO[id].tipo, prog:MAQ_CATALOGO[id].prog, reportada: !!presentes[id] }));
  const faltantes=MAQ_FLOTA_ESPERADA.filter(id=>!presentes[id])
    .map(id=>({ id_maquina:id, tipo:(MAQ_CATALOGO[id]||{}).tipo||'', prog:(MAQ_CATALOGO[id]||{}).prog||'' }));
  return json({ok:true, fecha, frentes, otras, flota_produccion, faltantes});
}

// POST: (1) parcha la col T (producción) de filas existentes (ajustes[]) guardando el estimado
// original del capataz en produccion_capataz_orig la PRIMERA vez; (2) crea filas nuevas (nuevas[])
// para redirigir producción huérfana a una máquina (D60). ESCRIBE SOLO MAQUINARIA: nunca DATA/BANDEJA.
function maquinariaProduccionGuardar(body){
  const fecha=fdate(body.fecha), ajustes=body.ajustes||[], nuevas=body.nuevas||[];
  const sh=getSheet('MAQUINARIA', MAQ_HEADERS);
  const v=sh.getDataRange().getValues(), h=v[0];
  const idCol=h.indexOf('app_id_registro'), fCol=h.indexOf('fecha');
  const prodCol=h.indexOf('produccion'), origCol=h.indexOf('produccion_capataz_orig');
  if(idCol<0 || prodCol<0 || origCol<0) return json({ok:false, error:'Columnas de MAQUINARIA no encontradas'});
  // 1) parchar producción de filas existentes
  const map={}; ajustes.forEach(a=>{ if(a && a.id_registro!=null && a.id_registro!=='') map[String(a.id_registro)]=a; });
  let upd=0;
  for(let i=1;i<v.length;i++){
    const id=String(v[i][idCol]||''); if(!id || !map[id]) continue;
    if(fecha && fCol>=0 && fdate(v[i][fCol])!==fecha) continue; // guard: solo filas del día
    const a=map[id];
    const pf=parseFloat(a.produccion);
    const prod=isNaN(pf) ? (a.produccion==null?'':a.produccion) : pf;
    const orig=v[i][origCol];
    if(orig==='' || orig==null) sh.getRange(i+1, origCol+1).setValue(v[i][prodCol]); // 1ª vez: original
    sh.getRange(i+1, prodCol+1).setValue(prod);
    upd++;
  }
  // 2) crear filas nuevas. Tres formas (layout Captura A→AA + internos, D52):
  //    - con bucket: producción redirigida a una máquina (D60), con horas/motivo opcionales.
  //    - con complem: actividad complementaria SIN producción (cereo/apoyo) para una faltante (D62).
  //    - solo horas: registro de horas de una máquina sin reporte por ningún medio (D61).
  // Si trabajó menos que lo programado, el motivo deriva las horas muertas y el ESTADO (D12/D13).
  const ts=new Date(), reporta=body.usuario||'(ajuste-prod)';
  const maqRows=[];
  nuevas.forEach(nv=>{
    const idM=String(nv.id_maquina||'').toUpperCase(); if(!idM) return;
    const cat=MAQ_CATALOGO[idM]; if(!cat) return;               // máquina fuera de catálogo: se ignora
    const b  = nv.bucket  ? MAQ_BUCKETS[nv.bucket]   : null;  if(nv.bucket  && !b)  return;
    const cx = nv.complem ? MAQ_COMPLEM[nv.complem]  : null;  if(nv.complem && !cx) return;
    // actividad de la fila
    const H = b?b.h:(cx?cx.h:''), I = b?b.i:(cx?cx.i:'');
    const aCap = b?'SI':(cx?cx.aCaptura:'NO'), capLabel = b?b.label:(cx?cx.label:'');
    // producción: solo en frente y si la máquina genera producción (vibros/minis nunca, D41/D44)
    let prod='';
    if(b && !esTipoSinProduccion(cat.tipo)){ const pf=parseFloat(nv.produccion); prod=isNaN(pf)?'':pf; }
    // horas operadas (opcional) + motivo: deriva muertas = prog − operadas y ESTADO (D13)
    const ho=parseFloat(nv.horas);
    const horasOper = isNaN(ho) ? '' : ho;
    const motivo = String(nv.motivo||'');
    const muertas = (horasOper==='') ? '' : Math.round(Math.max(0, (parseFloat(cat.prog)||0) - horasOper)*100)/100;
    const estado  = (horasOper==='') ? 'OPERANDO' : derivarEstado(motivo, muertas);
    const esMant  = motivo.trim().toLowerCase().indexOf('mantenimiento')>=0;
    const hMant   = (esMant && horasOper!=='') ? muertas : '';   // O horas_mantenimiento (D52)
    if(!b && !cx && horasOper==='') return;                      // nada que registrar
    const obs = b ? 'Producción redirigida (panel)' : cx ? ('Complementaria: '+capLabel+' (panel)') : 'Horas registradas (panel)';
    maqRows.push([
      // A vacío · B fecha · C vacío · D proyecto · E id_maquina · F vacío · G operador
      '', fecha, '', String(nv.proyecto||''), idM, '', (nv.operador||''),
      // H actividad · I sub · J-K vacío · L horas_operadas · M vacío
      H, I, '', '', horasOper, '',
      // N vacío · O h_mantenimiento · P-Q vacío · R estado · S vacío
      '', hMant, '', '', estado, '',
      // T produccion · U-Z vacío · AA observacion
      prod, '', '', '', '', '', '', obs,
      // internos: app_id · id_cantidad · ts · reporta · app_tipo · app_hprog · app_hmuertas
      Utilities.getUuid(), '', ts, reporta, cat.tipo, cat.prog, muertas,
      // motivo · unidad_prod · cap_actividad · a_captura · produccion_capataz_orig
      motivo, (prod===''?'':'m3'), capLabel, aCap, '']);
  });
  if(maqRows.length) sh.getRange(sh.getLastRow()+1,1,maqRows.length,MAQ_HEADERS.length).setValues(maqRows);
  return json({ok:true, actualizadas:upd, creadas:maqRows.length});
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
  return json({version:'v9', sheetTZ:shTZ(), queryFecha:fechaQ, bandejaFilas:ban.length,
    muestra: ban.slice(0,5).map(r=>({reporta:r.reporta, rol:r.rol, actividad:r.actividad, pk:r.pk_inicial, largo:r.largo, estado:r.estado})) });
}

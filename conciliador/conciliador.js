'use strict';
/* =============================================================================
   Conciliador de Cortes de Transporte — TM2 Sur · V1
   -----------------------------------------------------------------------------
   Herramienta 100% navegador (file:// o GitHub Pages). Sin backend.
   Filosofía: NUNCA asumir ante la incertidumbre. El sistema propone, César decide.

   Secciones:
     0. Utilidades puras (normalización, fechas, celdas)
     1. Configuración (seed + localStorage + export/import)
     2. Estado global
     3. Lectura de bases (GRANULARES / TERRAPLÉN) + índices
     4. Lectura de proformas (auto-detección de encabezado, explosión de celdas)
     5. Motor de conciliación (llave cerrada, clasificador, duplicadas, re-conciliación)
     6. Máquina de estados + transiciones auditadas
     7. UI: sidebar + pasos 1-4 + modal de detalle
     8. Paso 5: investigación PDF (pdf.js + tesseract.js, lazy)
     9. Paso 6: resolución manual · Paso 7: exportes (acta TSV/xlsx, digitadora, PDF pendientes, resumen)
    10. Sesión (autosave localStorage + export/import JSON) e init
   ============================================================================= */

/* ============================ 0. UTILIDADES ============================ */

function quitarTildes(s){ return String(s).normalize('NFD').replace(/[̀-ͯ]/g,''); }

// Remisión = SIEMPRE texto. Trim, mayúsculas, colapsar espacios. NO quitar ceros a la izquierda.
function normRem(v){ if(v==null) return ''; return String(v).trim().toUpperCase().replace(/\s+/g,' '); }

// Variante sin ceros a la izquierda (solo para sugerencias marcadas, jamás match automático).
function sinCeros(s){ return String(s).replace(/^0+(?=.)/,''); }

// Empresa / valores de base: sin tildes, sin puntos, mayúsculas, espacios colapsados.
function normTexto(s){ if(s==null) return ''; return quitarTildes(String(s)).toUpperCase().replace(/\./g,'').replace(/\s+/g,' ').trim(); }

// Nombres de columna de proforma: minúsculas, sin tildes, sin puntos/№/#/º, sin saltos de línea.
function normCol(s){
  if(s==null) return '';
  return quitarTildes(String(s)).toLowerCase()
    .replace(/[\r\n]+/g,' ')
    .replace(/[.#º°№]/g,'')
    .replace(/\s+/g,' ').trim();
}

function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// Distancia de edición ≤ 1 (para candidatos naranja del OCR). Devuelve 0, 1 o 2 (2 = "más de 1").
function dist1(a,b){
  if(a===b) return 0;
  const la=a.length, lb=b.length;
  if(Math.abs(la-lb)>1) return 2;
  if(la===lb){ let d=0; for(let i=0;i<la;i++){ if(a[i]!==b[i] && ++d>1) return 2; } return d; }
  const s=la<lb?a:b, l=la<lb?b:a;
  let i=0,j=0,d=0;
  while(i<s.length && j<l.length){ if(s[i]===l[j]){i++;j++;} else { j++; if(++d>1) return 2; } }
  return d + (l.length-j);
}

// ---- Fechas: todo se guarda como ISO 'YYYY-MM-DD' (o null). Comparables como texto. ----
function serialToISO(n){
  if(!isFinite(n) || n<20000 || n>80000) return null; // fuera de rango plausible de serial Excel
  const d=new Date(Math.round((n-25569)*86400000));
  return isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function parseFechaTexto(s){
  if(!s) return null;
  const t=String(s).trim();
  let m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return m[1]+'-'+String(+m[2]).padStart(2,'0')+'-'+String(+m[3]).padStart(2,'0');
  m=t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){
    let y=+m[3]; if(y<100) y+=2000;
    const mo=+m[2], d=+m[1];
    if(mo<1||mo>12||d<1||d>31) return null;
    return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }
  return null;
}
function parseFechaCell(c){
  if(!c || c.v==null) return null;
  if(c.v instanceof Date) return isNaN(c.v.getTime())?null:c.v.toISOString().slice(0,10);
  if(c.t==='n') return serialToISO(c.v);
  return parseFechaTexto(c.w!==undefined?c.w:c.v);
}
function fmtFecha(iso){ if(!iso) return ''; const p=String(iso).split('-'); return p.length===3?(p[2]+'/'+p[1]+'/'+p[0]):String(iso); }
const MESES_ABR=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function fmtRezago(iso){ const p=String(iso).split('-'); return p[2]+'-'+(MESES_ABR[+p[1]-1]||p[1]); }

// ---- Celdas SheetJS sin depender de XLSX.utils (testeable en Node) ----
function colLetter(n){ let s=''; n=n+1; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); } return s; }
function letterToNum(s){ let n=0; for(const ch of s) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
function refRange(ws){
  const ref=ws && ws['!ref']; if(!ref) return {rows:0,cols:0};
  let m=ref.match(/:([A-Z]+)(\d+)$/);
  if(m) return {rows:+m[2], cols:letterToNum(m[1])+1};
  m=ref.match(/^([A-Z]+)(\d+)$/);
  return m?{rows:+m[2],cols:letterToNum(m[1])+1}:{rows:0,cols:0};
}
// Texto formateado de la celda (cell.w) o String(v). JAMÁS parsear remisión a número.
function cellText(ws,addr){
  const c=ws[addr]; if(!c || c.v==null) return '';
  if(c.w!==undefined) return String(c.w).trim();
  return String(c.v).trim();
}
function parseNum(v){
  if(v==null||v==='') return null;
  if(typeof v==='number') return isFinite(v)?v:null;
  const t=String(v).replace(/\./g,'').replace(',','.'); // formato es-CO "1.234,5"
  const n=parseFloat(t); return isFinite(n)?n:null;
  // Nota: si la base trae número real, llega como number y no pasa por aquí.
}
function fmtNumTSV(v,dec){
  if(v==null||v==='') return '';
  if(typeof v==='number'){ let s=String(v); if(dec===',') s=s.replace('.',','); return s; }
  return String(v);
}
function uid(){ return 'r'+(++S.corte.secuencia); }
function nowISO(){ return new Date().toISOString(); }

/* ============================ 1. CONFIGURACIÓN ============================ */

const LS_CONFIG='conciliador_config_v1';
const LS_SESION='conciliador_sesion_auto_v1';

// Reglas de hojas comunes (seed): cubren las 4 proformas reales verificadas.
// Orden importa: primero la mixta (AMBAS), luego granulares/terraplén/internos,
// hojas con nombre de mes → AMBAS (busca en las dos bases, nunca asume mal),
// HojaN = método manual del usuario → IGNORAR.
function seedHojas(){ return [
  { patron:"TERRAPLEN.*GRANULAR|GRANULAR.*TERRAPLEN", ambito:"AMBAS" },
  { patron:"PUTANA|AVENSA|GRANULAR", ambito:"GRANULARES" },
  { patron:"TERRAPLEN|CORTE", ambito:"TERRAPLEN" },
  { patron:"INTERNO", ambito:"TERRAPLEN", modo:"interno" },
  { patron:"^(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)", ambito:"AMBAS" },
  { patron:"^HOJA\\d+$", ambito:"IGNORAR" }
];}

function configSeed(){
  const sab=(id,nombre,alias)=>({id,nombre,ciudad:'Sabana',alias,ambitos:['GRANULARES','TERRAPLEN'],hojas:seedHojas()});
  const bet=(id,nombre,alias)=>({id,nombre,ciudad:'Betulia',alias,ambitos:['GRANULARES'],hojas:seedHojas()});
  return {
    version:1,
    fechaMinimaBusqueda:'2026-05-01',
    quincenaActual:{inicio:'2026-06-16',fin:'2026-06-30'},
    decimalTSV:',',   // separador decimal al copiar el bloque TSV (Excel es-CO usa coma)
    aliasColumnaRemision:['no recibo','# recibo','recibo','no remision','remision','n recibo','no de recibo'],
    aliasColumnasSecundarias:{
      fecha:['fecha','fecha del servicio'],
      placa:['placa','placa vehiculo'],
      cantidad:['mts','m3','cantidad material (m3)','cubicacion','m3 vehiculo','total m3','cantidad transportada'],
      viajes:['no viajes','node viajes','no de viajes','viaje'],
      origen:['origen','sitio de procedencia','cargue','pk origen uf1','pk inicial'],
      destino:['obra','destino','sitio de descargue','descargue','pk final uf1','pk final']
    },
    areasExcluyentes:['PLANTA','PUENTE','TM1','AMP','RCD','ZODME - RCD','DIVISO - PUENTE'],
    areasNeutras:['DIVISO'],
    empresasVetadas:['ORTIZ','VOLKETSA','BETULIA'],
    // Mapeo del bloque del acta (§3.4): campo null = columna derivada, se exporta VACÍA.
    actaLayout:[
      {col:'A',titulo:'X',campo:null},
      {col:'B',titulo:'Acta No.',campo:null},
      {col:'C',titulo:'Fecha',campo:'fecha'},
      {col:'D',titulo:'Día sem',campo:null},
      {col:'E',titulo:'Dia hábil',campo:null},
      {col:'F',titulo:'Frente de Obra o UF',campo:'uf'},
      {col:'G',titulo:'Actividad',campo:'actividad'},
      {col:'H',titulo:'Centro de costo',campo:'cc'},
      {col:'I',titulo:'Remisión',campo:'remision'},
      {col:'J',titulo:'Código equipo o Placa',campo:'placa'},
      {col:'K',titulo:'Kilometraje Inicial',campo:'kmIni'},
      {col:'L',titulo:'Kilometraje Final',campo:'kmFin'},
      {col:'M',titulo:'Kilómetros Totales',campo:'kmTot'},
      {col:'N',titulo:'Kilómetros Stand by',campo:null},
      {col:'O',titulo:'Total Km a pagar',campo:null},
      {col:'P',titulo:'Cantidad transportada',campo:'cantidad'},
      {col:'Q',titulo:'Transporte m3*Km',campo:'m3km'},
      {col:'R',titulo:'Unidad',campo:'unidad'},
      {col:'S',titulo:'Observaciones',campo:'obs'}
    ],
    contratistas:[
      sab('ASOTRANSPA','Asotranspa',['ASOTRANSPA']),
      sab('ASOTRASAAT','Asotrasaat',['ASOTRASAT','ASOTRASAAT','ASOTROSOT']),
      sab('ASOVOLSAT','Asovolsat',['ASOVOLSAT']),
      sab('COTRASABANA','Cotrasabana',['COTRASABANA','COOTRASABANA']),
      sab('SUMINISTROS','Soluciones y Suministros',['SUMINISTROS','SOLUCIONES Y SUMINISTROS']),
      sab('TRANSAGREGADOS','Transagregados',['AGREGADOS','TRANSAGREGADOS']),
      sab('VELEROS','Veleros',['VELEROS']),
      bet('CARTRAGUA','Cartragua',['CARTRAGUA']),
      bet('D&S','D&S Transportes',['D&S TRANSPORTES','D&S','DYS']),
      bet('TRANSDELTA','Grupo Transdelta',['GRUPO TRANSDELTA','TRANSDELTA'])
    ]
  };
}

function cargarConfig(){
  try{
    const raw=(typeof localStorage!=='undefined')?localStorage.getItem(LS_CONFIG):null;
    if(raw){ const c=JSON.parse(raw); if(c && c.contratistas && c.actaLayout) return c; }
  }catch(e){ console.warn('config localStorage ilegible',e); }
  return configSeed();
}
function guardarConfig(){
  try{ if(typeof localStorage!=='undefined') localStorage.setItem(LS_CONFIG,JSON.stringify(S.config)); }
  catch(e){ toast('⚠️ No se pudo guardar la configuración en localStorage: '+e.message); }
}
function getContratista(id){ return (S.config.contratistas||[]).find(c=>c.id===id)||null; }

/* ============================ 2. ESTADO GLOBAL ============================ */

const S={
  config:null,
  bases:{GRANULARES:null,TERRAPLEN:null},
  // workbooks a la espera de que el usuario señale la hoja (caso borde: sin 'BASE 2026')
  basePendiente:{},           // tipo -> {wb, archivo, hojas:[]}
  corte:null,                 // ver abrirCorte()
  pdfs:[],                    // {name, kind:'pdf'|'img', bytes:Uint8Array, numPages, doc?, url?, error?}
  ocr:{running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{}},
  ui:{paso:1,filtroEstado:null,faltanteSel:null,detalle:null,soloRevision:false,tsvHeader:false,avisoLS:false}
};

const ESTADOS=['PENDIENTE','ENCONTRADA','NO_ENCONTRADA','MULTIPLE_EN_BASE','DUPLICADA_EN_PROFORMA',
  'REVISION_MANUAL','EXCLUIDA_UF3','EXCLUIDA_OTRA_AREA','EXCLUIDA_ASFALTO','PENDIENTE_DIGITACION',
  'RECHAZADA','ACEPTADA_MANUAL'];
const ESTADOS_ACTA=['ENCONTRADA','ACEPTADA_MANUAL'];
const ETIQUETA={PENDIENTE:'Pendiente',ENCONTRADA:'Encontrada',NO_ENCONTRADA:'No encontrada',
  MULTIPLE_EN_BASE:'Múltiple en base',DUPLICADA_EN_PROFORMA:'Duplicada en proforma',
  REVISION_MANUAL:'Revisión manual',EXCLUIDA_UF3:'Excluida UF3',EXCLUIDA_OTRA_AREA:'Excluida otra área',
  EXCLUIDA_ASFALTO:'Excluida asfalto',PENDIENTE_DIGITACION:'Pendiente digitación',
  RECHAZADA:'Rechazada',ACEPTADA_MANUAL:'Aceptada manual'};

/* ============================ 3. LECTURA DE BASES ============================ */

// Contratos §3.1 / §3.2 (estructuras REALES verificadas). Los campos se normalizan
// a un set común para que el actaLayout de la config los mapee sin importar la base.
const BASES_DEF={
  GRANULARES:{hojaDefecto:'BASE 2026',filaEnc:2,
    cols:{fecha:'A',rem:'B',placa:'C',cantidad:'G',actividad:'I',cc:'J',kmIni:'L',kmFin:'M',kmTot:'N',m3km:'O',unidad:'P',uf:'R',area:'X',empresa:'Z'}},
  TERRAPLEN:{hojaDefecto:'BASE 2026',filaEnc:4,
    cols:{fecha:'A',rem:'B',placa:'C',empresa:'D',cantidad:'H',actividadDesc:'I',actividad:'J',uf:'K',cc:'L',kmIni:'P',kmFin:'S',kmTot:'V',m3km:'W',unidad:'X',area:'AB'}}
};

function leerBase(ws,tipo,archivo,hojaNombre){
  const def=BASES_DEF[tipo], cols=def.cols;
  const maxR=refRange(ws).rows;               // !ref puede declarar filas de más (fórmulas arrastradas)
  const rows=[]; const index=new Map(); const indexSC=new Map();
  let vacias=0, fechaMin=null, fechaMax=null;
  for(let r=def.filaEnc+1; r<=maxR; r++){
    const remRaw=cellText(ws,cols.rem+r);
    if(!remRaw){ if(++vacias>1000) break; continue; }  // cortar en la última fila con remisión
    vacias=0;
    const row={tipo,fila:r,rem:normRem(remRaw)};
    row.remSC=sinCeros(row.rem);
    row.fecha=parseFechaCell(ws[cols.fecha+r]);
    for(const k of Object.keys(cols)){
      if(k==='rem'||k==='fecha') continue;
      const c=ws[cols[k]+r];
      row[k]=(c&&c.v!=null)?((c.t==='n')?c.v:String(c.w!==undefined?c.w:c.v).trim()):'';
    }
    row.empresaNorm=normTexto(row.empresa);
    row.ufNorm=normTexto(row.uf);
    row.areaNorm=normTexto(row.area);
    rows.push(row);
    if(!index.has(row.rem)) index.set(row.rem,[]);
    index.get(row.rem).push(row);
    if(row.remSC!==row.rem){ if(!indexSC.has(row.remSC)) indexSC.set(row.remSC,[]); indexSC.get(row.remSC).push(row); }
    if(row.fecha){ if(!fechaMin||row.fecha<fechaMin) fechaMin=row.fecha; if(!fechaMax||row.fecha>fechaMax) fechaMax=row.fecha; }
  }
  return {archivo,hoja:hojaNombre,tipo,rows,index,indexSC,utiles:rows.length,fechaMin,fechaMax,cargadoEn:nowISO()};
}

/* ============================ 4. LECTURA DE PROFORMAS ============================ */

function resolverAmbitoHoja(nombreHoja,contratista){
  const n=normTexto(nombreHoja);
  for(const h of (contratista&&contratista.hojas)||[]){
    let re; try{ re=new RegExp(h.patron,'i'); }catch(e){ continue; }
    if(re.test(n)) return {ambito:h.ambito,modo:h.modo||null,patron:h.patron};
  }
  return null;
}

// Auto-detección del encabezado: primeras 12 filas, celda que normalizada
// coincida con un alias de columna-remisión.
function detectarEncabezado(ws,cfg){
  const rng=refRange(ws); const maxC=Math.min(rng.cols,60);
  const aliasRem=(cfg.aliasColumnaRemision||[]).map(normCol);
  for(let r=1;r<=Math.min(12,rng.rows);r++){
    for(let c=0;c<maxC;c++){
      const t=normCol(cellText(ws,colLetter(c)+r));
      if(t && aliasRem.indexOf(t)>=0) return {fila:r,col:c};
    }
  }
  return null;
}

function detectarSecundarias(ws,fila,colRem,cfg){
  const rng=refRange(ws); const maxC=Math.min(rng.cols,60);
  const map={};
  for(const campo of Object.keys(cfg.aliasColumnasSecundarias||{})){
    const al=cfg.aliasColumnasSecundarias[campo].map(normCol);
    for(let c=0;c<maxC;c++){
      if(c===colRem) continue;
      const t=normCol(cellText(ws,colLetter(c)+fila));
      if(t && al.indexOf(t)>=0){ map[campo]=c; break; }
    }
  }
  return map;
}

// Tokens de una celda de remisión: separadores -, /, ",", ";", espacios.
// Un token vale si es alfanumérico y contiene al menos un dígito (CH6199 sí, "NA" no).
function extraerTokens(raw){
  const parts=String(raw).toUpperCase().split(/[\s\-\/,;]+/).filter(Boolean);
  return parts.filter(p=>/^[A-Z0-9]+$/.test(p)&&/\d/.test(p));
}
// NUNCA interpretar como rango: 2 tokens numéricos con diferencia >1 y <200 → revisión manual.
function esParSospechoso(tokens){
  if(tokens.length!==2) return false;
  if(!tokens.every(t=>/^\d+$/.test(t))) return false;
  const d=Math.abs(parseInt(tokens[0],10)-parseInt(tokens[1],10));
  return d>1 && d<200;
}

function mkReclamo(o){
  const rc={
    id:uid(), remision:o.remision||null, remSC:o.remision?sinCeros(o.remision):null,
    raw:o.raw!==undefined?o.raw:'', archivo:o.archivo, hoja:o.hoja, fila:o.fila,
    ambito:o.ambito, modo:o.modo||null,
    secundarios:o.secundarios||{}, obs:o.obs||'',
    marcas:[], estado:'PENDIENTE', subtipo:null,
    candidato:null, candidatos:[], sugerencias:[],
    tokensPendientes:o.tokensPendientes||null,
    evidencia:null, historial:[], decisionManual:false, notaReconciliacion:false, dupDe:null
  };
  if(o.multi) rc.marcas.push('CELDA_MULTIPLE');
  if(!rc.remision){
    rc.estado='REVISION_MANUAL';
    rc.historial.push({ts:nowISO(),de:'PENDIENTE',a:'REVISION_MANUAL',nota:o.motivo||'remisión no legible',auto:true});
  }
  return rc;
}

// Extrae reclamaciones de una hoja ya resuelta a un ámbito.
function extraerReclamosHoja(ws,archivo,hoja,ambito,modo,cfg){
  const enc=detectarEncabezado(ws,cfg);
  if(!enc) return {error:'sin_columna',reclamos:[],notas:[]};
  const sec=detectarSecundarias(ws,enc.fila,enc.col,cfg);
  const colRem=colLetter(enc.col);
  const maxR=refRange(ws).rows;   // hojas con rango inflado (1.048.559 filas): cortar por vacías
  const reclamos=[],notas=[];
  let vacias=0;
  for(let r=enc.fila+1;r<=maxR;r++){
    const raw=cellText(ws,colRem+r);
    const s={};
    for(const campo of Object.keys(sec)){
      const addr=colLetter(sec[campo])+r;
      if(campo==='fecha'){ const f=parseFechaCell(ws[addr]); if(f) s.fecha=f; }
      else { const t=cellText(ws,addr); if(t) s[campo]=t; }
    }
    const hayDatos=Object.keys(s).length>0;
    const base={archivo,hoja,fila:r,ambito,modo,secundarios:s};
    if(!raw){
      if(hayDatos){ reclamos.push(mkReclamo(Object.assign({raw:'',motivo:'remisión vacía en fila con datos'},base))); vacias=0; }
      else if(++vacias>1000) break;
      continue;
    }
    vacias=0;
    const tokens=extraerTokens(raw);
    if(tokens.length===0){
      // Nota de texto libre incrustada ("PUEDE QUE LO RE…"): no genera reclamo, se conserva.
      if(/\d/.test(raw)) reclamos.push(mkReclamo(Object.assign({raw,obs:raw,motivo:'sin remisión extraíble'},base)));
      else notas.push({fila:r,texto:raw});
      continue;
    }
    if(esParSospechoso(tokens)){
      reclamos.push(mkReclamo(Object.assign({raw,obs:raw,tokensPendientes:tokens,motivo:'¿lista o rango? confirmar'},base)));
      continue;
    }
    const multi=tokens.length>1;
    for(const t of tokens){
      reclamos.push(mkReclamo(Object.assign({remision:normRem(t),raw,multi,obs:(normRem(raw)!==normRem(t))?raw:''},base)));
    }
  }
  return {enc,sec,reclamos,notas};
}

/* ============================ 5. MOTOR DE CONCILIACIÓN ============================ */

function snap(row){
  return {ambito:row.tipo,fila:row.fila,rem:row.rem,fecha:row.fecha,placa:row.placa||'',
    uf:row.uf||'',ufNorm:row.ufNorm||'',area:row.area||'',areaNorm:row.areaNorm||'',
    actividad:row.actividad||'',cc:row.cc||'',kmIni:row.kmIni||'',kmFin:row.kmFin||'',
    kmTot:row.kmTot!==''?row.kmTot:'',cantidad:row.cantidad!==''?row.cantidad:'',
    m3km:row.m3km!==''?row.m3km:'',unidad:row.unidad||'',empresa:row.empresa||''};
}

function areaExcluyente(areaNorm,cfg){
  if(!areaNorm) return false;                                   // vacío = neutro
  const neutras=(cfg.areasNeutras||[]).map(normTexto);
  if(neutras.indexOf(areaNorm)>=0) return false;                // DIVISO = neutro, NO excluye
  if(areaNorm.indexOf('ODT')===0) return true;                  // ODT… siempre excluye
  const exc=(cfg.areasExcluyentes||[]).map(normTexto);
  return exc.indexOf(areaNorm)>=0;
}

function aliasNormActivo(){
  const c=getContratista(S.corte.contratistaId);
  return (c?c.alias:[]).map(normTexto);
}

// Llave de búsqueda cerrada (§6.2): remisión exacta + empresa ∈ alias + fecha ≥ mínima.
// En GRANULARES fila sin empresa NO matchea (pre-llegada; cae igual por fecha).
function buscarCandidatos(rem,ambitos,aliasNorm,cfg,conEmpresa){
  const out=[]; const fmin=cfg.fechaMinimaBusqueda||'';
  for(const amb of ambitos){
    const base=S.bases[amb]; if(!base) continue;
    for(const row of (base.index.get(rem)||[])){
      if(conEmpresa && aliasNorm.indexOf(row.empresaNorm)<0) continue;
      if(!row.fecha || row.fecha<fmin) continue;
      out.push(row);
    }
  }
  return out;
}

// Variante sin ceros a la izquierda, en ambas direcciones. Jamás match automático.
function buscarSinCeros(rem,remSC,ambitos,aliasNorm,cfg){
  const vistos=new Set(); const out=[]; const fmin=cfg.fechaMinimaBusqueda||'';
  for(const amb of ambitos){
    const base=S.bases[amb]; if(!base) continue;
    const cands=[];
    if(remSC!==rem) cands.push.apply(cands,(base.index.get(remSC)||[]));
    cands.push.apply(cands,(base.indexSC.get(rem)||[]));
    if(remSC!==rem) cands.push.apply(cands,(base.indexSC.get(remSC)||[]));
    for(const row of cands){
      if(vistos.has(row)) continue; vistos.add(row);
      if(row.rem===rem) continue;                       // ese ya lo cubre la búsqueda exacta
      if(aliasNorm.indexOf(row.empresaNorm)<0) continue;
      if(!row.fecha || row.fecha<fmin) continue;
      out.push(row);
    }
  }
  return out;
}

function ambitosDe(rc){
  if(rc.ambito==='AMBAS') return ['GRANULARES','TERRAPLEN'];
  return [rc.ambito];
}

function conciliarReclamo(rc,cfg){
  if(!rc.remision) return; // ya está en REVISION_MANUAL
  const aliasNorm=aliasNormActivo();
  const ambitos=ambitosDe(rc);
  const cand=buscarCandidatos(rc.remision,ambitos,aliasNorm,cfg,true);
  if(cand.length===1){ clasificar(rc,cand[0],cfg,true,null); return; }
  if(cand.length>1){
    rc.candidatos=cand.map(snap);
    setEstado(rc,'MULTIPLE_EN_BASE',cand.length+' candidatos en base',true);
    return;
  }
  const sc=buscarSinCeros(rc.remision,rc.remSC,ambitos,aliasNorm,cfg);
  if(sc.length){
    rc.candidatos=sc.map(snap);
    addMarca(rc,'MATCH_SIN_CEROS');
    setEstado(rc,'REVISION_MANUAL','match solo sin ceros a la izquierda — confirmar',true);
    return;
  }
  // Sugerencia gris: existe con otra empresa (informativo, jamás auto-match).
  const otras=buscarCandidatos(rc.remision,ambitos,aliasNorm,cfg,false);
  rc.sugerencias=otras.slice(0,6).map(snap);
  setEstado(rc,'NO_ENCONTRADA',null,true);
}

// Clasificador del candidato único (§6.3), también usado al elegir manualmente.
function clasificar(rc,row,cfg,auto,notaExtra){
  rc.candidato=snap(row);
  rc.marcas=rc.marcas.filter(m=>m!=='REZAGO'&&m!=='INTERNO_MAYOR_3KM');
  if(rc.candidato.fecha && S.corte && S.corte.quincena.inicio && rc.candidato.fecha<S.corte.quincena.inicio)
    addMarca(rc,'REZAGO');   // marca informativa: NUNCA excluye
  if(rc.candidato.ufNorm==='UF3'){ rc.subtipo='UF3'; setEstado(rc,'EXCLUIDA_UF3',notaExtra,auto); return; }
  if(areaExcluyente(rc.candidato.areaNorm,cfg)){
    rc.subtipo=rc.candidato.area||rc.candidato.areaNorm;
    setEstado(rc,'EXCLUIDA_OTRA_AREA','área '+rc.subtipo+(notaExtra?' · '+notaExtra:''),auto); return;
  }
  if(rc.modo==='interno'){
    const d=parseNum(rc.candidato.kmTot);
    if(d!=null && d>3) addMarca(rc,'INTERNO_MAYOR_3KM'); // alerta naranja, no bloquea
  }
  setEstado(rc,'ENCONTRADA',notaExtra,auto);
}

function addMarca(rc,m){ if(rc.marcas.indexOf(m)<0) rc.marcas.push(m); }

// DUPLICADA_EN_PROFORMA: mismo número 2+ veces (entre hojas y archivos también).
// La primera aparición se procesa; las demás quedan en este estado.
function marcarDuplicadas(){
  const seen=new Map();
  for(const rc of S.corte.reclamos){
    if(!rc.remision) continue;
    if(rc.estado==='DUPLICADA_EN_PROFORMA') continue;
    if(seen.has(rc.remision)){
      if(rc.estado==='PENDIENTE'){
        rc.dupDe=seen.get(rc.remision).id;
        setEstado(rc,'DUPLICADA_EN_PROFORMA','duplicada de '+seen.get(rc.remision).archivo+' / '+seen.get(rc.remision).hoja+' fila '+seen.get(rc.remision).fila,true);
      }
    } else seen.set(rc.remision,rc);
  }
}

function conciliarPendientes(){
  if(!S.corte) return 0;
  marcarDuplicadas();
  let n=0;
  for(const rc of S.corte.reclamos){
    if(rc.estado!=='PENDIENTE') continue;
    conciliarReclamo(rc,S.config); n++;
  }
  return n;
}

// Re-conciliación (ciclo digitadora): SOLO NO_ENCONTRADA y PENDIENTE_DIGITACION.
// Las decisiones manuales y encontradas NO se tocan.
function reconciliar(){
  if(!S.corte) return {revisadas:0,resueltas:0};
  const cfg=S.config; const aliasNorm=aliasNormActivo();
  let revisadas=0,resueltas=0;
  for(const rc of S.corte.reclamos){
    if(rc.estado!=='NO_ENCONTRADA'&&rc.estado!=='PENDIENTE_DIGITACION') continue;
    if(!rc.remision) continue;
    revisadas++;
    const ambitos=ambitosDe(rc);
    const cand=buscarCandidatos(rc.remision,ambitos,aliasNorm,cfg,true);
    if(cand.length===1){
      clasificar(rc,cand[0],cfg,true,'resuelta en re-conciliación');
      rc.notaReconciliacion=true;
      if(ESTADOS_ACTA.indexOf(rc.estado)>=0||rc.estado.indexOf('EXCLUIDA')===0) resueltas++;
    } else if(cand.length>1){
      rc.candidatos=cand.map(snap);
      setEstado(rc,'MULTIPLE_EN_BASE',cand.length+' candidatos (re-conciliación)',true);
      resueltas++;
    } else {
      // sigue sin aparecer: refrescar sugerencias, conservar estado
      rc.sugerencias=buscarCandidatos(rc.remision,ambitos,aliasNorm,cfg,false).slice(0,6).map(snap);
    }
  }
  return {revisadas,resueltas};
}

/* ============================ 6. MÁQUINA DE ESTADOS ============================ */

// Toda transición guarda: estado anterior, nuevo, fecha-hora, nota, auto/manual.
// Todo estado automático es reversible manualmente.
function setEstado(rc,nuevo,nota,auto){
  rc.historial.push({ts:nowISO(),de:rc.estado,a:nuevo,nota:nota||null,auto:!!auto});
  rc.estado=nuevo;
  if(!auto) rc.decisionManual=true;
}

function conteoEstados(){
  const c={}; for(const e of ESTADOS) c[e]=0;
  if(S.corte) for(const rc of S.corte.reclamos) c[rc.estado]=(c[rc.estado]||0)+1;
  return c;
}

/* ============================ 7. UI GENERAL + PASOS 1-4 ============================ */

function $(id){ return document.getElementById(id); }
function toast(msg,ms){
  const t=$('toast'); if(!t) return console.log('[toast]',msg);
  t.innerHTML=msg; t.style.display='block';
  clearTimeout(toast._t); toast._t=setTimeout(()=>{t.style.display='none';},ms||3500);
}
function descargar(nombre,contenido,mime){
  const blob=(contenido instanceof Blob)?contenido:new Blob([contenido],{type:mime||'application/octet-stream'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nombre;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},2000);
}
async function copiarTexto(txt){
  try{ await navigator.clipboard.writeText(txt); return true; }
  catch(e){
    // fallback para file:// sin permiso de clipboard
    const ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    let ok=false; try{ ok=document.execCommand('copy'); }catch(_){}
    ta.remove(); return ok;
  }
}

const PASOS=[
  {n:1,label:'Cargar bases',sub:'GRANULARES + TERRAPLÉN'},
  {n:2,label:'Abrir corte',sub:'contratista + quincena'},
  {n:3,label:'Cargar proforma',sub:'1..N .xlsx del contratista'},
  {n:4,label:'Conciliación',sub:'tablero por estados'},
  {n:5,label:'Investigación PDF',sub:'OCR dirigido a faltantes'},
  {n:6,label:'Resolución manual',sub:'decisiones auditadas'},
  {n:7,label:'Exportes',sub:'acta · digitadora · PDF'}
];

const UI={
  go(paso){ S.ui.paso=paso; S.ui.filtroEstado=null; render(); },
  render(){ render(); }
};

function pasoHecho(n){
  switch(n){
    case 1: return !!(S.bases.GRANULARES&&S.bases.TERRAPLEN);
    case 2: return !!S.corte;
    case 3: return !!(S.corte&&S.corte.reclamos.length);
    case 4: { if(!S.corte||!S.corte.reclamos.length) return false; const c=conteoEstados(); return c.PENDIENTE===0; }
    case 5: { const c=conteoEstados(); return pasoHecho(3)&&c.NO_ENCONTRADA===0; }
    case 6: { const c=conteoEstados(); return pasoHecho(3)&&c.REVISION_MANUAL===0&&c.MULTIPLE_EN_BASE===0; }
    default: return false;
  }
}

function renderSidebar(){
  const cont=$('steps'); if(!cont) return;
  cont.innerHTML=PASOS.map(p=>{
    const cls=['step-item']; if(S.ui.paso===p.n) cls.push('active'); if(pasoHecho(p.n)) cls.push('done');
    return `<div class="${cls.join(' ')}" onclick="UI.go(${p.n})">
      <div class="step-num">${pasoHecho(p.n)?'✓':p.n}</div>
      <div><div class="step-label">${p.label}</div><div class="step-sub">${p.sub}</div></div></div>`;
  }).join('');
  const b=$('corteBadge');
  if(S.corte){
    const c=getContratista(S.corte.contratistaId);
    b.innerHTML=`<div class="nom">${escapeHtml(c?c.nombre:S.corte.contratistaId)}</div>
      <div class="qn">${fmtFecha(S.corte.quincena.inicio)} → ${fmtFecha(S.corte.quincena.fin)} · ${S.corte.reclamos.length} reclamadas</div>`;
  } else {
    b.innerHTML=`<div class="nom">Sin corte abierto</div><div class="qn">Abre un corte en el Paso 2</div>`;
  }
}

function render(){
  renderSidebar();
  const m=$('main'); if(!m) return;
  switch(S.ui.paso){
    case 1: m.innerHTML=vistaPaso1(); break;
    case 2: m.innerHTML=vistaPaso2(); break;
    case 3: m.innerHTML=vistaPaso3(); break;
    case 4: m.innerHTML=vistaPaso4(); break;
    case 5: m.innerHTML=vistaPaso5(); Paso5.postRender(); break;
    case 6: m.innerHTML=vistaPaso6(); break;
    case 7: m.innerHTML=vistaPaso7(); break;
    case 'config': m.innerHTML=vistaConfig(); break;
    default: m.innerHTML='';
  }
}

/* ---------- PASO 1: bases ---------- */

function vistaPaso1(){
  const box=(tipo)=>{
    const b=S.bases[tipo]; const pend=S.basePendiente[tipo];
    let inner;
    if(pend){
      inner=`<div class="alert warn">El archivo <b>${escapeHtml(pend.archivo)}</b> no tiene hoja <b>BASE 2026</b>. Señala la hoja de datos:</div>
        <select id="selHoja_${tipo}">${pend.hojas.map(h=>`<option>${escapeHtml(h)}</option>`).join('')}</select>
        <div style="margin-top:8px"><button class="btn mini" onclick="Paso1.elegirHoja('${tipo}')">Usar esta hoja</button></div>`;
    } else if(b){
      inner=`<div class="kv"><span>Archivo: <b>${escapeHtml(b.archivo)}</b></span><span>Hoja: <b>${escapeHtml(b.hoja)}</b></span>
        <span>Filas útiles: <b>${b.utiles.toLocaleString('es-CO')}</b></span>
        <span>Fechas: <b>${fmtFecha(b.fechaMin)} → ${fmtFecha(b.fechaMax)}</b></span></div>
        <div class="note" style="margin-top:6px">Cargada ${new Date(b.cargadoEn).toLocaleString('es-CO')}. Vuelve a seleccionar el archivo para recargar (re-concilia faltantes automáticamente).</div>`;
    } else inner=`<div class="note">Aún sin cargar.</div>`;
    return `<div class="card"><h3>${tipo==='GRANULARES'?'📦 GRANULARES.xlsx':'🏗️ TERRAPLEN.xlsx'} <span class="note">hoja BASE 2026</span></h3>
      <label class="filebox ${b?'loaded':''}"><input type="file" accept=".xlsx,.xlsm,.xlsb,.xls" onchange="Paso1.cargar(this,'${tipo}')">
        <div class="fb-title">${b?'✅ '+escapeHtml(b.archivo):'Seleccionar '+tipo+'.xlsx'}</div>
        <div class="fb-sub">clic para ${b?'recargar':'cargar'} (copia local)</div></label>
      <div style="margin-top:10px">${inner}</div></div>`;
  };
  return `<div class="paso-title">Paso 1 · Cargar bases</div>
  <div class="paso-desc">Carga las copias locales de las dos bases de la digitadora. Solo se lee la hoja <b>BASE 2026</b> de cada archivo;
  si no existe, podrás señalarla. Las bases quedan en memoria y se reutilizan al cambiar de contratista.</div>
  <div class="grid2">${box('GRANULARES')}${box('TERRAPLEN')}</div>
  ${S.corte&&S.corte.reclamos.length?`<div class="card"><h3>🔁 Ciclo digitadora</h3>
    <div class="note">Con un corte abierto, recargar cualquiera de las bases re-corre SOLO las remisiones en
    <span class="chip NO_ENCONTRADA">No encontrada</span> y <span class="chip PENDIENTE_DIGITACION">Pendiente digitación</span>.
    Las decisiones manuales y las encontradas no se tocan.</div></div>`:''}`;
}

const Paso1={
  cargar(input,tipo){
    const f=input.files&&input.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      let wb;
      try{ wb=XLSX.read(rd.result,{type:'array',cellDates:false}); }
      catch(e){ toast('❌ No se pudo leer '+f.name+': '+e.message); render(); return; }
      const def=BASES_DEF[tipo];
      if(wb.SheetNames.indexOf(def.hojaDefecto)>=0){
        Paso1._procesar(wb,tipo,f.name,def.hojaDefecto);
      } else {
        S.basePendiente[tipo]={wb,archivo:f.name,hojas:wb.SheetNames.slice()};
        render();
      }
    };
    rd.readAsArrayBuffer(f);
  },
  elegirHoja(tipo){
    const pend=S.basePendiente[tipo]; if(!pend) return;
    const hoja=$('selHoja_'+tipo).value;
    Paso1._procesar(pend.wb,tipo,pend.archivo,hoja);
  },
  _procesar(wb,tipo,archivo,hoja){
    const t0=performance.now();
    S.bases[tipo]=leerBase(wb.Sheets[hoja],tipo,archivo,hoja);
    delete S.basePendiente[tipo];
    const ms=Math.round(performance.now()-t0);
    let msg=`✅ ${tipo}: ${S.bases[tipo].utiles.toLocaleString('es-CO')} filas útiles (${ms} ms)`;
    if(S.corte&&S.corte.reclamos.length){
      const nuevos=conciliarPendientes();
      const r=reconciliar();
      if(r.revisadas||nuevos) msg+=` · re-conciliación: ${r.resueltas}/${r.revisadas} resueltas`;
    }
    toast(msg);
    autosave(); render();
  }
};

/* ---------- PASO 2: abrir corte ---------- */

function vistaPaso2(){
  const cfg=S.config;
  const opts=cfg.contratistas.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.nombre)} (${escapeHtml(c.ciudad)} · ${c.ambitos.join('+')})</option>`).join('');
  const basesOk=S.bases.GRANULARES&&S.bases.TERRAPLEN;
  return `<div class="paso-title">Paso 2 · Abrir corte</div>
  <div class="paso-desc">Se procesa un contratista a la vez. Al abrir otro corte, el actual se descarta
  (exporta la sesión antes si quieres conservarlo).</div>
  ${basesOk?'':'<div class="alert warn">⚠️ Aún no están cargadas las dos bases (Paso 1). Puedes abrir el corte, pero la conciliación quedará pendiente hasta cargarlas.</div>'}
  <div class="card">
    <div class="grid2">
      <div><label class="fld">Contratista</label><select id="selContratista">${opts}</select></div>
      <div class="grid2">
        <div><label class="fld">Quincena · inicio</label><input type="date" id="qIni" value="${cfg.quincenaActual.inicio}"></div>
        <div><label class="fld">Quincena · fin</label><input type="date" id="qFin" value="${cfg.quincenaActual.fin}"></div>
      </div>
    </div>
    <div style="margin-top:14px" class="flexrow">
      <button class="btn" onclick="Paso2.abrir()">Abrir corte →</button>
      ${S.corte?`<span class="note">Corte actual: <b>${escapeHtml(S.corte.contratistaId)}</b> con ${S.corte.reclamos.length} reclamadas</span>`:''}
    </div>
  </div>
  <div class="card"><h3>Empresas que nunca se concilian</h3>
    <div class="note">${(cfg.empresasVetadas||[]).map(escapeHtml).join(' · ')} — la herramienta rechaza abrir corte con ellas
    (flota propia / fuera de alcance).</div></div>`;
}

const Paso2={
  abrir(){
    const id=$('selContratista').value;
    const ini=$('qIni').value, fin=$('qFin').value;
    const c=getContratista(id);
    if(!c){ toast('❌ Contratista no encontrado en la configuración'); return; }
    const vet=(S.config.empresasVetadas||[]).map(normTexto);
    if(vet.indexOf(normTexto(c.id))>=0 || c.alias.some(a=>vet.indexOf(normTexto(a))>=0)){
      toast('⛔ '+c.nombre+' está en la lista de empresas que nunca se concilian.'); return;
    }
    if(!ini||!fin||fin<ini){ toast('❌ Revisa las fechas de la quincena'); return; }
    if(S.corte&&S.corte.reclamos.length&&!confirm('Hay un corte abierto con '+S.corte.reclamos.length+' reclamadas. ¿Descartarlo y abrir uno nuevo?')) return;
    S.corte={contratistaId:id,quincena:{inicio:ini,fin:fin},abiertoEn:nowISO(),
      proformas:[],reclamos:[],yaNoReclamadas:[],secuencia:0};
    S.ocr={running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{}};
    S.pdfs=[];
    S.config.quincenaActual={inicio:ini,fin:fin}; guardarConfig();
    autosave();
    toast('✅ Corte abierto: '+c.nombre);
    UI.go(3);
  }
};

/* ---------- PASO 3: proforma ---------- */

function vistaPaso3(){
  if(!S.corte) return `<div class="paso-title">Paso 3 · Cargar proforma</div><div class="alert warn">Primero abre un corte (Paso 2).</div>`;
  const c=getContratista(S.corte.contratistaId);
  let lista='';
  for(const pf of S.corte.proformas){
    lista+=`<div class="card"><h3>📄 ${escapeHtml(pf.archivo)}</h3><div class="tbl-wrap"><table class="tbl">
      <tr><th>Hoja</th><th>Ámbito</th><th>Encabezado</th><th>Reclamadas</th><th>Notas</th><th></th></tr>`;
    for(let i=0;i<pf.hojas.length;i++){
      const h=pf.hojas[i];
      let amb, extra='';
      if(h.estado==='ok'){
        amb=`<b>${h.ambito}</b>${h.modo?' <span class="marca">interno</span>':''}`;
      } else if(h.estado==='ignorada'){
        amb='<span class="note">IGNORADA</span>';
      } else if(h.estado==='sin_ambito'){
        amb=`<select id="selAmb_${pf.idx}_${i}">
          <option value="GRANULARES">GRANULARES</option><option value="TERRAPLEN">TERRAPLEN</option>
          <option value="TERRAPLEN_INTERNO">TERRAPLEN (interno)</option><option value="AMBAS">AMBAS</option>
          <option value="IGNORAR">IGNORAR</option></select>`;
        extra=`<label style="font-size:11px"><input type="checkbox" id="chkRegla_${pf.idx}_${i}" checked> guardar regla</label>
          <button class="btn mini" onclick="Paso3.resolverHoja(${pf.idx},${i})">Aplicar</button>`;
      } else if(h.estado==='sin_columna'){
        amb=`<b>${h.ambito}</b>`;
        extra=`<span class="note" style="color:var(--error)">sin columna de remisión reconocible</span>
          <button class="btn mini" onclick="Paso3.elegirColumna(${pf.idx},${i})">Señalar columna…</button>`;
      }
      lista+=`<tr><td class="mono">${escapeHtml(h.nombre)}</td><td>${amb}</td>
        <td class="note">${h.enc?('fila '+h.enc.fila+' · col '+colLetter(h.enc.col)):'—'}</td>
        <td>${h.n!=null?h.n:'—'}</td>
        <td class="note">${(h.notas&&h.notas.length)?h.notas.length+' nota(s): '+escapeHtml(h.notas.slice(0,2).map(x=>x.texto).join(' | ')).slice(0,80):''}</td>
        <td>${extra}</td></tr>`;
    }
    lista+=`</table></div></div>`;
  }
  return `<div class="paso-title">Paso 3 · Cargar proforma — ${escapeHtml(c.nombre)}</div>
  <div class="paso-desc">Uno o varios .xlsx del contratista, cada uno con su formato. El encabezado y la columna de remisión
  se auto-detectan con los alias de la configuración; las hojas se enrutan por los patrones del contratista. Si una hoja
  no se reconoce, la señalas tú (y puedes guardar la regla).</div>
  <div class="card">
    <label class="filebox"><input type="file" multiple accept=".xlsx,.xlsm,.xls" onchange="Paso3.cargar(this)">
      <div class="fb-title">Agregar archivo(s) de proforma</div><div class="fb-sub">se concilia automáticamente al cargar</div></label>
    <div class="flexrow" style="margin-top:10px">
      <button class="btn sec mini" onclick="Paso3.reemplazarClick()">♻️ Reemplazar proforma (versión 2)</button>
      <span class="note">borra lo NO decidido manualmente y re-concilia; las decisiones se conservan si el número sigue reclamado</span>
    </div>
  </div>
  ${lista||'<div class="note">Aún no hay archivos de proforma cargados.</div>'}
  ${S.corte.yaNoReclamadas.length?`<div class="alert warn"><b>Ya no reclamadas tras reemplazo:</b> ${S.corte.yaNoReclamadas.map(escapeHtml).join(', ')}</div>`:''}
  ${S.corte.reclamos.length?`<div class="flexrow"><button class="btn" onclick="UI.go(4)">Ver conciliación (${S.corte.reclamos.length}) →</button></div>`:''}`;
}

const Paso3={
  _reemplazo:false,
  cargar(input){
    const files=Array.from(input.files||[]); if(!files.length) return;
    if(this._reemplazo){ this._prepararReemplazo(); }
    let pendientes=files.length;
    for(const f of files){
      const rd=new FileReader();
      rd.onload=()=>{
        try{ Paso3._procesarArchivo(XLSX.read(rd.result,{type:'array',cellDates:false}),f.name); }
        catch(e){ toast('❌ Error leyendo '+f.name+': '+e.message); }
        if(--pendientes===0) Paso3._finCarga();
      };
      rd.readAsArrayBuffer(f);
    }
    input.value='';
  },
  _procesarArchivo(wb,nombre){
    const c=getContratista(S.corte.contratistaId);
    const pf={idx:S.corte.proformas.length,archivo:nombre,hojas:[]};
    S.corte.proformas.push(pf);
    for(const sn of wb.SheetNames){
      const ws=wb.Sheets[sn];
      const res=resolverAmbitoHoja(sn,c);
      const meta={nombre:sn,estado:null,ambito:null,modo:null,enc:null,n:null,notas:[]};
      pf.hojas.push(meta);
      if(res&&res.ambito==='IGNORAR'){ meta.estado='ignorada'; continue; }
      if(!res){ meta.estado='sin_ambito'; meta._ws=ws; continue; } // NO adivinar: lo resuelve el usuario
      Paso3._extraer(ws,pf,meta,res.ambito,res.modo);
    }
  },
  _extraer(ws,pf,meta,ambito,modo){
    meta.ambito=ambito; meta.modo=modo||null;
    const out=extraerReclamosHoja(ws,pf.archivo,meta.nombre,ambito,modo||null,S.config);
    if(out.error==='sin_columna'){ meta.estado='sin_columna'; meta._ws=ws; return; }
    meta.estado='ok'; meta.enc=out.enc; meta.n=out.reclamos.length; meta.notas=out.notas;
    for(const rc of out.reclamos) S.corte.reclamos.push(rc);
    delete meta._ws;
  },
  _finCarga(){
    conciliarPendientes();
    Paso3._transferirDecisiones();
    autosave(); render();
    const c=conteoEstados();
    toast(`✅ Conciliado: ${c.ENCONTRADA} encontradas · ${c.NO_ENCONTRADA} no encontradas · ${c.REVISION_MANUAL+c.MULTIPLE_EN_BASE} por revisar`);
  },
  resolverHoja(pfIdx,hIdx){
    const pf=S.corte.proformas[pfIdx]; const meta=pf.hojas[hIdx];
    const v=$('selAmb_'+pfIdx+'_'+hIdx).value;
    const guardar=$('chkRegla_'+pfIdx+'_'+hIdx).checked;
    const ambito=v==='TERRAPLEN_INTERNO'?'TERRAPLEN':v;
    const modo=v==='TERRAPLEN_INTERNO'?'interno':null;
    if(guardar){
      const c=getContratista(S.corte.contratistaId);
      const pat='^'+normTexto(meta.nombre).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
      c.hojas.unshift(Object.assign({patron:pat,ambito:v==='TERRAPLEN_INTERNO'?'TERRAPLEN':v},modo?{modo:'interno'}:{}));
      guardarConfig();
    }
    if(v==='IGNORAR'){ meta.estado='ignorada'; delete meta._ws; autosave(); render(); return; }
    Paso3._extraer(meta._ws,pf,meta,ambito,modo);
    Paso3._finCarga();
  },
  elegirColumna(pfIdx,hIdx){
    const pf=S.corte.proformas[pfIdx]; const meta=pf.hojas[hIdx]; const ws=meta._ws;
    // muestra las primeras 12 filas para que el usuario señale fila de encabezado y columna
    const rng=refRange(ws); const maxC=Math.min(rng.cols,20); const maxR=Math.min(rng.rows,12);
    let tabla='<table class="tbl"><tr><th></th>';
    for(let c=0;c<maxC;c++) tabla+='<th>'+colLetter(c)+'</th>';
    tabla+='</tr>';
    for(let r=1;r<=maxR;r++){
      tabla+='<tr><td class="note">'+r+'</td>';
      for(let c=0;c<maxC;c++){
        const t=cellText(ws,colLetter(c)+r);
        tabla+=`<td class="mono" style="cursor:pointer" onclick="Paso3.columnaElegida(${pfIdx},${hIdx},${r},${c})" title="usar como encabezado de remisión">${escapeHtml(String(t).slice(0,18))}</td>`;
      }
      tabla+='</tr>';
    }
    tabla+='</table>';
    abrirModal(`<h3>Señalar columna de remisión — ${escapeHtml(meta.nombre)}</h3>
      <div class="note" style="margin-bottom:8px">Haz clic sobre la celda del ENCABEZADO de la columna de remisiones.
      El texto de esa celda se puede guardar como alias para próximas proformas.</div>
      <div class="tbl-wrap">${tabla}</div>
      <div style="margin-top:10px"><label style="font-size:12px"><input type="checkbox" id="chkAliasNuevo" checked> guardar el texto como alias de columna-remisión</label></div>`);
  },
  columnaElegida(pfIdx,hIdx,fila,col){
    const pf=S.corte.proformas[pfIdx]; const meta=pf.hojas[hIdx]; const ws=meta._ws;
    const txt=cellText(ws,colLetter(col)+fila);
    if($('chkAliasNuevo')&&$('chkAliasNuevo').checked&&txt){
      const a=normCol(txt);
      if(a&&S.config.aliasColumnaRemision.indexOf(a)<0){ S.config.aliasColumnaRemision.push(a); guardarConfig(); }
    }
    cerrarModal();
    // extrae usando esa fila/col como encabezado forzado
    const cfg=S.config;
    const sec=detectarSecundarias(ws,fila,col,cfg);
    const out={enc:{fila,col},sec,reclamos:[],notas:[]};
    const colRem=colLetter(col); const maxR=refRange(ws).rows; let vacias=0;
    for(let r=fila+1;r<=maxR;r++){
      const raw=cellText(ws,colRem+r);
      const s={};
      for(const campo of Object.keys(sec)){
        const addr=colLetter(sec[campo])+r;
        if(campo==='fecha'){ const f=parseFechaCell(ws[addr]); if(f) s.fecha=f; }
        else { const t=cellText(ws,addr); if(t) s[campo]=t; }
      }
      const base={archivo:pf.archivo,hoja:meta.nombre,fila:r,ambito:meta.ambito,modo:meta.modo,secundarios:s};
      if(!raw){ if(Object.keys(s).length){ out.reclamos.push(mkReclamo(Object.assign({raw:'',motivo:'remisión vacía en fila con datos'},base))); vacias=0; } else if(++vacias>1000) break; continue; }
      vacias=0;
      const tokens=extraerTokens(raw);
      if(tokens.length===0){ if(/\d/.test(raw)) out.reclamos.push(mkReclamo(Object.assign({raw,obs:raw,motivo:'sin remisión extraíble'},base))); else out.notas.push({fila:r,texto:raw}); continue; }
      if(esParSospechoso(tokens)){ out.reclamos.push(mkReclamo(Object.assign({raw,obs:raw,tokensPendientes:tokens,motivo:'¿lista o rango? confirmar'},base))); continue; }
      for(const t of tokens) out.reclamos.push(mkReclamo(Object.assign({remision:normRem(t),raw,multi:tokens.length>1,obs:(normRem(raw)!==normRem(t))?raw:''},base)));
    }
    meta.estado='ok'; meta.enc=out.enc; meta.n=out.reclamos.length; meta.notas=out.notas; delete meta._ws;
    for(const rc of out.reclamos) S.corte.reclamos.push(rc);
    Paso3._finCarga();
  },
  reemplazarClick(){
    if(!S.corte.reclamos.length){ toast('No hay proforma que reemplazar; carga archivos normalmente.'); return; }
    if(!confirm('Reemplazar proforma: se borran las reclamaciones NO decididas manualmente y se re-concilia con los archivos que cargues ahora. ¿Continuar?')) return;
    this._reemplazo=true;
    toast('Selecciona ahora los archivos de la nueva versión de la proforma.');
  },
  _prepararReemplazo(){
    this._reemplazo=false;
    S.corte._decididasPrevias=S.corte.reclamos.filter(r=>r.decisionManual);
    S.corte.reclamos=[]; S.corte.proformas=[]; S.corte.yaNoReclamadas=[];
  },
  _transferirDecisiones(){
    const prev=S.corte._decididasPrevias; if(!prev||!prev.length) return;
    delete S.corte._decididasPrevias;
    for(const old of prev){
      const nuevo=old.remision?S.corte.reclamos.find(r=>r.remision===old.remision&&!r.decisionManual):null;
      if(nuevo){
        nuevo.estado=old.estado; nuevo.historial=old.historial.concat([{ts:nowISO(),de:'PENDIENTE',a:old.estado,nota:'decisión conservada tras reemplazo de proforma',auto:true}]);
        nuevo.decisionManual=true; nuevo.candidato=old.candidato; nuevo.evidencia=old.evidencia; nuevo.subtipo=old.subtipo;
      } else {
        S.corte.yaNoReclamadas.push(old.remision||old.raw||('fila '+old.fila));
      }
    }
  }
};

/* ---------- PASO 4: tablero ---------- */

function vistaPaso4(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 4 · Conciliación</div><div class="alert warn">Carga una proforma primero (Paso 3).</div>`;
  const c=conteoEstados();
  const cards=ESTADOS.filter(e=>c[e]>0||['ENCONTRADA','NO_ENCONTRADA'].indexOf(e)>=0).map(e=>
    `<div class="estado-card ${S.ui.filtroEstado===e?'sel':''}" onclick="Paso4.filtrar('${e}')">
      <div class="cnt" style="color:${colorEstado(e)}">${c[e]}</div><div class="lbl">${ETIQUETA[e]}</div></div>`).join('');
  const basesOk=S.bases.GRANULARES&&S.bases.TERRAPLEN;
  return `<div class="paso-title">Paso 4 · Conciliación</div>
  <div class="paso-desc">Automática al cargar. Haz clic en un estado para filtrar; clic en una fila para ver el detalle y decidir.</div>
  ${basesOk?'':'<div class="alert err">⚠️ Faltan bases por cargar: hay reclamaciones sin conciliar. Ve al Paso 1.</div>'}
  <div class="tablero">${cards}</div>
  <div class="flexrow" style="margin-bottom:10px">
    <button class="btn sec mini" onclick="Paso4.recargarBases()">🔁 Recargar bases y re-conciliar</button>
    ${S.ui.filtroEstado?`<button class="btn sec mini" onclick="Paso4.filtrar(null)">✕ Quitar filtro (${ETIQUETA[S.ui.filtroEstado]})</button>`:''}
    <span class="note right">${S.corte.reclamos.length} reclamaciones</span>
  </div>
  ${tablaReclamos(S.ui.filtroEstado?S.corte.reclamos.filter(r=>r.estado===S.ui.filtroEstado):S.corte.reclamos)}`;
}

function colorEstado(e){
  return {ENCONTRADA:'var(--ok)',ACEPTADA_MANUAL:'var(--ok)',NO_ENCONTRADA:'var(--error)',RECHAZADA:'var(--error)',
    MULTIPLE_EN_BASE:'var(--purple)',DUPLICADA_EN_PROFORMA:'var(--info)',PENDIENTE_DIGITACION:'#5dade2',
    REVISION_MANUAL:'#ffb84d',EXCLUIDA_UF3:'var(--warn)',EXCLUIDA_OTRA_AREA:'var(--warn)',EXCLUIDA_ASFALTO:'var(--warn)'}[e]||'var(--muted)';
}

function tablaReclamos(lista){
  if(!lista.length) return '<div class="note">Sin reclamaciones en este filtro.</div>';
  const filas=lista.map(rc=>{
    const cd=rc.candidato;
    return `<tr onclick="Acciones.detalle('${rc.id}')" style="cursor:pointer">
      <td class="mono"><b>${escapeHtml(rc.remision||('['+(rc.raw||'vacía')+']'))}</b></td>
      <td class="note">${escapeHtml(rc.hoja)}${rc.modo?' <span class="marca">interno</span>':''}</td>
      <td>${rc.ambito}</td>
      <td><span class="chip ${rc.estado}">${ETIQUETA[rc.estado]}</span>${rc.subtipo&&rc.estado==='EXCLUIDA_OTRA_AREA'?' <span class="marca">'+escapeHtml(rc.subtipo)+'</span>':''}</td>
      <td>${rc.marcas.map(m=>`<span class="marca ${m}">${m.replace(/_/g,' ')}</span>`).join('')}</td>
      <td class="note">${cd?fmtFecha(cd.fecha)+' · '+escapeHtml(cd.placa)+' · '+escapeHtml(String(cd.cantidad)):(rc.sugerencias.length?'≈ existe con otra empresa':'')}</td>
    </tr>`;
  }).join('');
  return `<div class="tbl-wrap"><table class="tbl">
    <tr><th>Remisión</th><th>Hoja</th><th>Ámbito</th><th>Estado</th><th>Marcas</th><th>Candidato (fecha · placa · cant)</th></tr>${filas}</table></div>`;
}

const Paso4={
  filtrar(e){ S.ui.filtroEstado=(S.ui.filtroEstado===e)?null:e; render(); },
  recargarBases(){ toast('Vuelve a seleccionar los archivos de base en el Paso 1: al cargar se re-concilian las faltantes automáticamente.'); UI.go(1); }
};

/* ---------- Modal de detalle + acciones ---------- */

function abrirModal(html){ $('modal').innerHTML=html; $('modal-bg').classList.add('open'); }
function cerrarModal(){ $('modal-bg').classList.remove('open'); S.ui.detalle=null; }

function cardCandidato(cd,idx,rcId,esSugerencia){
  const btn=esSugerencia?'' :`<div style="margin-top:8px"><button class="btn mini ok" onclick="Acciones.usarCandidato('${rcId}',${idx})">Usar este candidato</button></div>`;
  return `<div class="cand-card ${esSugerencia?'sug':''}">
    <div class="row"><span class="k">Base</span><b>${cd.ambito}</b></div>
    ${esSugerencia?`<div class="row"><span class="k">Empresa</span><b>${escapeHtml(cd.empresa)}</b></div>`:''}
    <div class="row"><span class="k">Fecha</span><span>${fmtFecha(cd.fecha)}</span></div>
    <div class="row"><span class="k">Placa</span><span>${escapeHtml(cd.placa)}</span></div>
    <div class="row"><span class="k">Cantidad</span><span>${escapeHtml(String(cd.cantidad))}</span></div>
    <div class="row"><span class="k">Origen→Destino</span><span>${escapeHtml(String(cd.kmIni))} → ${escapeHtml(String(cd.kmFin))}</span></div>
    <div class="row"><span class="k">UF / Área</span><span>${escapeHtml(cd.uf)} / ${escapeHtml(cd.area)||'—'}</span></div>
    <div class="row"><span class="k">Remisión base</span><span class="mono">${escapeHtml(cd.rem)}</span></div>
    ${btn}</div>`;
}

const Acciones={
  _rc(id){ return S.corte?S.corte.reclamos.find(r=>r.id===id):null; },
  detalle(id){
    const rc=this._rc(id); if(!rc) return;
    S.ui.detalle=id;
    const sec=Object.entries(rc.secundarios||{}).map(([k,v])=>`<span>${k}: <b>${escapeHtml(k==='fecha'?fmtFecha(v):String(v))}</b></span>`).join(' · ');
    let cuerpo='';
    if(rc.candidato&&['ENCONTRADA','EXCLUIDA_UF3','EXCLUIDA_OTRA_AREA','ACEPTADA_MANUAL','PENDIENTE_DIGITACION'].indexOf(rc.estado)>=0){
      cuerpo+=`<h4 style="font-size:12px;color:var(--muted);margin:10px 0 6px">CANDIDATO ASIGNADO</h4><div class="cand-grid">${cardCandidato(rc.candidato,-1,rc.id,true)}</div>`;
    }
    if(rc.candidatos&&rc.candidatos.length){
      cuerpo+=`<h4 style="font-size:12px;color:var(--muted);margin:10px 0 6px">CANDIDATOS (elige o rechaza — el sistema no adivina)</h4>
        <div class="cand-grid">${rc.candidatos.map((cd,i)=>cardCandidato(cd,i,rc.id,false)).join('')}</div>`;
    }
    if(rc.sugerencias&&rc.sugerencias.length){
      cuerpo+=`<h4 style="font-size:12px;color:var(--muted);margin:10px 0 6px">EXISTE CON OTRA EMPRESA (solo informativo)</h4>
        <div class="cand-grid">${rc.sugerencias.map((cd,i)=>cardCandidato(cd,i,rc.id,true)).join('')}</div>`;
    }
    if(rc.tokensPendientes){
      cuerpo+=`<div class="alert warn">Celda ambigua <b class="mono">${escapeHtml(rc.raw)}</b>: ¿lista de 2 números o rango? El sistema no adivina.
        <div class="flexrow" style="margin-top:8px">
          <button class="btn mini" onclick="Acciones.explotarLista('${rc.id}')">Es lista → explotar en ${rc.tokensPendientes.length}</button>
          <button class="btn mini danger" onclick="Acciones.transicion('${rc.id}','RECHAZADA')">Rechazar</button>
        </div></div>`;
    }
    if(rc.evidencia) cuerpo+=`<div class="alert info">Comprobante: <b>${escapeHtml(rc.evidencia.archivo)}</b> · página ${rc.evidencia.pagina}</div>`;
    const hist=rc.historial.map(h=>`<div>${new Date(h.ts).toLocaleString('es-CO')} — ${h.de} → <b>${h.a}</b>${h.nota?' · '+escapeHtml(h.nota):''} ${h.auto?'(auto)':'(manual)'}</div>`).join('');
    const botones=this._botones(rc);
    abrirModal(`<h3><span class="mono">${escapeHtml(rc.remision||rc.raw||'—')}</span>
      <span class="chip ${rc.estado}" style="margin-left:8px">${ETIQUETA[rc.estado]}</span>
      ${rc.marcas.map(m=>`<span class="marca ${m}">${m.replace(/_/g,' ')}</span>`).join('')}</h3>
      <div class="kv"><span>Archivo: <b>${escapeHtml(rc.archivo)}</b></span><span>Hoja: <b>${escapeHtml(rc.hoja)}</b></span>
      <span>Fila: <b>${rc.fila}</b></span><span>Ámbito: <b>${rc.ambito}${rc.modo?' (interno)':''}</b></span></div>
      ${sec?`<div class="kv" style="margin-top:6px">${sec}</div>`:''}
      ${rc.obs?`<div class="note" style="margin-top:6px">Observación proforma: “${escapeHtml(rc.obs)}”</div>`:''}
      ${cuerpo}
      <div class="flexrow" style="margin-top:14px">${botones}</div>
      <div style="margin-top:12px"><label class="fld">Nota (obligatoria para aceptar manual)</label>
      <input type="text" id="notaManual" placeholder="motivo / evidencia / referencia"></div>
      <div class="hist">${hist||'Sin historial'}</div>
      <div style="margin-top:12px;text-align:right"><button class="btn sec mini" onclick="cerrarModal()">Cerrar</button></div>`);
  },
  _botones(rc){
    const b=[];
    const t=(estado,label,cls)=>`<button class="btn mini ${cls||'sec'}" onclick="Acciones.transicion('${rc.id}','${estado}')">${label}</button>`;
    if(rc.estado==='NO_ENCONTRADA'){
      b.push(`<button class="btn mini" onclick="cerrarModal();UI.go(5)">🔍 Buscar en PDFs (Paso 5)</button>`);
      b.push(t('PENDIENTE_DIGITACION','→ Pendiente digitación'));
      b.push(t('EXCLUIDA_ASFALTO','Es ASFALTO'));
      b.push(t('ACEPTADA_MANUAL','Aceptar manual','ok'));
      b.push(t('RECHAZADA','Rechazar','danger'));
    } else if(rc.estado==='REVISION_MANUAL'||rc.estado==='MULTIPLE_EN_BASE'){
      b.push(t('NO_ENCONTRADA','→ No encontrada'));
      b.push(t('ACEPTADA_MANUAL','Aceptar manual','ok'));
      b.push(t('RECHAZADA','Rechazar','danger'));
    } else if(rc.estado==='DUPLICADA_EN_PROFORMA'){
      b.push(t('RECHAZADA','Rechazar','danger'));
      b.push(`<span class="note">La primera aparición ya se procesó; esta queda como duplicada.</span>`);
    } else {
      b.push(t('ACEPTADA_MANUAL','Aceptar manual','ok'));
      b.push(t('RECHAZADA','Rechazar','danger'));
      b.push(t('NO_ENCONTRADA','→ No encontrada'));
      if(rc.estado!=='EXCLUIDA_ASFALTO') b.push(t('EXCLUIDA_ASFALTO','Es ASFALTO'));
    }
    return b.join('');
  },
  transicion(id,estado){
    const rc=this._rc(id); if(!rc) return;
    const nota=($('notaManual')&&$('notaManual').value.trim())||'';
    if(estado==='ACEPTADA_MANUAL'&&!nota){ toast('⚠️ La nota es obligatoria para Aceptar manual.'); return; }
    setEstado(rc,estado,nota||null,false);
    autosave(); cerrarModal(); render();
  },
  usarCandidato(id,idx){
    const rc=this._rc(id); if(!rc) return;
    const cd=rc.candidatos[idx]; if(!cd) return;
    // reconstruir un "row" mínimo desde el snapshot para el clasificador
    const row=Object.assign({tipo:cd.ambito},cd);
    const nota=($('notaManual')&&$('notaManual').value.trim())||('candidato elegido a mano ('+cd.ambito+' fila '+cd.fila+')');
    clasificar(rc,row,S.config,false,nota);
    autosave(); cerrarModal(); render();
  },
  explotarLista(id){
    const rc=this._rc(id); if(!rc||!rc.tokensPendientes) return;
    const toks=rc.tokensPendientes;
    setEstado(rc,'RECHAZADA','celda explotada como lista: '+toks.join(', '),false);
    for(const t of toks){
      const nuevo=mkReclamo({remision:normRem(t),raw:rc.raw,multi:true,obs:rc.raw,
        archivo:rc.archivo,hoja:rc.hoja,fila:rc.fila,ambito:rc.ambito,modo:rc.modo,secundarios:rc.secundarios});
      S.corte.reclamos.push(nuevo);
    }
    conciliarPendientes();
    autosave(); cerrarModal(); render();
  }
};

/* ============================ 8. PASO 5: INVESTIGACIÓN PDF ============================ */

const CDN={
  pdfjs:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker:'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract:'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
  pdflib:'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
};
function loadScript(url){
  return new Promise((res,rej)=>{
    if(document.querySelector('script[src="'+url+'"]')) return res();
    const s=document.createElement('script'); s.src=url;
    s.onload=res; s.onerror=()=>rej(new Error('No se pudo cargar '+url+' (¿sin red?)'));
    document.head.appendChild(s);
  });
}
async function ensurePdfjs(){
  if(window.pdfjsLib) return;
  await loadScript(CDN.pdfjs);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc=CDN.pdfjsWorker;
}

function faltantes(){ return S.corte?S.corte.reclamos.filter(r=>r.estado==='NO_ENCONTRADA'&&r.remision):[]; }

function vistaPaso5(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 5 · Investigación PDF</div><div class="alert warn">Carga y concilia una proforma primero.</div>`;
  const falt=faltantes();
  const archivos=S.pdfs.map((p,i)=>`<tr><td>${p.kind==='pdf'?'📕':'🖼️'} ${escapeHtml(p.name)}</td>
    <td>${p.error?'<span style="color:var(--error)">'+escapeHtml(p.error)+'</span>':p.numPages+' pág.'}</td>
    <td><button class="btn sec mini" onclick="Paso5.verPaginas(${i})">Hojear</button></td></tr>`).join('');
  const lista=falt.map(rc=>{
    const cands=(S.ocr.candidatos[rc.remision]||[]).filter(c=>!S.ocr.descartados[rc.remision+'|'+c.key]);
    const v=cands.filter(c=>c.nivel==='verde').length, n=cands.filter(c=>c.nivel==='naranja').length;
    return `<div class="falt-item ${S.ui.faltanteSel===rc.id?'sel':''}" onclick="Paso5.sel('${rc.id}')">
      <span class="mono"><b>${escapeHtml(rc.remision)}</b></span>
      <span>${v?`<span class="badge verde">${v}</span>`:''}${n?`<span class="badge naranja">${n}</span>`:''}</span></div>`;
  }).join('');
  return `<div class="paso-title">Paso 5 · Investigación PDF</div>
  <div class="paso-desc">Búsqueda dirigida: el sistema ya sabe qué números faltan (${falt.length} no encontradas); el OCR solo
  ubica en qué página aparecen. NUNCA se auto-confirma nada — tú validas viendo la página. El navegador manual de páginas
  siempre está disponible (el OCR es ayuda, no requisito).</div>
  <div class="card"><h3>📎 Partes escaneados</h3>
    <label class="filebox"><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onchange="Paso5.cargar(this)">
      <div class="fb-title">Agregar PDFs o imágenes de partes</div><div class="fb-sub">1–3 partes por página · también acepta jpg/png sueltos</div></label>
    ${S.pdfs.length?`<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><tr><th>Archivo</th><th>Páginas</th><th></th></tr>${archivos}</table></div>`:''}
  </div>
  <div class="card"><h3>🔍 OCR dirigido</h3>
    ${!falt.length?'<div class="alert ok">No hay remisiones NO_ENCONTRADA: no hace falta OCR.</div>':`
    <div class="flexrow">
      <button class="btn" id="btnOcr" onclick="Paso5.correr()" ${S.ocr.running||!S.pdfs.length?'disabled':''}>${S.ocr.running?'Procesando…':'▶ Buscar faltantes en los PDFs'}</button>
      ${S.ocr.running?'<button class="btn danger mini" onclick="Paso5.cancelar()">✕ Cancelar</button>':''}
      <span class="note" id="ocrEstado">${S.ocr.total?`${S.ocr.hecho}/${S.ocr.total} páginas`:''}</span>
    </div>
    <div class="progress-wrap" style="margin-top:8px"><div class="progress-bar" id="ocrBar" style="width:${S.ocr.total?Math.round(100*S.ocr.hecho/S.ocr.total):0}%"></div></div>
    <div class="note" style="margin-top:6px">Pasada A: franjas rojas (número impreso arriba-derecha, 1–3 partes por página).
    Pasada B (respaldo / AVENSA): página completa en gris. Coincidencia exacta = <span class="badge verde">verde</span>,
    un dígito de diferencia = <span class="badge naranja">naranja</span>. Resultados en caché de la sesión.</div>`}
  </div>
  <div class="p5-layout">
    <div><h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">Faltantes (${falt.length})</h3>${lista||'<div class="note">Ninguna 🎉</div>'}</div>
    <div id="p5derecha"><div class="note">Selecciona una faltante a la izquierda, o usa “Hojear” sobre un archivo.</div></div>
  </div>`;
}

const Paso5={
  _thumbCancel:false,
  postRender(){
    if(S.ui.faltanteSel) this._renderCandidatos(S.ui.faltanteSel);
  },
  cargar(input){
    const files=Array.from(input.files||[]); if(!files.length) return;
    (async()=>{
      for(const f of files){
        const bytes=new Uint8Array(await f.arrayBuffer());
        const esImg=/\.(jpe?g|png)$/i.test(f.name);
        const entry={name:f.name,kind:esImg?'img':'pdf',bytes,numPages:1,doc:null,error:null};
        if(!esImg){
          try{
            await ensurePdfjs();
            entry.doc=await window.pdfjsLib.getDocument({data:bytes.slice()}).promise;
            entry.numPages=entry.doc.numPages;
          }catch(e){ entry.error='no abre ('+(e.message||'protegido/corrupto')+')'; entry.numPages=0; }
        }
        S.pdfs.push(entry);
      }
      input.value=''; autosave(); render();
    })();
  },
  cancelar(){ S.ocr.cancel=true; },
  sel(id){ S.ui.faltanteSel=(S.ui.faltanteSel===id)?null:id; render(); },

  // ---- render de páginas ----
  _pageCache:new Map(),
  async renderPagina(pdfIdx,pagina,scale){
    const key=pdfIdx+':'+pagina+':'+scale;
    if(this._pageCache.has(key)) return this._pageCache.get(key);
    const p=S.pdfs[pdfIdx]; if(!p||p.error) return null;
    const canvas=document.createElement('canvas');
    if(p.kind==='img'){
      const img=await new Promise((res,rej)=>{
        const im=new Image();
        im.onload=()=>res(im); im.onerror=rej;
        im.src=URL.createObjectURL(new Blob([p.bytes]));
      });
      canvas.width=Math.round(img.width*scale/2); canvas.height=Math.round(img.height*scale/2);
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    } else {
      const page=await p.doc.getPage(pagina);
      const vp=page.getViewport({scale});
      canvas.width=vp.width; canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
    }
    if(this._pageCache.size>10){ const k0=this._pageCache.keys().next().value; this._pageCache.delete(k0); }
    this._pageCache.set(key,canvas);
    return canvas;
  },

  // ---- OCR ----
  async correr(){
    const falt=faltantes(); if(!falt.length||!S.pdfs.length) return;
    S.ocr.running=true; S.ocr.cancel=false;
    S.ocr.total=S.pdfs.reduce((a,p)=>a+(p.error?0:p.numPages),0);
    S.ocr.hecho=0;
    render();
    let worker=null;
    try{
      await ensurePdfjs();
      await loadScript(CDN.tesseract);
      worker=await Tesseract.createWorker('eng');
      const faltSet=new Set(); const faltSC=new Set();
      for(const rc of falt){ faltSet.add(rc.remision); faltSC.add(rc.remSC); }
      for(let fi=0;fi<S.pdfs.length;fi++){
        const p=S.pdfs[fi]; if(p.error) continue;
        for(let pg=1;pg<=p.numPages;pg++){
          if(S.ocr.cancel) throw new Error('cancelado');
          const key=p.name+'#'+pg;
          if(!S.ocr.paginas[key]){
            const canvas=await this.renderPagina(fi,pg,2.0);
            const tokens=await this._ocrPagina(worker,canvas,faltSet,faltSC);
            S.ocr.paginas[key]=tokens;
          }
          this._cruzar(p.name,pg,fi,S.ocr.paginas[key],falt);
          S.ocr.hecho++;
          const bar=$('ocrBar'); if(bar) bar.style.width=Math.round(100*S.ocr.hecho/S.ocr.total)+'%';
          const est=$('ocrEstado'); if(est) est.textContent=S.ocr.hecho+'/'+S.ocr.total+' páginas · '+p.name+' p.'+pg;
        }
      }
      toast('✅ OCR terminado. Revisa los candidatos por faltante.');
    }catch(e){
      toast(e.message==='cancelado'?'OCR cancelado (lo procesado queda en caché).':'❌ OCR: '+e.message);
    }finally{
      if(worker){ try{ await worker.terminate(); }catch(_){} }
      S.ocr.running=false; S.ocr.cancel=false;
      autosave(); render();
    }
  },
  async _ocrPagina(worker,canvas,faltSet,faltSC){
    const tokens=new Set();
    const W=canvas.width,H=canvas.height;
    // Pasada A (roja): mitad derecha de cada tercio de la página (2–3 partes por página).
    await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'11'});
    for(let t=0;t<3;t++){
      const y0=Math.floor(t*H/3), h=Math.ceil(H/3);
      const reg=this._recorteRojo(canvas,Math.floor(W/2),y0,W-Math.floor(W/2),h);
      if(!reg) continue;   // sin píxeles rojos suficientes
      try{
        const r=await worker.recognize(reg);
        for(const m of (r.data.text.match(/\d{3,6}/g)||[])) tokens.add(m);
      }catch(_){}
    }
    // ¿alguna coincidencia exacta ya?
    let exacto=false;
    for(const tk of tokens){ if(faltSet.has(tk)||faltSC.has(sinCeros(tk))||faltSet.has(sinCeros(tk))){ exacto=true; break; } }
    if(!exacto){
      // Pasada B (gris, respaldo y formato AVENSA): página completa.
      await worker.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'3'});
      const gris=this._aGris(canvas,1400);
      try{
        const r=await worker.recognize(gris);
        for(const m of (r.data.text.match(/\d{3,6}/g)||[])) tokens.add(m);
      }catch(_){}
    }
    return Array.from(tokens);
  },
  // Filtro rojo por píxel (r>60 && r>max(g,b)*1.3 && r-max(g,b)>20) → binario, upscale 4×.
  _recorteRojo(canvas,x,y,w,h){
    const ctx=canvas.getContext('2d');
    const img=ctx.getImageData(x,y,w,h); const d=img.data;
    const out=document.createElement('canvas'); out.width=w; out.height=h;
    const octx=out.getContext('2d'); const oimg=octx.createImageData(w,h); const od=oimg.data;
    let rojos=0;
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2]; const mx=Math.max(g,b);
      const es=(r>60 && r>mx*1.3 && (r-mx)>20);
      if(es) rojos++;
      const v=es?0:255;
      od[i]=v; od[i+1]=v; od[i+2]=v; od[i+3]=255;
    }
    if(rojos<40) return null;
    octx.putImageData(oimg,0,0);
    const up=document.createElement('canvas'); up.width=w*4; up.height=h*4;
    const uctx=up.getContext('2d'); uctx.imageSmoothingEnabled=false;
    uctx.drawImage(out,0,0,up.width,up.height);
    return up;
  },
  _aGris(canvas,maxW){
    const sc=Math.min(1,maxW/canvas.width);
    const out=document.createElement('canvas'); out.width=Math.round(canvas.width*sc); out.height=Math.round(canvas.height*sc);
    const ctx=out.getContext('2d'); ctx.filter='grayscale(1)'; ctx.drawImage(canvas,0,0,out.width,out.height);
    return out;
  },
  _cruzar(fileName,pg,fileIdx,tokens,falt){
    for(const tk of tokens){
      for(const rc of falt){
        let nivel=null;
        if(tk===rc.remision||sinCeros(tk)===rc.remSC) nivel='verde';
        else if(dist1(tk,rc.remision)<=1) nivel='naranja';
        if(!nivel) continue;
        const key=fileName+'#'+pg;
        if(!S.ocr.candidatos[rc.remision]) S.ocr.candidatos[rc.remision]=[];
        const ya=S.ocr.candidatos[rc.remision].some(c=>c.key===key&&c.token===tk);
        if(!ya) S.ocr.candidatos[rc.remision].push({key,file:fileName,fileIdx,page:pg,token:tk,nivel});
      }
    }
  },

  // ---- UI derecha: candidatos de la faltante seleccionada ----
  async _renderCandidatos(rcId){
    const rc=S.corte.reclamos.find(r=>r.id===rcId); if(!rc) return;
    const cont=$('p5derecha'); if(!cont) return;
    const cands=(S.ocr.candidatos[rc.remision]||[]).filter(c=>!S.ocr.descartados[rc.remision+'|'+c.key]);
    cands.sort((a,b)=>a.nivel==='verde'&&b.nivel!=='verde'?-1:b.nivel==='verde'&&a.nivel!=='verde'?1:0);
    let html=`<h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">Candidatos para <span class="mono">${escapeHtml(rc.remision)}</span></h3>`;
    if(!cands.length) html+='<div class="note">Sin candidatos OCR (corre el OCR o usa el navegador manual de abajo).</div>';
    html+='<div id="candPaginas"></div>';
    html+=`<h3 style="font-size:13px;color:var(--accent);margin:14px 0 8px">Navegador manual de páginas</h3>
      <div class="note" style="margin-bottom:8px">Hojea cualquier archivo y asigna la página a la faltante seleccionada.</div>
      ${S.pdfs.map((p,i)=>`<button class="btn sec mini" onclick="Paso5.verPaginas(${i})">${escapeHtml(p.name)} (${p.numPages})</button>`).join(' ')}`;
    cont.innerHTML=html;
    const cp=$('candPaginas');
    for(const c of cands.slice(0,6)){
      // índice resuelto por NOMBRE: tras importar sesión los PDFs pueden re-cargarse en otro orden
      const fi=S.pdfs.findIndex(p=>p.name===c.file);
      const div=document.createElement('div'); div.className='pagina-view';
      div.innerHTML=`<div class="flexrow" style="margin-bottom:6px">
        <span class="badge ${c.nivel}">${c.nivel==='verde'?'exacto':'≈ '+escapeHtml(c.token)}</span>
        <b>${escapeHtml(c.file)}</b> · página ${c.page}
        <span class="right"></span>
        ${fi>=0?`<button class="btn mini ok" onclick="Paso5.confirmar('${rc.id}',${fi},${c.page})">✔ Confirmar comprobante</button>
        <button class="btn mini sec" onclick="Paso5.esAsfalto('${rc.id}',${fi},${c.page})">Es ASFALTO</button>`:''}
        <button class="btn mini danger" onclick="Paso5.noEs('${rc.id}',${cands.indexOf(c)})">No es</button></div>
        <div class="ph note">renderizando página…</div>`;
      cp.appendChild(div);
      if(fi<0){ div.querySelector('.ph').textContent='archivo no cargado en esta sesión: re-selecciona '+c.file+' arriba.'; continue; }
      try{
        const canvas=await this.renderPagina(fi,c.page,1.4);
        if(canvas){ div.querySelector('.ph').replaceWith(canvas); }
      }catch(e){ div.querySelector('.ph').textContent='no se pudo renderizar: '+e.message; }
    }
  },
  confirmar(rcId,fileIdx,page){
    const rc=S.corte.reclamos.find(r=>r.id===rcId); if(!rc) return;
    const p=S.pdfs[fileIdx];
    rc.evidencia={archivo:p.name,pagina:page};
    setEstado(rc,'PENDIENTE_DIGITACION','comprobante confirmado en '+p.name+' p.'+page,false);
    S.ui.faltanteSel=null;
    autosave(); render();
    toast('✅ '+rc.remision+' → Pendiente digitación');
  },
  esAsfalto(rcId,fileIdx,page){
    const rc=S.corte.reclamos.find(r=>r.id===rcId); if(!rc) return;
    const p=S.pdfs[fileIdx];
    rc.evidencia={archivo:p.name,pagina:page};
    setEstado(rc,'EXCLUIDA_ASFALTO','parte de asfalto en '+p.name+' p.'+page,false);
    S.ui.faltanteSel=null;
    autosave(); render();
  },
  noEs(rcId,candIdx){
    const rc=S.corte.reclamos.find(r=>r.id===rcId); if(!rc) return;
    const cands=(S.ocr.candidatos[rc.remision]||[]).filter(c=>!S.ocr.descartados[rc.remision+'|'+c.key]);
    cands.sort((a,b)=>a.nivel==='verde'&&b.nivel!=='verde'?-1:b.nivel==='verde'&&a.nivel!=='verde'?1:0);
    const c=cands[candIdx]; if(!c) return;
    S.ocr.descartados[rc.remision+'|'+c.key]=true;
    autosave(); render();
  },
  async verPaginas(fileIdx){
    const p=S.pdfs[fileIdx]; if(!p||p.error){ toast('Ese archivo no abre.'); return; }
    this._thumbCancel=true; await new Promise(r=>setTimeout(r,30)); this._thumbCancel=false;
    const selId=S.ui.faltanteSel;
    const rc=selId?S.corte.reclamos.find(r=>r.id===selId):null;
    abrirModal(`<h3>${escapeHtml(p.name)} — ${p.numPages} páginas ${rc?`· asignando a <span class="mono">${escapeHtml(rc.remision)}</span>`:'<span class="note">(sin faltante seleccionada: solo lectura)</span>'}</h3>
      <div class="thumbs" id="thumbsGrid"></div>
      <div style="margin-top:12px;text-align:right"><button class="btn sec mini" onclick="cerrarModal()">Cerrar</button></div>`);
    const grid=$('thumbsGrid');
    for(let pg=1;pg<=p.numPages;pg++){
      if(this._thumbCancel||!document.body.contains(grid)) break;
      const d=document.createElement('div'); d.className='thumb';
      d.innerHTML=`<div class="tlab">p.${pg}</div>`;
      d.onclick=()=>Paso5.verGrande(fileIdx,pg);
      grid.appendChild(d);
      try{
        const c=await this.renderPagina(fileIdx,pg,0.3);
        if(c) d.insertBefore(c,d.firstChild);
      }catch(_){}
    }
  },
  async verGrande(fileIdx,page){
    const p=S.pdfs[fileIdx];
    const selId=S.ui.faltanteSel;
    const rc=selId?S.corte.reclamos.find(r=>r.id===selId):null;
    abrirModal(`<h3>${escapeHtml(p.name)} · página ${page}</h3>
      <div class="flexrow" style="margin-bottom:8px">
        ${rc?`<button class="btn mini ok" onclick="Paso5.confirmar('${rc.id}',${fileIdx},${page})">✔ Confirmar para ${escapeHtml(rc.remision)}</button>
        <button class="btn mini sec" onclick="Paso5.esAsfalto('${rc.id}',${fileIdx},${page})">Es ASFALTO</button>`:'<span class="note">Selecciona una faltante en el Paso 5 para poder asignar esta página.</span>'}
        <button class="btn sec mini" onclick="Paso5.verPaginas(${fileIdx})">← Volver a miniaturas</button>
      </div>
      <div class="pagina-view" id="pgGrande"><div class="note">renderizando…</div></div>`);
    try{
      const c=await this.renderPagina(fileIdx,page,1.8);
      const cont=$('pgGrande'); if(cont){ cont.innerHTML=''; cont.appendChild(c); }
    }catch(e){ const cont=$('pgGrande'); if(cont) cont.textContent='error: '+e.message; }
  }
};

/* ============================ 9. PASOS 6 Y 7 ============================ */

function vistaPaso6(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 6 · Resolución manual</div><div class="alert warn">Carga una proforma primero.</div>`;
  const cola=S.corte.reclamos.filter(r=>
    ['REVISION_MANUAL','MULTIPLE_EN_BASE','DUPLICADA_EN_PROFORMA','NO_ENCONTRADA'].indexOf(r.estado)>=0
    || r.marcas.indexOf('INTERNO_MAYOR_3KM')>=0);
  return `<div class="paso-title">Paso 6 · Resolución manual</div>
  <div class="paso-desc">Cola de todo lo que requiere una decisión tuya: revisión manual, múltiples en base, duplicadas,
  no encontradas y alertas de internos &gt;3 km. Cada decisión queda auditada (estado anterior, nuevo, fecha-hora, nota).</div>
  ${cola.length?tablaReclamos(cola):'<div class="alert ok">🎉 Nada pendiente de decisión.</div>'}`;
}

/* ---------- PASO 7: exportes ---------- */

function obsReclamo(rc){
  const o=[];
  if(rc.marcas.indexOf('REZAGO')>=0&&rc.candidato&&rc.candidato.fecha) o.push('rezago '+fmtRezago(rc.candidato.fecha));
  if(rc.estado==='ACEPTADA_MANUAL') o.push('resuelta manual');
  if(rc.notaReconciliacion) o.push('resuelta en re-conciliación');
  if(rc.marcas.indexOf('CELDA_MULTIPLE')>=0) o.push('de celda múltiple');
  if(rc.marcas.indexOf('MATCH_SIN_CEROS')>=0) o.push('match sin ceros confirmado');
  return o.join(' · ');
}

function filasActa(){
  const cfg=S.config;
  const lista=S.corte.reclamos.filter(r=>ESTADOS_ACTA.indexOf(r.estado)>=0);
  lista.sort((a,b)=>{
    const fa=(a.candidato&&a.candidato.fecha)||'9999-99-99', fb=(b.candidato&&b.candidato.fecha)||'9999-99-99';
    if(fa!==fb) return fa<fb?-1:1;
    return (a.remision||'')<(b.remision||'')?-1:1;
  });
  return lista.map(rc=>cfg.actaLayout.map(cd=>{
    if(!cd.campo) return '';                       // derivada: César arrastra su fórmula
    if(cd.campo==='remision') return rc.remision||'';
    if(cd.campo==='obs') return obsReclamo(rc);
    const c=rc.candidato; if(!c) return '';
    if(cd.campo==='fecha') return c.fecha?fmtFecha(c.fecha):'';
    const v=c[cd.campo];
    return v==null?'':v;
  }));
}

function vistaPaso7(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 7 · Exportes</div><div class="alert warn">Carga una proforma primero.</div>`;
  const cfg=S.config; const c=conteoEstados();
  const acta=filasActa();
  const pend=S.corte.reclamos.filter(r=>r.estado==='PENDIENTE_DIGITACION');
  const cab=cfg.actaLayout.map(cd=>`<th>${escapeHtml(cd.col)}<br><span style="font-weight:400">${escapeHtml(cd.titulo)}</span></th>`).join('');
  const filas=acta.slice(0,200).map(row=>'<tr>'+row.map(v=>`<td>${escapeHtml(fmtNumTSV(v,cfg.decimalTSV))}</td>`).join('')+'</tr>').join('');
  const resumen=resumenCorte();
  return `<div class="paso-title">Paso 7 · Exportes</div>
  <div class="paso-desc">Bloque de VALORES para pegar en el acta (reemplaza los XLOOKUP), Excel para la digitadora,
  PDF de comprobantes pendientes y resumen del corte.</div>

  <div class="card"><h3>1 · Bloque acta (${acta.length} filas: encontradas + aceptadas manuales)</h3>
    <div class="flexrow" style="margin-bottom:8px">
      <button class="btn" onclick="Exportes.copiarActa()">📋 Copiar bloque (TSV)</button>
      <button class="btn sec" onclick="Exportes.xlsxActa()">⬇ Descargar .xlsx</button>
      <label style="font-size:12px"><input type="checkbox" id="chkTsvHeader" ${S.ui.tsvHeader?'checked':''} onchange="S.ui.tsvHeader=this.checked"> incluir encabezado en el TSV</label>
    </div>
    <div class="note" style="margin-bottom:8px">Orden: fecha y luego remisión. Columnas derivadas (A,B,D,E,N,O) van VACÍAS —
    después de pegar, arrastra tus fórmulas. Decimales del TSV con “${escapeHtml(cfg.decimalTSV)}” (configurable).</div>
    <div class="tbl-wrap" style="max-height:340px;overflow-y:auto"><table class="tbl"><tr>${cab}</tr>${filas}</table></div>
    ${acta.length>200?'<div class="note">(vista previa limitada a 200 filas; el export lleva todas)</div>':''}
  </div>

  <div class="card"><h3>2 · Excel digitadora (${pend.length} pendientes de digitación)</h3>
    <div class="flexrow"><button class="btn sec" onclick="Exportes.xlsxDigitadora()" ${pend.length?'':'disabled'}>⬇ Descargar .xlsx</button>
    <span class="note">remisión + datos de la proforma + archivo/página del comprobante + notas</span></div></div>

  <div class="card"><h3>3 · PDF de pendientes</h3>
    <div class="flexrow"><button class="btn sec" onclick="Exportes.pdfPendientes()" ${pend.filter(r=>r.evidencia).length?'':'disabled'}>⬇ Generar PDF</button>
    <span class="note">páginas confirmadas de los comprobantes (deduplicadas, en orden por remisión) para enviar a la digitadora</span></div></div>

  <div class="card"><h3>4 · Resumen del corte</h3>
    <div class="flexrow" style="margin-bottom:8px">
      <button class="btn sec mini" onclick="Exportes.copiarResumen()">📋 Copiar</button>
      <button class="btn sec mini" onclick="Exportes.xlsxResumen()">⬇ .xlsx</button></div>
    <pre class="mono" style="white-space:pre-wrap;font-size:12px;color:var(--text)">${escapeHtml(resumen)}</pre></div>`;
}

function resumenCorte(){
  const c=conteoEstados(); const contr=getContratista(S.corte.contratistaId);
  const q=S.corte.quincena;
  const lin=[];
  lin.push('CORTE '+(contr?contr.nombre:S.corte.contratistaId)+' · '+fmtFecha(q.inicio)+' → '+fmtFecha(q.fin));
  lin.push('Reclamadas: '+S.corte.reclamos.length);
  for(const e of ESTADOS){ if(c[e]) lin.push('  '+ETIQUETA[e]+': '+c[e]); }
  const listar=(titulo,arr,fmt)=>{ if(arr.length){ lin.push(''); lin.push(titulo+' ('+arr.length+'):'); for(const rc of arr) lin.push('  '+(fmt?fmt(rc):rc.remision)); } };
  listar('EXCLUIDAS UF3',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_UF3'));
  listar('EXCLUIDAS OTRA ÁREA',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_OTRA_AREA'),rc=>rc.remision+' ['+(rc.subtipo||'')+']');
  listar('EXCLUIDAS ASFALTO',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_ASFALTO'));
  listar('RECHAZADAS',S.corte.reclamos.filter(r=>r.estado==='RECHAZADA'),rc=>(rc.remision||rc.raw));
  listar('DUPLICADAS',S.corte.reclamos.filter(r=>r.estado==='DUPLICADA_EN_PROFORMA'));
  listar('REZAGOS',S.corte.reclamos.filter(r=>r.marcas.indexOf('REZAGO')>=0),rc=>rc.remision+' ('+(rc.candidato?fmtFecha(rc.candidato.fecha):'')+')');
  listar('INTERNOS > 3 KM (verificar acuerdo aparte)',S.corte.reclamos.filter(r=>r.marcas.indexOf('INTERNO_MAYOR_3KM')>=0),rc=>rc.remision+' ('+(rc.candidato?rc.candidato.kmTot:'')+' km)');
  const yn=S.corte.yaNoReclamadas||[];
  if(yn.length){ lin.push(''); lin.push('YA NO RECLAMADAS tras reemplazo de proforma ('+yn.length+'): '+yn.join(', ')); }
  return lin.join('\n');
}

const Exportes={
  _nombre(suf,ext){
    const c=getContratista(S.corte.contratistaId);
    return (suf+'_'+(c?c.id:'corte')+'_'+S.corte.quincena.inicio+'_'+S.corte.quincena.fin+'.'+ext).replace(/\s+/g,'_');
  },
  async copiarActa(){
    const cfg=S.config; const rows=filasActa();
    const lines=rows.map(r=>r.map(v=>fmtNumTSV(v,cfg.decimalTSV)).join('\t'));
    if(S.ui.tsvHeader) lines.unshift(cfg.actaLayout.map(c=>c.titulo).join('\t'));
    const ok=await copiarTexto(lines.join('\n'));
    toast(ok?('📋 Bloque copiado ('+rows.length+' filas). Pega directo en el acta.'):'⚠️ No se pudo copiar al portapapeles.');
  },
  xlsxActa(){
    const cfg=S.config;
    const aoa=[cfg.actaLayout.map(c=>c.titulo)].concat(filasActa());
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'BLOQUE ACTA');
    XLSX.writeFile(wb,this._nombre('bloque_acta','xlsx'));
  },
  xlsxDigitadora(){
    const pend=S.corte.reclamos.filter(r=>r.estado==='PENDIENTE_DIGITACION');
    const aoa=[['Remisión','Ámbito','Fecha proforma','Placa','Cantidad','Origen','Destino','Archivo PDF','Página','Notas']];
    for(const rc of pend){
      const s=rc.secundarios||{};
      const notas=[rc.obs, rc.historial.filter(h=>!h.auto&&h.nota).map(h=>h.nota).join(' · ')].filter(Boolean).join(' · ');
      aoa.push([rc.remision,rc.ambito,s.fecha?fmtFecha(s.fecha):'',s.placa||'',s.cantidad||'',s.origen||'',s.destino||'',
        rc.evidencia?rc.evidencia.archivo:'',rc.evidencia?rc.evidencia.pagina:'',notas]);
    }
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'PENDIENTES DIGITACION');
    XLSX.writeFile(wb,this._nombre('digitadora','xlsx'));
  },
  async pdfPendientes(){
    const pend=S.corte.reclamos.filter(r=>r.estado==='PENDIENTE_DIGITACION'&&r.evidencia);
    if(!pend.length){ toast('No hay pendientes con comprobante confirmado.'); return; }
    try{ await loadScript(CDN.pdflib); }catch(e){ toast('❌ '+e.message); return; }
    pend.sort((a,b)=>(a.remision<b.remision?-1:1));
    const vistos=new Set(); const orden=[];
    for(const rc of pend){
      const k=rc.evidencia.archivo+'#'+rc.evidencia.pagina;
      if(vistos.has(k)) continue; vistos.add(k); orden.push(rc.evidencia);
    }
    const {PDFDocument}=window.PDFLib;
    const out=await PDFDocument.create();
    const srcCache={};
    let fallos=0;
    for(const ev of orden){
      const src=S.pdfs.find(p=>p.name===ev.archivo);
      if(!src){ fallos++; continue; }
      try{
        if(src.kind==='img'){
          const esPng=/\.png$/i.test(src.name);
          const img=esPng?await out.embedPng(src.bytes):await out.embedJpg(src.bytes);
          const pg=out.addPage([img.width,img.height]);
          pg.drawImage(img,{x:0,y:0,width:img.width,height:img.height});
        } else {
          if(!srcCache[src.name]) srcCache[src.name]=await PDFDocument.load(src.bytes,{ignoreEncryption:true});
          const [pg]=await out.copyPages(srcCache[src.name],[ev.pagina-1]);
          out.addPage(pg);
        }
      }catch(e){ fallos++; }
    }
    const bytes=await out.save();
    descargar(this._nombre('pdf_pendientes','pdf'),new Blob([bytes],{type:'application/pdf'}));
    toast('⬇ PDF generado con '+(orden.length-fallos)+' páginas'+(fallos?(' ('+fallos+' no se pudieron copiar — ¿re-seleccionaste los PDFs tras importar sesión?)'):''));
  },
  async copiarResumen(){
    const ok=await copiarTexto(resumenCorte());
    toast(ok?'📋 Resumen copiado':'⚠️ No se pudo copiar');
  },
  xlsxResumen(){
    const c=conteoEstados();
    const aoa=[['Estado','Cantidad']];
    for(const e of ESTADOS) if(c[e]) aoa.push([ETIQUETA[e],c[e]]);
    aoa.push([]); aoa.push(['Remisión','Estado','Subtipo/Marcas','Fecha base','Hoja','Observación']);
    for(const rc of S.corte.reclamos){
      if(['EXCLUIDA_UF3','EXCLUIDA_OTRA_AREA','EXCLUIDA_ASFALTO','RECHAZADA','DUPLICADA_EN_PROFORMA'].indexOf(rc.estado)>=0
        || rc.marcas.indexOf('REZAGO')>=0 || rc.marcas.indexOf('INTERNO_MAYOR_3KM')>=0){
        aoa.push([rc.remision||rc.raw,ETIQUETA[rc.estado],[rc.subtipo].concat(rc.marcas).filter(Boolean).join(' · '),
          rc.candidato?fmtFecha(rc.candidato.fecha):'',rc.hoja,rc.obs||'']);
      }
    }
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'RESUMEN');
    XLSX.writeFile(wb,this._nombre('resumen','xlsx'));
  }
};

/* ============================ CONFIG (pantalla) ============================ */

function vistaConfig(){
  const json=JSON.stringify(S.config,null,2);
  return `<div class="paso-title">⚙️ Configuración</div>
  <div class="paso-desc">JSON versionado: alias de columnas, áreas excluyentes, layout del acta y contratistas (con sus
  reglas de hojas). Persistido en localStorage; el JSON exportado es la fuente de respaldo.</div>
  <div class="card">
    <div class="flexrow" style="margin-bottom:10px">
      <button class="btn" onclick="Cfg.guardar()">💾 Guardar</button>
      <button class="btn sec" onclick="Cfg.exportar()">⬇ Exportar JSON</button>
      <button class="btn sec" onclick="Cfg.importarClick()">📂 Importar JSON</button>
      <button class="btn danger" onclick="Cfg.restaurarSeed()">↺ Restaurar seed</button>
      <input type="file" id="cfgFileInput" accept=".json" style="display:none" onchange="Cfg.importar(this)">
    </div>
    <textarea id="cfgEditor" rows="30" spellcheck="false">${escapeHtml(json)}</textarea>
  </div>`;
}

const Cfg={
  guardar(){
    try{
      const c=JSON.parse($('cfgEditor').value);
      if(!c.contratistas||!Array.isArray(c.contratistas)) throw new Error('falta "contratistas"');
      if(!c.actaLayout||!Array.isArray(c.actaLayout)) throw new Error('falta "actaLayout"');
      if(!c.aliasColumnaRemision) throw new Error('falta "aliasColumnaRemision"');
      S.config=c; guardarConfig();
      toast('✅ Configuración guardada');
    }catch(e){ toast('❌ JSON inválido: '+e.message,6000); }
  },
  exportar(){ descargar('conciliador_config_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(S.config,null,2),'application/json'); },
  importarClick(){ $('cfgFileInput').click(); },
  importar(input){
    const f=input.files&&input.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const c=JSON.parse(rd.result);
        if(!c.contratistas) throw new Error('no parece una config del conciliador');
        S.config=c; guardarConfig(); render();
        toast('✅ Configuración importada');
      }catch(e){ toast('❌ '+e.message,6000); }
    };
    rd.readAsText(f); input.value='';
  },
  restaurarSeed(){
    if(!confirm('¿Restaurar la configuración seed? Se pierden los cambios (exporta antes si dudas).')) return;
    S.config=configSeed(); guardarConfig(); render();
  }
};

/* ============================ 10. SESIÓN + INIT ============================ */

// Claves con prefijo "_" son transitorias (worksheets pendientes, buffers): no se serializan.
function sesionJSON(pretty){
  return JSON.stringify(sesionSerializable(),(k,v)=>(k&&k.charAt(0)==='_')?undefined:v,pretty?1:undefined);
}
function sesionSerializable(){
  return {
    tipo:'conciliador_sesion',version:1,ts:nowISO(),
    corte:S.corte,
    basesMeta:{
      GRANULARES:S.bases.GRANULARES?{archivo:S.bases.GRANULARES.archivo,hoja:S.bases.GRANULARES.hoja,utiles:S.bases.GRANULARES.utiles}:null,
      TERRAPLEN:S.bases.TERRAPLEN?{archivo:S.bases.TERRAPLEN.archivo,hoja:S.bases.TERRAPLEN.hoja,utiles:S.bases.TERRAPLEN.utiles}:null
    },
    pdfMeta:S.pdfs.map(p=>({name:p.name,pages:p.numPages,kind:p.kind})),
    ocr:{paginas:S.ocr.paginas,candidatos:S.ocr.candidatos,descartados:S.ocr.descartados}
  };
}

function autosave(){
  if(!S.corte) return;
  try{
    const json=sesionJSON(false);
    if(json.length>4500000){
      if(!S.ui.avisoLS){ S.ui.avisoLS=true; toast('⚠️ La sesión supera el límite de localStorage. Exporta la sesión a JSON para no perder trabajo.',7000); }
      return;
    }
    localStorage.setItem(LS_SESION,json);
  }catch(e){
    if(!S.ui.avisoLS){ S.ui.avisoLS=true; toast('⚠️ Autosave falló ('+e.message+'). Exporta la sesión a JSON.',7000); }
  }
}

const Sesion={
  exportar(){
    if(!S.corte){ toast('No hay corte abierto que exportar.'); return; }
    const c=getContratista(S.corte.contratistaId);
    descargar('conciliador_sesion_'+(c?c.id:'corte')+'_'+new Date().toISOString().slice(0,10)+'.json',
      sesionJSON(true),'application/json');
    toast('💾 Sesión exportada. Los binarios (bases, PDFs) no viajan: al importar se piden de nuevo.');
  },
  importarClick(){ $('sesionFileInput').click(); },
  importar(input){
    const f=input.files&&input.files[0]; if(!f) return;
    const rd=new FileReader();
    rd.onload=()=>{
      try{
        const s=JSON.parse(rd.result);
        if(s.tipo!=='conciliador_sesion'||!s.corte) throw new Error('no parece una sesión del conciliador');
        Sesion._aplicar(s);
        toast('✅ Sesión importada. Re-selecciona las bases (Paso 1) y los PDFs (Paso 5) con los MISMOS archivos.',8000);
      }catch(e){ toast('❌ '+e.message,6000); }
    };
    rd.readAsText(f); input.value='';
  },
  _aplicar(s){
    S.corte=s.corte;
    S.ocr={running:false,cancel:false,hecho:0,total:0,
      paginas:(s.ocr&&s.ocr.paginas)||{},candidatos:(s.ocr&&s.ocr.candidatos)||{},descartados:(s.ocr&&s.ocr.descartados)||{}};
    S.pdfs=[]; // binarios no serializados: re-seleccionar
    S._esperado={bases:s.basesMeta||{},pdfs:s.pdfMeta||[]};
    S.ui.paso=4; render();
  },
  descartarAuto(){
    localStorage.removeItem(LS_SESION);
    S.corte=null; S.pdfs=[];
    S.ocr={running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{}};
    render();
  }
};

// Validación de nombres al re-seleccionar tras importar (avisa si difiere, no bloquea).
function validarArchivoEsperado(tipoObjeto,nombre){
  const esp=S._esperado; if(!esp) return;
  if(tipoObjeto==='pdf'){
    if(esp.pdfs.length&&!esp.pdfs.some(p=>p.name===nombre))
      toast('⚠️ La sesión esperaba otros PDFs ('+esp.pdfs.map(p=>p.name).join(', ')+'). Verifica que sea el mismo archivo: '+nombre,7000);
  } else {
    const m=esp.bases[tipoObjeto];
    if(m&&m.archivo&&m.archivo!==nombre)
      toast('⚠️ La sesión se guardó con "'+m.archivo+'" y cargaste "'+nombre+'". Verifica que sea la misma base.',7000);
  }
}

function init(){
  S.config=cargarConfig();
  guardarConfig();
  // restaurar autosave si existe
  try{
    const raw=localStorage.getItem(LS_SESION);
    if(raw){
      const s=JSON.parse(raw);
      if(s&&s.corte&&s.corte.reclamos&&s.corte.reclamos.length){
        Sesion._aplicar(s);
        toast('↩️ Sesión anterior restaurada desde autosave ('+s.corte.reclamos.length+' reclamadas). '+
          'Re-selecciona bases y PDFs si vas a re-conciliar o exportar el PDF. '+
          '<button class="btn danger mini" onclick="Sesion.descartarAuto()">Descartar</button>',10000);
      }
    }
  }catch(e){ console.warn('autosave ilegible',e); }
  const inp=$('sesionFileInput'); if(inp) inp.onchange=function(){ Sesion.importar(this); };
  render();
}

/* ---- hooks de validación de nombres en cargas post-import ---- */
const _paso1Procesar=Paso1._procesar.bind(Paso1);
Paso1._procesar=function(wb,tipo,archivo,hoja){ validarArchivoEsperado(tipo,archivo); _paso1Procesar(wb,tipo,archivo,hoja); };
const _paso5Cargar=Paso5.cargar.bind(Paso5);
Paso5.cargar=function(input){
  for(const f of Array.from(input.files||[])) validarArchivoEsperado('pdf',f.name);
  _paso5Cargar(input);
};

/* ============================ ARRANQUE / EXPORTS NODE ============================ */

if(typeof module!=='undefined'&&module.exports){
  module.exports={
    normRem,sinCeros,normTexto,normCol,quitarTildes,escapeHtml,dist1,
    serialToISO,parseFechaTexto,parseFechaCell,fmtFecha,fmtRezago,
    colLetter,letterToNum,refRange,cellText,parseNum,fmtNumTSV,
    configSeed,seedHojas,cargarConfig,getContratista,
    BASES_DEF,leerBase,
    resolverAmbitoHoja,detectarEncabezado,detectarSecundarias,extraerTokens,esParSospechoso,
    mkReclamo,extraerReclamosHoja,
    snap,areaExcluyente,buscarCandidatos,buscarSinCeros,conciliarReclamo,clasificar,
    marcarDuplicadas,conciliarPendientes,reconciliar,setEstado,conteoEstados,
    obsReclamo,filasActa,resumenCorte,
    S,ESTADOS,ESTADOS_ACTA
  };
}
if(typeof document!=='undefined'){ init(); }

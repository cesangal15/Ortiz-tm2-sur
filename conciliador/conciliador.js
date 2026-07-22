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
    aliasColumnaRemision:['no recibo','# recibo','recibo','recibo no','no remision','remision','n recibo','no de recibo','no remesa','remesa','no recibo remesa'],
    aliasColumnasSecundarias:{
      fecha:['fecha','fecha del servicio'],
      placa:['placa','placa vehiculo'],
      cantidad:['mts','m3','cantidad material (m3)','cantidad material','cantidad de material','cantidad','cubicacion','cubicacion vehiculo','cubicacion del vehiculo','cubicaje','m3 vehiculo','total m3','cantidad transportada'],
      viajes:['no viajes','node viajes','no de viajes','viaje','viajes','cant viaje','cant viajes','cantidad viajes','no de viaje'],
      origen:['origen','sitio de procedencia','cargue','pk origen uf1','pk inicial','pr inicial','pr origen','pr de origen'],
      destino:['destino','sitio de descargue','descargue','pk final uf1','pk final','pr final','pr destino','pr de destino','obra'],
      material:['material','tipo material','tipo de material','material transportado','clase de material','producto','descripcion material','descripcion del material','descripcion de material','descripcion'],
      // km/m3km de la proforma: SOLO respaldo del bloque de pendientes cuando las reglas
      // propias (kmPorOrigen / resta de abscisas) no pueden calcular (el acta paga las
      // reglas de César, no lo que reclame el contratista)
      km:['km','kms','km totales','kilometros','kilometros totales','total km'],
      m3km:['total m3/km','m3/km','m3km','total m3km','m3 x km','m3*km','transporte m3*km','transporte de material m3*km']
    },
    // Material → sufijo de CC para la propuesta del bloque de pendientes (Paso 7).
    // Patrones levantados de las BASE 2026 reales (jul-2026); el prefijo 3701/3702
    // lo pone el PK (≤30→3701). Orden importa (SUB BASE antes que BASE). Editable.
    // nombreBase = cómo escribe la BASE ese material (col. actividad): el bloque de
    // pendientes lo usa en la col. G para que quede igual que las filas encontradas.
    ccPorMaterial:{
      GRANULARES:[
        {patron:'SUB\\s*-?\\s*BASE', suf:'.03.02', nombreBase:'Sub base', nota:'transporte de subbase granular'},
        {patron:'TDA', suf:'.03.03', nombreBase:'Base TDA con cemento', nota:'base estabilizada con cemento'},
        {patron:'BTC', suf:'.03.04', nombreBase:'BTC', nota:'transporte de base granular'},
        {patron:'BASE', suf:'.03.04', nombreBase:'Base Granular', nota:'transporte de base granular'},
        {patron:'CRUDO', suf:'.02.11', nombreBase:'Crudo de río', nota:'crudo de rio (explanaciones)'},
        {patron:'BOLO', suf:'.02.07', nombreBase:'Bolo (sobretamaño)', nota:'bolo/sobretamano (terraplenes conformacion)'},
        {patron:'PIEDRA\\s*FILTRO|FILTRO', suf:'.06.03', nombreBase:'Piedra filtro', nota:'granular drenante (ODT: revisar)'},
        {patron:'PSI\\s*4000|4000\\s*PSI|28\\s*MPA', suf:'.06.09', nombreBase:'PSI 4000 3/4" normal', nota:'concreto 28 MPa (ODT: revisar)'},
        {patron:'PSI\\s*2000|2000\\s*PSI|14\\s*MPA', suf:'.06.07', nombreBase:'PSI 2000 3/4" normal', nota:'concreto 14 MPa (ODT: revisar)'}
      ],
      TERRAPLEN:[
        {patron:'', suf:'.02.11', nota:'transporte explanaciones (corte, descapote, excavacion); actividad queda tal cual la proforma'}
      ]
    },
    // Kilómetros totales del bloque de pendientes según el ORIGEN (reglas de César,
    // verificadas contra la BASE 2026 real): Putana = PK destino/1000 + 2.5; Avensa y
    // Pekin siempre van al PK33 → fijos. Sin regla: |destino − origen| / 1000 (abscisas
    // en metros). Editable.
    kmPorOrigen:[
      {patron:'PUTANA', masKm:2.5},
      {patron:'AVENSA', fijo:25.7},
      {patron:'PEKIN', fijo:67.5}
    ],
    // Áreas OBSERVADAS: van al acta normalmente, con observación "área X" visible.
    // (Decisión jul-2026: solo excluyen UF3 y ASFALTO; PLANTA/PUENTE/TM1/ODT… se incluyen con nota.)
    areasObservadas:['PLANTA','PUENTE','TM1','AMP','RCD','ZODME - RCD','DIVISO - PUENTE'],
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
    if(raw){
      const c=JSON.parse(raw);
      if(c && c.contratistas && c.actaLayout){
        // migración: antes las áreas EXCLUÍAN; ahora solo se OBSERVAN (excluyen solo UF3 y asfalto)
        if(c.areasExcluyentes && !c.areasObservadas){ c.areasObservadas=c.areasExcluyentes; delete c.areasExcluyentes; }
        // migración: mapeo material→CC (jul-2026); se re-siembra si aún no trae nombreBase
        if(!c.ccPorMaterial||!Object.values(c.ccPorMaterial).some(arr=>(arr||[]).some(r=>r.nombreBase)))
          c.ccPorMaterial=configSeed().ccPorMaterial;
        // migración: alias de secundarias. El ORDEN del seed manda (la detección usa
        // prioridad por orden: p.ej. 'cubicaje' debe vencer a 'total m3'); se anexan al
        // final solo los alias propios del usuario que el seed no trae, para no perderlos.
        if(c.aliasColumnasSecundarias){
          const seedAl=configSeed().aliasColumnasSecundarias;
          for(const k of Object.keys(seedAl)){
            const user=c.aliasColumnasSecundarias[k]||[];
            const merged=seedAl[k].slice();
            for(const a of user) if(merged.indexOf(a)<0) merged.push(a);
            c.aliasColumnasSecundarias[k]=merged;
          }
        }
        // migración: alias de remisión nuevos (recibo no, remesa…) se fusionan con los guardados
        if(c.aliasColumnaRemision){
          for(const a of configSeed().aliasColumnaRemision) if(c.aliasColumnaRemision.indexOf(a)<0) c.aliasColumnaRemision.push(a);
        } else c.aliasColumnaRemision=configSeed().aliasColumnaRemision;
        // migración: km totales por origen (jul-2026)
        if(!c.kmPorOrigen) c.kmPorOrigen=configSeed().kmPorOrigen;
        return c;
      }
    }
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
  pdfs:[],                    // {name, kind:'pdf'|'img', bytes:Uint8Array, numPages, ambito, ambitoAuto, doc?, url?, error?}
  ocr:{running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{},editadas:{},revisadas:{}},
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
  // Encabezados normalizados de la fila (una sola pasada).
  const heads=[];
  for(let c=0;c<maxC;c++) heads.push(c===colRem?null:normCol(cellText(ws,colLetter(c)+fila)));
  const map={};
  for(const campo of Object.keys(cfg.aliasColumnasSecundarias||{})){
    const al=cfg.aliasColumnasSecundarias[campo].map(normCol);
    // Prioridad por ORDEN DE ALIAS, no por posición de columna: gana el primer alias de
    // la lista que exista como encabezado (así 'cubicaje' vence a 'total m3' aunque esté
    // más a la derecha; 'destino' vence a 'obra'). Entre columnas con el mismo encabezado,
    // la de más a la izquierda. Los alias van del más específico/confiable al más laxo.
    for(const a of al){
      if(!a) continue;
      const c=heads.indexOf(a);
      if(c>=0){ map[campo]=c; break; }
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
    candidato:null, candidatos:[], sugerencias:[], sugerenciasOtraBase:[],
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

// ¿El área amerita OBSERVACIÓN? (no excluye: la remisión va al acta con nota "área X")
function areaObservada(areaNorm,cfg){
  if(!areaNorm) return false;                                   // vacío = neutro
  const neutras=(cfg.areasNeutras||[]).map(normTexto);
  if(neutras.indexOf(areaNorm)>=0) return false;                // DIVISO = neutro
  if(areaNorm.indexOf('ODT')===0) return true;                  // ODT… siempre se observa
  const obs=(cfg.areasObservadas||cfg.areasExcluyentes||[]).map(normTexto);
  return obs.indexOf(areaNorm)>=0;
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
  // Sugerencia fuerte: existe en LA OTRA BASE cumpliendo empresa+fecha (¿hoja mal clasificada?).
  // Se muestra para que César la use con un clic; jamás match automático.
  rc.sugerenciasOtraBase=[];
  if(rc.ambito!=='AMBAS'){
    const otro=rc.ambito==='GRANULARES'?'TERRAPLEN':'GRANULARES';
    rc.sugerenciasOtraBase=buscarCandidatos(rc.remision,[otro],aliasNorm,cfg,true).slice(0,4).map(snap);
  }
  setEstado(rc,'NO_ENCONTRADA',null,true);
}

// Clasificador del candidato único (§6.3 enmendado jul-2026), también usado al elegir manualmente.
// Solo excluye UF3 (el asfalto se marca en investigación). Las áreas (PLANTA, PUENTE, TM1,
// ODT…) NO excluyen: la remisión va al acta con marca y observación "área X".
function clasificar(rc,row,cfg,auto,notaExtra){
  rc.candidato=snap(row);
  rc.marcas=rc.marcas.filter(m=>m!=='REZAGO'&&m!=='INTERNO_MAYOR_3KM'&&m!=='AREA_OBSERVADA');
  rc.subtipo=null;
  if(rc.candidato.fecha && S.corte && S.corte.quincena.inicio && rc.candidato.fecha<S.corte.quincena.inicio)
    addMarca(rc,'REZAGO');   // marca informativa: NUNCA excluye
  if(rc.candidato.ufNorm==='UF3'){ rc.subtipo='UF3'; setEstado(rc,'EXCLUIDA_UF3',notaExtra,auto); return; }
  if(areaObservada(rc.candidato.areaNorm,cfg)){
    rc.subtipo=rc.candidato.area||rc.candidato.areaNorm;
    addMarca(rc,'AREA_OBSERVADA');
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
      if(rc.ambito!=='AMBAS'){
        const otro=rc.ambito==='GRANULARES'?'TERRAPLEN':'GRANULARES';
        rc.sugerenciasOtraBase=buscarCandidatos(rc.remision,[otro],aliasNorm,cfg,true).slice(0,4).map(snap);
      }
    }
  }
  return {revisadas,resueltas};
}

// MODO SIN PROFORMA: el contratista no envió proforma; simplemente se toman de la(s) base(s)
// de sus ámbitos TODOS sus recibos (empresa ∈ alias) con fecha dentro del rango elegido, y
// se marcan como ENCONTRADAS para que vayan al acta. No requieren PDF (ya están digitados).
// Reemplaza cualquier reclamo previo del corte (es un modo distinto al de proforma). Solo se
// toman filas con empresa identificable: las de empresa vacía se omiten (no se asume dueño).
function tomarRecibosBase(inicio,fin){
  const c=getContratista(S.corte.contratistaId);
  const aliasNorm=(c?c.alias:[]).map(normTexto);
  let n=0, sinEmpresa=0; const basesUsadas=[];
  S.corte.reclamos=[]; S.corte.proformas=[]; S.corte.yaNoReclamadas=[]; S.corte.secuencia=0;
  for(const amb of (c?c.ambitos:[])){
    const base=S.bases[amb]; if(!base) continue;
    basesUsadas.push(amb);
    for(const row of base.rows){
      if(!row.fecha || row.fecha<inicio || row.fecha>fin) continue;
      if(aliasNorm.indexOf(row.empresaNorm)<0){ if(!row.empresaNorm) sinEmpresa++; continue; }
      const rc=mkReclamo({remision:row.rem, ambito:row.tipo, archivo:'(sin proforma)',
        hoja:base.hoja, fila:row.fila, secundarios:{}});
      rc.sinProforma=true;
      clasificar(rc,row,S.config,true,'sin proforma — tomado de la base');
      S.corte.reclamos.push(rc);
      n++;
    }
  }
  S.corte.sinProforma={inicio,fin,generadoEn:nowISO(),bases:basesUsadas};
  return {n,sinEmpresa,basesUsadas};
}

/* ============================ 6. MÁQUINA DE ESTADOS ============================ */

// Toda transición guarda: estado anterior, nuevo, fecha-hora, nota, auto/manual.
// Todo estado automático es reversible manualmente.
function setEstado(rc,nuevo,nota,auto){
  rc.historial.push({ts:nowISO(),de:rc.estado,a:nuevo,nota:nota||null,auto:!!auto});
  rc.estado=nuevo;
  if(!auto) rc.decisionManual=true;
}

// Vuelve un reclamo a PENDIENTE (para re-conciliar tras cambiar el ámbito de su hoja).
function resetReclamo(rc,nota){
  rc.historial.push({ts:nowISO(),de:rc.estado,a:'PENDIENTE',nota:nota||null,auto:true});
  rc.estado='PENDIENTE';
  rc.candidato=null; rc.candidatos=[]; rc.sugerencias=[]; rc.sugerenciasOtraBase=[];
  rc.subtipo=null; rc.notaReconciliacion=false;
  rc.marcas=rc.marcas.filter(m=>m==='CELDA_MULTIPLE');
}

// Hojas con pinta de estar en la base equivocada (caso real: hoja "CORTE CLIENTE 2026"
// dentro de un archivo de PUTANA → el patrón CORTE la mandó a TERRAPLÉN). El sistema
// NO se auto-corrige: muestra la evidencia y César decide con un clic.
function hojasSospechosas(){
  if(!S.corte) return [];
  const cfg=S.config; const aliasNorm=aliasNormActivo(); const out=[];
  for(const pf of S.corte.proformas){
    for(let i=0;i<pf.hojas.length;i++){
      const h=pf.hojas[i];
      if(h.estado!=='ok'||h.ambito==='AMBAS') continue;
      const otro=h.ambito==='GRANULARES'?'TERRAPLEN':'GRANULARES';
      if(!S.bases[otro]) continue;
      const claims=S.corte.reclamos.filter(r=>r.archivo===pf.archivo&&r.hoja===h.nombre&&r.remision);
      const noEnc=claims.filter(r=>r.estado==='NO_ENCONTRADA');
      if(claims.length<5||noEnc.length<claims.length*0.5) continue;
      let hallados=0;
      for(const r of noEnc) if(buscarCandidatos(r.remision,[otro],aliasNorm,cfg,true).length) hallados++;
      if(hallados>=Math.max(3,noEnc.length*0.5)) out.push({pfIdx:pf.idx,hIdx:i,archivo:pf.archivo,hoja:h.nombre,ambito:h.ambito,otro,noEnc:noEnc.length,hallados});
    }
  }
  return out;
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
    case 5: Paso5.recruzar(); m.innerHTML=vistaPaso5(); Paso5.postRender(); break;
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
    S.ocr={running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{},editadas:{},revisadas:{}};
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
  const q=S.corte.quincena;
  let lista='';
  for(const pf of S.corte.proformas){
    lista+=`<div class="card"><h3>📄 ${escapeHtml(pf.archivo)}</h3><div class="tbl-wrap"><table class="tbl">
      <tr><th>Hoja</th><th>Ámbito</th><th>Encabezado</th><th>Reclamadas</th><th>Notas</th><th></th></tr>`;
    for(let i=0;i<pf.hojas.length;i++){
      const h=pf.hojas[i];
      let amb, extra='';
      if(h.estado==='ok'){
        amb=`<b>${h.ambito}</b>${h.modo?' <span class="marca">interno</span>':''}
          <button class="btn sec mini" onclick="Paso3.cambiarAmbitoUI(${pf.idx},${i})" title="reasignar la base de esta hoja y re-conciliar">cambiar</button>`;
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
  const sosp=hojasSospechosas();
  const alertaSosp=sosp.map(s=>`<div class="alert warn">⚠️ La hoja <b>${escapeHtml(s.hoja)}</b> (${escapeHtml(s.archivo)})
    está asignada a <b>${s.ambito}</b>, pero ${s.hallados} de sus ${s.noEnc} no-encontradas SÍ existen en <b>${s.otro}</b>
    con tu contratista y fechas válidas. ¿Hoja mal clasificada?
    <button class="btn mini" onclick="Paso3.aplicarAmbito(${s.pfIdx},${s.hIdx},'${s.otro}',null,true)">Cambiar a ${s.otro} y re-conciliar</button></div>`).join('');
  return `<div class="paso-title">Paso 3 · Cargar proforma — ${escapeHtml(c.nombre)}</div>
  <div class="paso-desc">Uno o varios .xlsx del contratista, cada uno con su formato. El encabezado y la columna de remisión
  se auto-detectan con los alias de la configuración; las hojas se enrutan por los patrones del contratista. Si una hoja
  no se reconoce, la señalas tú (y puedes guardar la regla).</div>
  ${alertaSosp}
  <div class="card">
    <label class="filebox"><input type="file" multiple accept=".xlsx,.xlsm,.xls" onchange="Paso3.cargar(this)">
      <div class="fb-title">Agregar archivo(s) de proforma</div><div class="fb-sub">se concilia automáticamente al cargar</div></label>
    <div class="flexrow" style="margin-top:10px">
      <button class="btn sec mini" onclick="Paso3.reemplazarClick()">♻️ Reemplazar proforma (versión 2)</button>
      <span class="note">borra lo NO decidido manualmente y re-concilia; las decisiones se conservan si el número sigue reclamado</span>
    </div>
  </div>
  ${lista||'<div class="note">Aún no hay archivos de proforma cargados.</div>'}
  <div class="card" style="border-color:var(--warn)"><h3>📥 Sin proforma — tomar recibos de la base</h3>
    <div class="note" style="margin-bottom:10px">Cuando el contratista <b>no envió proforma</b>: la herramienta toma directamente
    de la(s) base(s) de <b>${escapeHtml((c.ambitos||[]).join(' + '))}</b> todos los recibos de <b>${escapeHtml(c.nombre)}</b>
    (identificados por empresa) con fecha dentro del rango. Van al acta como ENCONTRADAS y no necesitan PDF.
    Reemplaza lo que haya en el corte.</div>
    <div class="grid2">
      <div><label class="fld">Desde</label><input type="date" id="spIni" value="${escapeHtml(S.corte.sinProforma?S.corte.sinProforma.inicio:q.inicio)}"></div>
      <div><label class="fld">Hasta</label><input type="date" id="spFin" value="${escapeHtml(S.corte.sinProforma?S.corte.sinProforma.fin:q.fin)}"></div>
    </div>
    <div style="margin-top:10px" class="flexrow">
      <button class="btn" onclick="Paso3.sinProforma()">Tomar recibos de la base →</button>
      ${S.corte.sinProforma?`<span class="note">✅ Activo: ${S.corte.reclamos.length} recibos entre ${fmtFecha(S.corte.sinProforma.inicio)} → ${fmtFecha(S.corte.sinProforma.fin)}. Vuelve a generar para cambiar el rango.</span>`:''}
    </div></div>
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
  sinProforma(){
    const ini=$('spIni').value, fin=$('spFin').value;
    if(!ini||!fin||fin<ini){ toast('❌ Revisa las fechas (desde ≤ hasta)'); return; }
    const c=getContratista(S.corte.contratistaId);
    const basesRel=(c?c.ambitos:[]).filter(a=>S.bases[a]);
    if(!basesRel.length){ toast('❌ Primero carga la base del contratista (Paso 1)'); return; }
    const falta=(c?c.ambitos:[]).filter(a=>!S.bases[a]);
    if(S.corte.reclamos.length&&!confirm('Se reemplazarán las '+S.corte.reclamos.length+' reclamadas actuales del corte por los recibos de la base. ¿Continuar?')) return;
    const r=tomarRecibosBase(ini,fin);
    autosave(); render();
    const cc=conteoEstados();
    let msg=`✅ Sin proforma: ${r.n} recibos de la base → ${cc.ENCONTRADA} al acta`;
    if(cc.EXCLUIDA_UF3) msg+=` · ${cc.EXCLUIDA_UF3} UF3`;
    if(r.sinEmpresa) msg+=` · ${r.sinEmpresa} filas sin empresa omitidas`;
    if(falta.length) msg+=` · ⚠️ falta base ${falta.join(', ')}`;
    toast(msg,6000);
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
  cambiarAmbitoUI(pfIdx,hIdx){
    const pf=S.corte.proformas[pfIdx]; const meta=pf.hojas[hIdx];
    const cur=meta.modo==='interno'?'TERRAPLEN_INTERNO':meta.ambito;
    const op=(v,l)=>`<option value="${v}" ${cur===v?'selected':''}>${l}</option>`;
    abrirModal(`<h3>Cambiar ámbito — ${escapeHtml(meta.nombre)}</h3>
      <div class="note" style="margin-bottom:10px">Las reclamaciones de esta hoja que NO tengan decisión manual vuelven a
      PENDIENTE y se re-concilian contra la base elegida. Las decididas a mano no se tocan.</div>
      <select id="selNuevoAmb">${op('GRANULARES','GRANULARES')}${op('TERRAPLEN','TERRAPLEN')}${op('TERRAPLEN_INTERNO','TERRAPLEN (interno)')}${op('AMBAS','AMBAS')}</select>
      <div style="margin-top:10px"><label style="font-size:12px"><input type="checkbox" id="chkReglaAmb" checked> guardar regla para esta hoja en la config del contratista</label></div>
      <div class="flexrow" style="margin-top:14px">
        <button class="btn" onclick="Paso3.aplicarAmbitoDesdeModal(${pfIdx},${hIdx})">Aplicar y re-conciliar</button>
        <button class="btn sec" onclick="cerrarModal()">Cancelar</button></div>`);
  },
  aplicarAmbitoDesdeModal(pfIdx,hIdx){
    const v=$('selNuevoAmb').value;
    const guardar=$('chkReglaAmb').checked;
    cerrarModal();
    const ambito=v==='TERRAPLEN_INTERNO'?'TERRAPLEN':v;
    const modo=v==='TERRAPLEN_INTERNO'?'interno':null;
    this.aplicarAmbito(pfIdx,hIdx,ambito,modo,guardar);
  },
  aplicarAmbito(pfIdx,hIdx,ambito,modo,guardarRegla){
    const pf=S.corte.proformas[pfIdx]; const meta=pf.hojas[hIdx]; if(!pf||!meta) return;
    const de=meta.ambito+(meta.modo?' interno':'');
    meta.ambito=ambito; meta.modo=modo||null;
    if(guardarRegla){
      const c=getContratista(S.corte.contratistaId);
      const pat='^'+normTexto(meta.nombre).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
      c.hojas=c.hojas.filter(h=>h.patron!==pat);
      c.hojas.unshift(Object.assign({patron:pat,ambito},modo?{modo:'interno'}:{}));
      guardarConfig();
    }
    let n=0;
    for(const rc of S.corte.reclamos){
      if(rc.archivo!==pf.archivo||rc.hoja!==meta.nombre) continue;
      if(rc.decisionManual||!rc.remision) continue;
      rc.ambito=ambito; rc.modo=modo||null;
      resetReclamo(rc,'ámbito de hoja cambiado: '+de+' → '+ambito+(modo?' interno':''));
      n++;
    }
    conciliarPendientes();
    autosave(); render();
    const cnt=conteoEstados();
    toast('✅ Hoja "'+meta.nombre+'" → '+ambito+(modo?' (interno)':'')+': '+n+' reclamaciones re-conciliadas · '+cnt.ENCONTRADA+' encontradas · '+cnt.NO_ENCONTRADA+' no encontradas');
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
  const sosp=hojasSospechosas();
  const alertaSosp=sosp.map(s=>`<div class="alert warn">⚠️ La hoja <b>${escapeHtml(s.hoja)}</b> parece de <b>${s.otro}</b>
    (${s.hallados}/${s.noEnc} no-encontradas existen allá con tu contratista).
    <button class="btn mini" onclick="Paso3.aplicarAmbito(${s.pfIdx},${s.hIdx},'${s.otro}',null,true)">Cambiar a ${s.otro} y re-conciliar</button></div>`).join('');
  return `<div class="paso-title">Paso 4 · Conciliación</div>
  <div class="paso-desc">Automática al cargar. Haz clic en un estado para filtrar; clic en una fila para ver el detalle y decidir.
  Las remisiones de áreas PLANTA/PUENTE/TM1/ODT… van al acta normalmente con la observación “área X” (solo excluyen UF3 y asfalto).</div>
  ${basesOk?'':'<div class="alert err">⚠️ Faltan bases por cargar: hay reclamaciones sin conciliar. Ve al Paso 1.</div>'}
  ${alertaSosp}
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
      <td><span class="chip ${rc.estado}">${ETIQUETA[rc.estado]}</span>${rc.subtipo?' <span class="marca">'+escapeHtml(rc.subtipo)+'</span>':''}</td>
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

function cardCandidato(cd,idx,rcId,esSugerencia,src){
  const btn=esSugerencia?'' :`<div style="margin-top:8px"><button class="btn mini ok" onclick="Acciones.usarCandidato('${rcId}',${idx},'${src||'candidatos'}')">Usar este candidato</button></div>`;
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
    if(rc.sugerenciasOtraBase&&rc.sugerenciasOtraBase.length){
      cuerpo+=`<h4 style="font-size:12px;color:#ffb84d;margin:10px 0 6px">⚠️ EXISTE EN LA OTRA BASE (${rc.sugerenciasOtraBase[0].ambito}) CON TU CONTRATISTA — ¿hoja mal clasificada? Puedes usarlo, o cambiar el ámbito de toda la hoja en el Paso 3</h4>
        <div class="cand-grid">${rc.sugerenciasOtraBase.map((cd,i)=>cardCandidato(cd,i,rc.id,false,'sugerenciasOtraBase')).join('')}</div>`;
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
  usarCandidato(id,idx,srcArr){
    const rc=this._rc(id); if(!rc) return;
    const cd=(rc[srcArr||'candidatos']||[])[idx]; if(!cd) return;
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

// Orden de menor a mayor por el número de la remisión (0348 < 986 < CH6199 por su parte
// numérica; las que no tienen dígitos van al final, alfabéticas) para llevar el control.
function cmpRemision(a,b){
  const na=parseInt((String(a).match(/\d+/)||[''])[0],10), nb=parseInt((String(b).match(/\d+/)||[''])[0],10);
  if(!isNaN(na)&&!isNaN(nb)&&na!==nb) return na-nb;
  if(!isNaN(na)&&isNaN(nb)) return -1;
  if(isNaN(na)&&!isNaN(nb)) return 1;
  return String(a)<String(b)?-1:String(a)>String(b)?1:0;
}
function faltantes(){
  return S.corte
    ?S.corte.reclamos.filter(r=>r.estado==='NO_ENCONTRADA'&&r.remision).sort((x,y)=>cmpRemision(x.remision,y.remision))
    :[];
}

/* ---- Ámbito de los PDFs de partes (jul-2026): búsqueda exclusiva por base ----
   Cada PDF se marca según qué partes trae: GRANULARES, TERRAPLEN o AMBAS (mezclado).
   El cruce OCR solo empareja cada página con faltantes COMPATIBLES con el ámbito del
   PDF: un parecido a 1 dígito con un número de la OTRA base ya no genera candidato ni
   vuelve la página "candidata". AMBAS = comportamiento anterior (se cruza con todo).
   El ámbito se SUGIERE por el nombre del archivo con las mismas reglas de hojas del
   contratista, pero César lo confirma (marca "auto" hasta que lo toque). PDFs de
   sesiones viejas sin dato = AMBAS. */
function ambitoPdfDe(p){ return (p&&p.ambito)||'AMBAS'; }
function ambitoPdfPorNombre(name){ return ambitoPdfDe(S.pdfs.find(x=>x.name===name)); }
function ambitoCompatible(pdfAmb,rcAmb){
  if(!pdfAmb||pdfAmb==='AMBAS') return true;
  if(!rcAmb||rcAmb==='AMBAS') return true;
  return pdfAmb===rcAmb;
}
function etiquetaAmbito(a){ return a==='GRANULARES'?'Granulares':a==='TERRAPLEN'?'Terraplén':'Mezclado (ambas)'; }
function sugerirAmbitoPdf(nombre){
  const c=S.corte?getContratista(S.corte.contratistaId):null;
  const r=c?resolverAmbitoHoja(nombre,c):null;
  return (r&&(r.ambito==='GRANULARES'||r.ambito==='TERRAPLEN'))?r.ambito:'AMBAS';
}

// Vista INVERSA del OCR: clasifica cada página de cada PDF cargado.
//   evidencia        → ya confirmada como comprobante de alguna remisión
//   candidata        → algún token coincide (exacto o a 1 dígito) con una faltante actual
//   descartada       → César la revisó a mano y decidió que NO es ninguna faltante (reproceso:
//                      seguramente ya está digitada en la base) → sale de la lista de revisión.
//                      Si más adelante un token coincide con una faltante NUEVA, vuelve como
//                      candidata (la categoría candidata gana sobre la descartada).
//   reconocida       → el número leído es de una remisión reclamada ya conciliada (normal)
//   sin_coincidencia → leyó números pero ninguno corresponde a nada reclamado → REVISAR
//   sin_lectura      → el OCR no pudo leer ningún número en la página → REVISAR
//   sin_procesar     → aún no se le ha corrido OCR
function clasificarPaginas(){
  const claims=S.corte?S.corte.reclamos.filter(r=>r.remision):[];
  const evid=new Set();
  if(S.corte) for(const rc of S.corte.reclamos) if(rc.evidencia) evid.add(rc.evidencia.archivo+'#'+rc.evidencia.pagina);
  // Sets por ámbito de PDF: las páginas de un PDF de TERRAPLEN solo se comparan con
  // reclamos/faltantes de terraplén (o de hojas AMBAS); ídem GRANULARES.
  const porAmbito={};
  const setsPara=(amb)=>{
    if(porAmbito[amb]) return porAmbito[amb];
    const o={faltSet:new Set(),faltSC:new Set(),allSet:new Set(),allSC:new Set()};
    for(const rc of claims){
      if(!ambitoCompatible(amb,rc.ambito)) continue;
      o.allSet.add(rc.remision); o.allSC.add(rc.remSC);
      if(rc.estado==='NO_ENCONTRADA'){ o.faltSet.add(rc.remision); o.faltSC.add(rc.remSC); }
    }
    return porAmbito[amb]=o;
  };
  const coincide=(t,set,setSC)=>set.has(t)||setSC.has(sinCeros(t))||set.has(sinCeros(t));
  const paginas=[]; const counts={evidencia:0,candidata:0,descartada:0,reconocida:0,sin_coincidencia:0,sin_lectura:0,sin_procesar:0};
  for(let fi=0;fi<S.pdfs.length;fi++){
    const p=S.pdfs[fi]; if(p.error) continue;
    const sets=setsPara(ambitoPdfDe(p));
    const esFalt=t=>{ if(coincide(t,sets.faltSet,sets.faltSC)) return true; for(const f of sets.faltSet) if(dist1(t,f)<=1) return true; return false; };
    for(let pg=1;pg<=p.numPages;pg++){
      const key=p.name+'#'+pg;
      let cat,toks=[];
      if(evid.has(key)) cat='evidencia';
      else if(!(key in S.ocr.paginas)) cat='sin_procesar';
      else{
        toks=S.ocr.paginas[key]||[];
        if(toks.some(esFalt)) cat='candidata';
        else if(S.ocr.revisadas[key]) cat='descartada';
        else if(toks.some(t=>coincide(t,sets.allSet,sets.allSC))) cat='reconocida';
        else if(toks.length) cat='sin_coincidencia';
        else cat='sin_lectura';
      }
      counts[cat]++;
      paginas.push({fi,pg,archivo:p.name,cat,toks});
    }
  }
  return {paginas,counts};
}

function vistaPaso5(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 5 · Investigación PDF</div><div class="alert warn">Carga y concilia una proforma primero.</div>`;
  const falt=faltantes();
  const archivos=S.pdfs.map((p,i)=>`<tr><td>${p.kind==='pdf'?'📕':'🖼️'} ${escapeHtml(p.name)}</td>
    <td>${p.error?'<span style="color:var(--error)">'+escapeHtml(p.error)+'</span>':p.numPages+' pág.'}</td>
    <td>${p.error?'':`<select style="width:auto;padding:4px 8px;font-size:11px" title="Qué partes trae este archivo: sus páginas solo se cruzan con las faltantes de esa base"
      onchange="Paso5.setAmbito(${i},this.value)">
      ${['AMBAS','GRANULARES','TERRAPLEN'].map(a=>`<option value="${a}" ${ambitoPdfDe(p)===a?'selected':''}>${etiquetaAmbito(a)}</option>`).join('')}
    </select>${p.ambitoAuto?' <span class="note" style="font-size:10px" title="sugerido por el nombre del archivo — confírmalo">auto</span>':''}`}</td>
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
    ${S.pdfs.length?`<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><tr><th>Archivo</th><th>Páginas</th><th>Partes de…</th><th></th></tr>${archivos}</table></div>
    <div class="note" style="margin-top:6px"><b>Partes de…</b>: si el archivo trae solo partes de una base (p. ej. solo terraplén), márcalo y sus páginas
    se cruzan ÚNICAMENTE con las faltantes de esa base — un número parecido de la otra base ya no sale como candidato.
    “Mezclado (ambas)” busca contra todas (comportamiento de siempre). El sistema lo sugiere por el nombre del archivo (marca <i>auto</i>); confírmalo tú.</div>`:''}
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
    un dígito de diferencia = <span class="badge naranja">naranja</span>. Las páginas ya procesadas quedan en caché y se
    re-cruzan solas si cambian las faltantes; vuelve a pulsar “Buscar” solo si agregaste PDFs nuevos.</div>`}
  </div>
  ${cardPaginasRevisar()}
  <div class="p5-layout">
    <div><h3 style="font-size:13px;color:var(--accent);margin-bottom:8px">Faltantes (${falt.length})</h3>${lista||'<div class="note">Ninguna 🎉</div>'}</div>
    <div id="p5derecha"><div class="note">Selecciona una faltante a la izquierda, o usa “Hojear” sobre un archivo.</div></div>
  </div>`;
}

function cardPaginasRevisar(){
  if(!S.pdfs.length||!Object.keys(S.ocr.paginas).length) return '';
  const {counts}=clasificarPaginas();
  const nRev=counts.sin_lectura+counts.sin_coincidencia;
  return `<div class="card"><h3>🧐 Cobertura del OCR por página</h3>
    <div class="kv">
      <span>✅ Confirmadas como comprobante: <b>${counts.evidencia}</b></span>
      <span>🟢 Con candidato para faltante: <b>${counts.candidata}</b></span>
      <span>Número de remisión ya conciliada: <b>${counts.reconocida}</b></span>
      <span style="color:${counts.sin_coincidencia?'#ffb84d':'inherit'}">⚠️ Leídas SIN coincidencia con nada reclamado: <b>${counts.sin_coincidencia}</b></span>
      <span style="color:${counts.sin_lectura?'var(--error)':'inherit'}">❌ Sin lectura (OCR no leyó ningún número): <b>${counts.sin_lectura}</b></span>
      ${counts.descartada?`<span>🚫 Descartadas a mano (no eran faltantes): <b>${counts.descartada}</b></span>`:''}
      ${counts.sin_procesar?`<span>⏳ Sin procesar (pulsa Buscar): <b>${counts.sin_procesar}</b></span>`:''}
    </div>
    ${nRev?`<div class="flexrow" style="margin-top:10px">
      <button class="btn mini" onclick="Paso5.revisarSiguiente()">▶ Revisar las ${nRev} contra las faltantes</button>
      <button class="btn sec mini" onclick="Paso5.toggleRevisar()">${S.ui.verRevisar?'Ocultar':'Ver'} miniaturas</button>
      <span class="note">va parte por parte: ves la página, clic en la faltante que coincida, o "No es ninguna faltante" para sacarla de la lista (lo demás es reproceso — remisiones que ya están en la base). El ✏️ sigue disponible si prefieres corregir la lectura.</span></div>
      ${S.ui.verRevisar?'<div class="thumbs" id="revGrid" style="margin-top:10px"></div>':''}`
      :'<div class="note" style="margin-top:8px">Todas las páginas quedaron cruzadas: no hay partes sin reconocer.</div>'}
    ${counts.descartada?`<div class="flexrow" style="margin-top:8px">
      <button class="btn sec mini" onclick="Paso5.toggleDescartadas()">${S.ui.verDescartadas?'Ocultar':'Ver'} las ${counts.descartada} descartadas</button>
      <span class="note">¿descartaste una por error? ↩ la devuelve a la lista de revisión</span></div>
      ${S.ui.verDescartadas?'<div class="thumbs" id="descGrid" style="margin-top:10px"></div>':''}`:''}
  </div>`;
}

const Paso5={
  _thumbCancel:false,
  // Las páginas ya OCR-eadas quedan en caché; si después cambian las faltantes (nueva
  // proforma, cambio de ámbito de hoja, re-conciliación), se re-cruzan sin repetir OCR.
  recruzar(){
    this._podarCandidatos();
    const falt=faltantes(); if(!falt.length) return;
    for(const key of Object.keys(S.ocr.paginas)){
      const i=key.lastIndexOf('#'); if(i<0) continue;
      const name=key.slice(0,i), pg=+key.slice(i+1);
      const fi=S.pdfs.findIndex(p=>p.name===name);
      this._cruzar(name,pg,fi,S.ocr.paginas[key]||[],falt);
    }
  },
  // Retira candidatos que quedaron incompatibles tras marcar/cambiar el ámbito de un PDF
  // (los comprobantes ya CONFIRMADOS no se tocan: eso es evidencia decidida por César).
  // PDF no re-cargado tras importar sesión → ámbito desconocido → se conserva.
  _podarCandidatos(){
    if(!S.corte) return;
    for(const rem of Object.keys(S.ocr.candidatos)){
      const rc=S.corte.reclamos.find(r=>r.remision===rem);
      if(!rc||!rc.ambito||rc.ambito==='AMBAS') continue;
      S.ocr.candidatos[rem]=S.ocr.candidatos[rem].filter(c=>ambitoCompatible(ambitoPdfPorNombre(c.file),rc.ambito));
    }
  },
  setAmbito(idx,val){
    const p=S.pdfs[idx]; if(!p) return;
    p.ambito=val; p.ambitoAuto=false;
    autosave(); render();   // render en Paso 5 → recruzar(): poda y re-cruza con el nuevo ámbito
    toast('Ámbito de '+p.name+' → '+etiquetaAmbito(val)+'. Cruces actualizados.');
  },
  postRender(){
    if(S.ui.faltanteSel) this._renderCandidatos(S.ui.faltanteSel);
    if(S.ui.verRevisar) this._renderRevisar();
    if(S.ui.verDescartadas) this._renderDescartadas();
  },
  toggleRevisar(){ S.ui.verRevisar=!S.ui.verRevisar; render(); },
  toggleDescartadas(){ S.ui.verDescartadas=!S.ui.verDescartadas; render(); },

  // ---- revisión guiada de páginas sin cruzar (una por una contra las faltantes) ----
  _porRevisar(){
    const {paginas}=clasificarPaginas();
    return paginas.filter(x=>x.cat==='sin_lectura'||x.cat==='sin_coincidencia')
      .sort((a,b)=>a.fi-b.fi||a.pg-b.pg);
  },
  revisarSiguiente(){
    const rev=this._porRevisar();
    if(!rev.length){ toast('🎉 No quedan páginas por revisar.'); return; }
    this.revisar(rev[0].fi,rev[0].pg);
  },
  // Modal: la página en grande + la lista de faltantes sin confirmar. Un clic en la
  // faltante = confirmar comprobante; "No es ninguna" = descartar la página (reproceso).
  async revisar(fileIdx,pg){
    const p=S.pdfs[fileIdx]; if(!p) return;
    const key=p.name+'#'+pg;
    const toks=S.ocr.paginas[key]||[];
    const amb=ambitoPdfDe(p);
    const faltTodas=faltantes();
    const falt=faltTodas.filter(rc=>ambitoCompatible(amb,rc.ambito));
    const otras=faltTodas.filter(rc=>!ambitoCompatible(amb,rc.ambito));
    const rev=this._porRevisar();
    const idx=rev.findIndex(x=>x.fi===fileIdx&&x.pg===pg);
    const chip=rc=>{
      const cerca=toks.some(t=>dist1(t,rc.remision)<=1||sinCeros(t)===rc.remSC);
      return `<button class="btn mini ${cerca?'':'sec'} mono" title="confirmar esta página como comprobante de ${escapeHtml(rc.remision)}"
        onclick="Paso5.asignarFaltante('${rc.id}',${fileIdx},${pg})">${escapeHtml(rc.remision)}${cerca?' ≈':''}</button>`;
    };
    const chips=falt.map(chip).join(' ');
    // faltantes de la otra base: ocultas por el ámbito del PDF, pero a un clic por si el ámbito está mal
    const chipsOtras=otras.length?`<details style="margin-bottom:8px"><summary class="note" style="cursor:pointer">${otras.length} faltante${otras.length===1?'':'s'} de la otra base oculta${otras.length===1?'':'s'} (este PDF está marcado “${etiquetaAmbito(amb)}”)</summary>
      <div class="flexrow" style="margin-top:6px">${otras.map(chip).join(' ')}</div></details>`:'';
    abrirModal(`<h3>🧐 Revisar parte — ${escapeHtml(p.name)} · página ${pg}</h3>
      <div class="kv" style="margin:6px 0 8px">
        <span>${toks.length?'OCR leyó: <b class="mono">'+escapeHtml(toks.join(', '))+'</b>':'OCR sin lectura'}${S.ocr.editadas[key]?' ✏️ (corregida a mano)':''}</span>
        <span>${idx>=0?(idx+1)+' de '+rev.length+' por revisar':'ya resuelta'}</span>
        ${idx>0?`<button class="btn sec mini" onclick="Paso5.revisar(${rev[idx-1].fi},${rev[idx-1].pg})">‹ anterior</button>`:''}
        ${idx>=0&&idx<rev.length-1?`<button class="btn sec mini" onclick="Paso5.revisar(${rev[idx+1].fi},${rev[idx+1].pg})">siguiente ›</button>`:''}
      </div>
      <div class="note" style="margin-bottom:6px">¿El número de este parte es alguna de las FALTANTES (${falt.length})? Clic en ella y queda confirmada
      (≈ = a un dígito de lo leído). Si no es ninguna, descártala: es reproceso (una remisión que ya está en la base).</div>
      <div class="flexrow" style="margin-bottom:8px">${chips||'<span class="note">no quedan faltantes '+(otras.length?'de este ámbito ':'')+'por confirmar 🎉</span>'}</div>
      ${chipsOtras}
      <div class="flexrow" style="margin-bottom:10px">
        <button class="btn mini danger" onclick="Paso5.noCoincide(${fileIdx},${pg})">✕ No es ninguna faltante — quitar de la lista</button>
        <button class="btn sec mini" onclick="Paso5.editarLectura(${fileIdx},${pg})">✏️ Corregir lectura OCR</button>
        <span class="right"></span>
        <button class="btn sec mini" onclick="cerrarModal()">Cerrar</button>
      </div>
      <div class="pagina-view" id="pgRevisar"><div class="note">renderizando página…</div></div>`);
    try{
      const c=await this.renderPagina(fileIdx,pg,1.6);
      const cont=$('pgRevisar'); if(cont&&c){ cont.innerHTML=''; cont.appendChild(c); }
    }catch(e){ const cont=$('pgRevisar'); if(cont) cont.textContent='no se pudo renderizar: '+e.message; }
  },
  asignarFaltante(rcId,fileIdx,pg){
    const rc=S.corte.reclamos.find(r=>r.id===rcId); if(!rc) return;
    const p=S.pdfs[fileIdx]; if(!p) return;
    rc.evidencia={archivo:p.name,pagina:pg};
    setEstado(rc,'PENDIENTE_DIGITACION','comprobante confirmado en '+p.name+' p.'+pg+' (revisión de páginas)',false);
    toast('✅ '+rc.remision+' → Pendiente digitación');
    this._despuesDeRevisar(fileIdx,pg);
  },
  noCoincide(fileIdx,pg){
    const p=S.pdfs[fileIdx]; if(!p) return;
    S.ocr.revisadas[p.name+'#'+pg]=nowISO();
    this._despuesDeRevisar(fileIdx,pg);
  },
  _despuesDeRevisar(fileIdx,pg){
    autosave();
    const rev=this._porRevisar();   // ya sin la página recién resuelta
    const sig=rev.find(x=>x.fi>fileIdx||(x.fi===fileIdx&&x.pg>pg))||rev[0];
    cerrarModal(); render();
    if(sig) this.revisar(sig.fi,sig.pg);
    else toast('🎉 No quedan páginas por revisar.');
  },
  restaurar(fileIdx,pg){
    const p=S.pdfs[fileIdx]; if(!p) return;
    delete S.ocr.revisadas[p.name+'#'+pg];
    autosave(); render();
  },
  async _renderDescartadas(){
    const grid=$('descGrid'); if(!grid) return;
    const {paginas}=clasificarPaginas();
    const desc=paginas.filter(x=>x.cat==='descartada');
    for(const x of desc){
      if(!document.body.contains(grid)) break;
      const d=document.createElement('div'); d.className='thumb';
      d.innerHTML=`<div class="tlab">${escapeHtml(x.archivo)} p.${x.pg} · descartada</div>
        <button class="btn mini sec" style="position:absolute;top:2px;right:2px" title="devolver a la lista de revisión">↩</button>`;
      d.title=x.archivo+' página '+x.pg+' — descartada a mano; clic para verla';
      d.onclick=()=>Paso5.verGrande(x.fi,x.pg);
      d.querySelector('button').onclick=(e)=>{ e.stopPropagation(); Paso5.restaurar(x.fi,x.pg); };
      grid.appendChild(d);
      try{
        const c=await this.renderPagina(x.fi,x.pg,0.3);
        if(c) d.insertBefore(c,d.firstChild);
      }catch(_){}
    }
  },
  // Corregir a mano lo que el OCR leyó en una página. La lectura corregida REEMPLAZA
  // a la del OCR para todos los cruces (candidatos, cobertura, resumen).
  async editarLectura(fileIdx,pg){
    const p=S.pdfs[fileIdx]; if(!p) return;
    const key=p.name+'#'+pg;
    const toks=S.ocr.paginas[key]||[];
    abrirModal(`<h3>✏️ Corregir lectura — ${escapeHtml(p.name)} · página ${pg}</h3>
      <div class="note" style="margin-bottom:8px">Escribe el/los números de remisión que se ven en la página, separados por coma o espacio
      (una página puede tener 1–3 partes). Si el número corregido resulta ser una faltante, aparecerá como candidato para que lo confirmes;
      si es de una remisión ya conciliada, la página se descarta de la lista de revisión.</div>
      <input type="text" id="lecturaEdit" class="mono" value="${escapeHtml(toks.join(', '))}" placeholder="ej: 23009, 23014">
      <div class="flexrow" style="margin-top:10px">
        <button class="btn" onclick="Paso5.guardarLectura(${fileIdx},${pg})">Guardar y re-cruzar</button>
        <button class="btn sec" onclick="cerrarModal()">Cancelar</button>
        ${S.ocr.editadas[key]?'<span class="note">esta lectura ya fue corregida a mano antes</span>':''}
      </div>
      <div class="pagina-view" id="pgEdit" style="margin-top:12px"><div class="note">renderizando página…</div></div>`);
    const inp=$('lecturaEdit'); if(inp){ inp.focus(); inp.onkeydown=e=>{ if(e.key==='Enter') Paso5.guardarLectura(fileIdx,pg); }; }
    try{
      const c=await this.renderPagina(fileIdx,pg,1.4);
      const cont=$('pgEdit'); if(cont&&c){ cont.innerHTML=''; cont.appendChild(c); }
    }catch(e){ const cont=$('pgEdit'); if(cont) cont.textContent='no se pudo renderizar: '+e.message; }
  },
  guardarLectura(fileIdx,pg){
    const p=S.pdfs[fileIdx]; if(!p) return;
    const key=p.name+'#'+pg;
    const raw=($('lecturaEdit')&&$('lecturaEdit').value)||'';
    const toks=extraerTokens(raw).map(normRem);
    S.ocr.paginas[key]=toks;
    S.ocr.editadas[key]=true;
    delete S.ocr.revisadas[key];   // corregir la lectura re-abre la página aunque estuviera descartada
    // limpiar candidatos viejos de esta página (venían de la lectura errada) y re-cruzar
    for(const rem of Object.keys(S.ocr.candidatos))
      S.ocr.candidatos[rem]=S.ocr.candidatos[rem].filter(c=>c.key!==key);
    this.recruzar();
    // ¿en qué quedó la página?
    const falt=faltantes();
    const hitFalt=falt.filter(rc=>toks.some(t=>t===rc.remision||sinCeros(t)===rc.remSC));
    let msg;
    if(hitFalt.length){ msg='🟢 ¡'+hitFalt.map(r=>r.remision).join(', ')+' es faltante! Revisa sus candidatos y confirma el comprobante.'; }
    else{
      const claims=S.corte?S.corte.reclamos.filter(r=>r.remision):[];
      const hitClaim=toks.some(t=>claims.some(r=>t===r.remision||sinCeros(t)===r.remSC));
      msg=hitClaim?'✅ Coincide con una remisión ya conciliada: la página sale de la lista de revisión.'
        :(toks.length?'⚠️ Sigue sin coincidir con nada reclamado (quedó registrada la lectura corregida).':'❌ Sin números: la página queda como "sin lectura".');
    }
    autosave(); cerrarModal(); render();
    toast(msg,6000);
  },
  async _renderRevisar(){
    const grid=$('revGrid'); if(!grid) return;
    const {paginas}=clasificarPaginas();
    const rev=paginas.filter(x=>x.cat==='sin_lectura'||x.cat==='sin_coincidencia');
    rev.sort((a,b)=>a.cat==='sin_lectura'&&b.cat!=='sin_lectura'?-1:b.cat==='sin_lectura'&&a.cat!=='sin_lectura'?1:0);
    for(const x of rev){
      if(!document.body.contains(grid)) break;
      const d=document.createElement('div'); d.className='thumb';
      const editada=S.ocr.editadas[x.archivo+'#'+x.pg];
      const lab=(x.cat==='sin_lectura'?'sin lectura':'leyó: '+x.toks.slice(0,3).join(', ')+(x.toks.length>3?'…':''))+(editada?' ✏️':'');
      d.innerHTML=`<div class="tlab" style="color:${x.cat==='sin_lectura'?'var(--error)':'#ffb84d'}">${escapeHtml(x.archivo)} p.${x.pg} · ${escapeHtml(lab)}</div>
        <button class="btn mini sec" style="position:absolute;top:2px;right:2px" title="corregir la lectura del OCR">✏️</button>`;
      d.title=x.archivo+' página '+x.pg+' — clic para revisarla contra las faltantes';
      d.onclick=()=>Paso5.revisar(x.fi,x.pg);
      d.querySelector('button').onclick=(e)=>{ e.stopPropagation(); Paso5.editarLectura(x.fi,x.pg); };
      grid.appendChild(d);
      try{
        const c=await this.renderPagina(x.fi,x.pg,0.3);
        if(c) d.insertBefore(c,d.firstChild);
      }catch(_){}
    }
  },
  cargar(input){
    const files=Array.from(input.files||[]); if(!files.length) return;
    (async()=>{
      for(const f of files){
        const bytes=new Uint8Array(await f.arrayBuffer());
        const esImg=/\.(jpe?g|png)$/i.test(f.name);
        // ámbito: el guardado en la sesión importada gana; si no, se sugiere por el nombre
        const meta=((S._esperado&&S._esperado.pdfs)||[]).find(m=>m.name===f.name);
        const entry={name:f.name,kind:esImg?'img':'pdf',bytes,numPages:1,doc:null,error:null,
          ambito:(meta&&meta.ambito)||sugerirAmbitoPdf(f.name),
          ambitoAuto:(meta&&meta.ambito)?!!meta.ambitoAuto:true};
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
      for(let fi=0;fi<S.pdfs.length;fi++){
        const p=S.pdfs[fi]; if(p.error) continue;
        // corte temprano de la pasada A: solo cuentan las faltantes compatibles con el ámbito del PDF
        const faltPdf=falt.filter(rc=>ambitoCompatible(ambitoPdfDe(p),rc.ambito));
        const faltSet=new Set(); const faltSC=new Set();
        for(const rc of faltPdf){ faltSet.add(rc.remision); faltSC.add(rc.remSC); }
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
    // exclusividad por ámbito: un PDF marcado TERRAPLEN no ofrece candidatos de granulares
    const amb=ambitoPdfPorNombre(fileName);
    for(const tk of tokens){
      for(const rc of falt){
        if(!ambitoCompatible(amb,rc.ambito)) continue;
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
    const porRevisar=this._porRevisar().some(x=>x.fi===fileIdx&&x.pg===page);
    abrirModal(`<h3>${escapeHtml(p.name)} · página ${page}</h3>
      <div class="flexrow" style="margin-bottom:8px">
        ${rc?`<button class="btn mini ok" onclick="Paso5.confirmar('${rc.id}',${fileIdx},${page})">✔ Confirmar para ${escapeHtml(rc.remision)}</button>
        <button class="btn mini sec" onclick="Paso5.esAsfalto('${rc.id}',${fileIdx},${page})">Es ASFALTO</button>`:'<span class="note">Selecciona una faltante en el Paso 5 para poder asignar esta página.</span>'}
        ${porRevisar?`<button class="btn mini" onclick="Paso5.revisar(${fileIdx},${page})">🧐 Revisar contra faltantes</button>`:''}
        <button class="btn sec mini" onclick="Paso5.editarLectura(${fileIdx},${page})">✏️ Corregir lectura OCR</button>
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

function obsReclamo(rc,comp){
  const o=[];
  if(rc.sinProforma) o.push('sin proforma (recibo de base)');
  if(rc.marcas.indexOf('AREA_OBSERVADA')>=0&&rc.subtipo) o.push('área '+rc.subtipo);
  if(rc.marcas.indexOf('REZAGO')>=0&&rc.candidato&&rc.candidato.fecha) o.push('rezago '+fmtRezago(rc.candidato.fecha));
  if(rc.estado==='ACEPTADA_MANUAL') o.push('resuelta manual');
  if(rc.notaReconciliacion) o.push('resuelta en re-conciliación');
  if(rc.marcas.indexOf('CELDA_MULTIPLE')>=0) o.push('de celda múltiple');
  if(rc.marcas.indexOf('MATCH_SIN_CEROS')>=0) o.push('match sin ceros confirmado');
  if(comp) o.push('completada con proforma ('+Object.keys(comp).map(k=>LBL_CAMPO[k]||k).join(', ')+')');
  return o.join(' · ');
}

// Pendientes de digitación en orden de trabajo: fecha de la proforma de menor a mayor
// y, dentro del mismo día, remisión de menor a mayor (sin fecha → al final). El Excel
// de la digitadora y el PDF de comprobantes usan ESTE mismo orden, renglón a página.
function pendientesOrdenadas(){
  return S.corte.reclamos.filter(r=>r.estado==='PENDIENTE_DIGITACION').sort((a,b)=>{
    const fa=(a.secundarios&&a.secundarios.fecha)||'9999-99-99', fb=(b.secundarios&&b.secundarios.fecha)||'9999-99-99';
    if(fa!==fb) return fa<fb?-1:1;
    return cmpRemision(a.remision||'',b.remision||'');
  });
}

/* ---- Bloque acta de PENDIENTES (modelo A..S con lo que la proforma sabe) ----
   Los pendientes de digitación no están en la base, así que el sistema llena lo que
   conoce (fecha, remisión, placa, cantidad) y PROPONE área/CC para que César confirme
   o corrija en el Paso 7 antes de copiar (nunca se exporta sin que él lo vea). */

const CC_AREA_AJENA='3701.11.03';   // CC fijo de todo lo que no es nuestro y no se excluye (puente, planta, TM1…)

// PK del texto libre de la proforma: "PK 25+300", "pk34", "K12", "34+500".
// PK (km entero) del texto, derivado de pkMetros para no divergir nunca del abscisado.
function pkDeTexto(t){ const mm=pkMetros(t); return mm==null?null:Math.floor(mm/1000); }

// Número de la PROFORMA (cantidad/km/m3km): llegan como texto formateado y el punto suele
// ser DECIMAL ("18.8" del formato del Excel), al revés de parseNum (es-CO, punto = miles).
// Estas magnitudes no llevan miles, así que: coma final decimal ("18,8" / "1.234,5"),
// y si solo hay punto se toma como decimal.
function numProforma(v){
  if(v==null||v==='') return null;
  if(typeof v==='number') return isFinite(v)?v:null;
  let s=String(v).trim().replace(/\s/g,'');
  if(/,\d+$/.test(s)&&s.indexOf('.')>=0) s=s.replace(/\./g,'').replace(',','.');
  else if(s.indexOf(',')>=0&&s.indexOf('.')<0) s=s.replace(',','.');
  const n=parseFloat(s); return isFinite(n)?n:null;
}

// Abscisa en METROS desde texto libre: "PK 25+300"→25300, "33800"→33800, "33"→33000.
// Abscisa en METROS desde cualquier formato de proforma:
//   "PK 25+300" / "PR 16+500" / "9+040" → km + offset (metros literales)
//   "10.25" / "26,1" / "37.6"           → km CON DECIMALES → ×1000 (10250, 26100, 37600)
//   "16" / "70"                          → km entero (<100) → ×1000
//   "33800" / "16300"                    → ya en metros (≥100)
function pkMetros(t){
  if(t==null||t==='') return null;
  if(typeof t==='number') return t>=100?Math.round(t):Math.round(t*1000);
  const s=String(t).trim();
  let m=s.match(/(\d{1,3})\s*\+\s*(\d{1,3})/);              // km + offset explícito
  if(m) return parseInt(m[1],10)*1000+parseInt(m[2],10);
  m=s.match(/(\d{1,3})[.,](\d{1,3})(?!\d)/);               // km con decimales (0,25 km = 250 m)
  if(m) return Math.round(parseFloat(m[1]+'.'+m[2])*1000);
  m=s.match(/(\d{1,6})/);                                   // entero suelto: km (<100) o metros (≥100)
  if(m){ const n=parseInt(m[1],10); return n>=100?n:n*1000; }
  return null;
}

// Kilómetros totales (col. M) del pendiente, reglas de César verificadas contra la base:
//  · origen con regla (config.kmPorOrigen): Putana = PK destino/1000 + 2.5; Avensa 25.7;
//    Pekin 67.5 (siempre van al PK33)
//  · sin regla: |PK destino − PK origen| / 1000 (abscisas normales, en metros)
//  · sin datos suficientes → null (César lo pone)
function kmTotalesPendiente(rc){
  const s=rc.secundarios||{};
  const origenTxt=normTexto([s.origen,rc.hoja].filter(Boolean).join(' '));
  for(const rg of (S.config.kmPorOrigen||[])){
    try{
      if(new RegExp(rg.patron,'i').test(origenTxt)){
        if(rg.fijo!=null) return rg.fijo;
        if(rg.masKm!=null){ const fin=pkMetros(s.destino); return fin==null?null:+(fin/1000+rg.masKm).toFixed(1); }
      }
    }catch(_){}
  }
  const ini=pkMetros(s.origen), fin=pkMetros(s.destino);
  if(ini!=null&&fin!=null) return +(Math.abs(fin-ini)/1000).toFixed(1);
  return null;
}

// Unidad (col. R) como la escribe la base cargada (GRANULARES 'm3/km', TERRAPLEN 'm3km').
// Memo en el objeto base (`_`-key: no se serializa; se recrea al recargar la base).
function unidadDominante(tipo){
  const b=S.bases[tipo]; if(!b||!b.rows) return 'm3km';
  if(b._unidadDom) return b._unidadDom;
  const f=new Map();
  for(const r of b.rows){ const u=String(r.unidad||'').trim(); if(u) f.set(u,(f.get(u)||0)+1); }
  let best='m3km',bc=0; for(const [u,c] of f) if(c>bc){ best=u; bc=c; }
  return (b._unidadDom=best);
}

// CCs reales de la base cargada, de más a menos frecuente (se repiten y son pocos). Memo por base.
function ccCatalogo(tipo){
  if(tipo){ const b=S.bases[tipo]; if(b&&b._ccCat) return b._ccCat; }
  const freq=new Map();
  const suma=b=>{ if(b&&b.rows) for(const r of b.rows){ const cc=String(r.cc||'').trim(); if(cc) freq.set(cc,(freq.get(cc)||0)+1); } };
  if(tipo){ suma(S.bases[tipo]); } else { suma(S.bases.GRANULARES); suma(S.bases.TERRAPLEN); }
  const out=Array.from(freq.entries()).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  if(tipo&&S.bases[tipo]) S.bases[tipo]._ccCat=out;
  return out;
}

// Propuesta automática de área/CC (César la confirma o corrige en pantalla):
//  · el origen/destino/obs de la proforma menciona un área observada → área ajena, CC fijo 3701.11.03
//  · nuestra: SUFIJO por material (config.ccPorMaterial, levantado de las BASE 2026 reales:
//    granulares sub base→.03.02, BTC/base→.03.04, crudo→.02.11…; terraplén→.02.11) y
//    PREFIJO por PK del destino (≤30→3701, >30→3702). Las variaciones 06.*/07.* son de
//    ODT/ODL puntuales (raras): quedan a la corrección manual.
//  · con material pero sin PK: el CC más frecuente de la base cargada que cierre con ese
//    sufijo (recupera el prefijo típico); sin material ni PK → el más frecuente del ámbito
//  · sin señal suficiente → CC vacío (lo pone César)
function propuestaPendiente(rc){
  const s=rc.secundarios||{};
  // El origen es el sitio de CARGUE (PLANTA PUTANA, AVENSA, PEKIN…): son lugares nuestros.
  // Su texto NO debe disparar "área ajena" aunque contenga una palabra de área (p.ej. la
  // "PLANTA" de "PLANTA PUTANA" ≠ planta de hormigón). Si el origen es un cargue conocido
  // (config.kmPorOrigen) se excluye del escaneo de áreas; el área siempre está en el destino/obs.
  const origenConocido=(S.config.kmPorOrigen||[]).some(rg=>{
    try{ return new RegExp(rg.patron,'i').test(normTexto(s.origen||'')); }catch(_){ return false; }
  });
  const partesArea=[s.destino,rc.obs];
  if(!origenConocido) partesArea.push(s.origen);
  const texto=normTexto(partesArea.filter(Boolean).join(' '));
  for(const a of (S.config.areasObservadas||[])){
    const an=normTexto(a);
    if(an&&texto.indexOf(an)>=0) return {area:a,cc:CC_AREA_AJENA};
  }
  const pk=pkDeTexto(s.destino)!=null?pkDeTexto(s.destino):pkDeTexto(s.origen);
  const pref=pk==null?null:(pk<=30?'3701':'3702');
  const rg=reglaMaterialPendiente(rc);
  const suf=rg?rg.suf:null;
  if(pref&&suf) return {area:'',cc:pref+suf};
  const tipo=rc.ambito==='GRANULARES'?'GRANULARES':'TERRAPLEN';
  const cat=ccCatalogo(tipo);
  if(suf) return {area:'',cc:cat.find(c=>String(c).slice(-suf.length)===suf)||''};
  if(pref) return {area:'',cc:cat.find(c=>String(c).indexOf(pref)===0)||''};
  return {area:'',cc:tipo==='GRANULARES'?(cat[0]||''):''};
}

// Regla de material que aplica al pendiente (config.ccPorMaterial): la columna material
// de la proforma manda; solo si no existe o no matchea se busca en destino/origen/obs/hoja.
function reglaMaterialPendiente(rc){
  const s=rc.secundarios||{};
  const tipo=rc.ambito==='GRANULARES'?'GRANULARES':'TERRAPLEN';
  const reglas=((S.config.ccPorMaterial||{})[tipo]||[]);
  const buscar=t=>{ if(!t) return null;
    for(const rg of reglas){ try{ if(new RegExp(rg.patron,'i').test(t)) return rg; }catch(_){} }
    return null; };
  return buscar(normTexto(s.material||''))
    || buscar(normTexto([s.destino,s.origen,rc.obs,rc.hoja].filter(Boolean).join(' ')));
}

// Material "traducido" a como lo escribe la BASE (col. actividad): SUBBASE→Sub base,
// BTC→BTC… Sin regla o sin nombreBase (terraplén), queda el texto de la proforma.
function materialBasePendiente(rc){
  const rg=reglaMaterialPendiente(rc);
  return (rg&&rg.nombreBase)||((rc.secundarios||{}).material)||'';
}

// Área/CC efectivos: lo editado a mano (rc.actaPend, persiste en la sesión) gana a la propuesta.
function valoresActaPendiente(rc){
  const auto=propuestaPendiente(rc);
  const man=rc.actaPend||{};
  return {area:(man.area!=null)?man.area:auto.area, cc:(man.cc!=null)?man.cc:auto.cc,
    autoArea:man.area==null, autoCC:man.cc==null};
}

function pendientesConComprobante(){ return pendientesOrdenadas().filter(r=>r.evidencia); }

// Valores A..S que la app puede DERIVAR de la proforma sin la base. Fuente única para el
// bloque de pendientes Y para completar filas ENCONTRADAS que la chequeadora dejó a medias.
// kmIni: GRANULARES = texto del origen ("Planta Putana", "AVENSA"…); TERRAPLEN = abscisa en
// metros. km totales por reglas propias; km/m³·km de la proforma solo como respaldo.
function derivadosProforma(rc){
  const s=rc.secundarios||{};
  const v=valoresActaPendiente(rc);
  const tipo=rc.ambito==='GRANULARES'?'GRANULARES':'TERRAPLEN';
  const iniM=pkMetros(s.origen), finM=pkMetros(s.destino);
  const kmIni=tipo==='GRANULARES'?(s.origen||''):(iniM!=null?iniM:(s.origen||''));
  const kmFin=finM!=null?finM:'';
  let kmTot=kmTotalesPendiente(rc);
  if(kmTot==null){ const k=numProforma(s.km); if(k!=null) kmTot=k; }
  const cant=numProforma(s.cantidad);
  let m3km=(kmTot!=null&&cant!=null)?+(kmTot*cant).toFixed(3):'';
  if(m3km===''){ const q=numProforma(s.m3km); if(q!=null) m3km=q; }
  const uf=String(v.cc||'').indexOf('3701')===0?'UF1':String(v.cc||'').indexOf('3702')===0?'UF2':'';
  return {
    fecha:s.fecha?fmtFecha(s.fecha):'', uf, actividad:materialBasePendiente(rc), cc:v.cc||'',
    placa:s.placa||'', kmIni, kmFin, kmTot:kmTot!=null?kmTot:'',
    cantidad:cant!=null?cant:(s.cantidad||''), m3km, unidad:unidadDominante(tipo), area:v.area
  };
}

function filasActaPendientes(){
  const cfg=S.config;
  return pendientesConComprobante().map(rc=>{
    const d=derivadosProforma(rc);
    const obs=['PENDIENTE DIGITACIÓN','comprobante '+rc.evidencia.archivo+' p.'+rc.evidencia.pagina]
      .concat(d.area?['área '+d.area]:[]).join(' · ');
    return cfg.actaLayout.map(cd=>{
      if(!cd.campo) return '';
      if(cd.campo==='remision') return rc.remision||'';
      if(cd.campo==='obs') return obs;
      const val=d[cd.campo];
      return val==null?'':val;
    });
  });
}

// Campos del acta que la chequeadora llena y que la proforma puede completar si la BASE los
// dejó vacíos (fila a medias, aún en digitación). fecha queda fuera: es la llave del match.
const CAMPOS_COMPLETABLES=['uf','actividad','cc','placa','kmIni','kmFin','kmTot','cantidad','m3km','unidad'];
const LBL_CAMPO={uf:'UF',actividad:'actividad',cc:'CC',placa:'placa',kmIni:'km inicial',
  kmFin:'km final',kmTot:'km totales',cantidad:'cantidad',m3km:'m³·km',unidad:'unidad'};

// La remisión matcheó la base (remisión + empresa + fecha) pero la fila está A MEDIAS porque
// la chequeadora apenas la digita: devuelve SOLO los campos vacíos en la base que la proforma
// sí puede aportar (el PDF ya está probado por el match). No muta la base ni pisa lo tecleado.
function completarDesdeProforma(rc){
  if(!rc.candidato) return null;
  const c=rc.candidato, d=derivadosProforma(rc), faltan={};
  const vacio=x=>(x==null||x==='');
  for(const campo of CAMPOS_COMPLETABLES){
    if(campo==='uf'||campo==='m3km') continue;    // dependen de otros: al final
    if(vacio(c[campo]) && !vacio(d[campo])) faltan[campo]=d[campo];
  }
  if(vacio(c.uf)){                                 // UF desde el CC efectivo (base o rellenado)
    const cc=vacio(c.cc)?faltan.cc:c.cc;
    const uf=String(cc||'').indexOf('3701')===0?'UF1':String(cc||'').indexOf('3702')===0?'UF2':'';
    if(uf) faltan.uf=uf;
  }
  if(vacio(c.m3km)){                               // m³·km = km totales × cantidad (efectivos)
    const kn=numProforma(vacio(c.kmTot)?faltan.kmTot:c.kmTot);
    const cn=numProforma(vacio(c.cantidad)?faltan.cantidad:c.cantidad);
    if(kn!=null&&cn!=null) faltan.m3km=+(kn*cn).toFixed(3);
    else if(!vacio(d.m3km)) faltan.m3km=d.m3km;
  }
  return Object.keys(faltan).length?faltan:null;
}

// Filas del acta completadas con proforma (base a medias): para el aviso del Paso 7 y el resumen.
function reclamosCompletados(){
  if(!S.corte) return [];
  const out=[];
  for(const rc of S.corte.reclamos){
    if(ESTADOS_ACTA.indexOf(rc.estado)<0) continue;
    const comp=completarDesdeProforma(rc);
    if(comp) out.push({rc,campos:Object.keys(comp)});
  }
  return out;
}

function filasActa(){
  const cfg=S.config;
  const lista=S.corte.reclamos.filter(r=>ESTADOS_ACTA.indexOf(r.estado)>=0);
  lista.sort((a,b)=>{
    const fa=(a.candidato&&a.candidato.fecha)||'9999-99-99', fb=(b.candidato&&b.candidato.fecha)||'9999-99-99';
    if(fa!==fb) return fa<fb?-1:1;
    return (a.remision||'')<(b.remision||'')?-1:1;
  });
  return lista.map(rc=>{
    const comp=completarDesdeProforma(rc);          // huecos de la base rellenados con la proforma
    return cfg.actaLayout.map(cd=>{
      if(!cd.campo) return '';                       // derivada: César arrastra su fórmula
      if(cd.campo==='remision') return rc.remision||'';
      if(cd.campo==='obs') return obsReclamo(rc,comp);
      const c=rc.candidato; if(!c) return '';
      if(cd.campo==='fecha') return c.fecha?fmtFecha(c.fecha):'';
      let v=c[cd.campo];
      if((v==null||v==='') && comp && comp[cd.campo]!=null) v=comp[cd.campo];
      return v==null?'':v;
    });
  });
}

function vistaPaso7(){
  if(!S.corte||!S.corte.reclamos.length) return `<div class="paso-title">Paso 7 · Exportes</div><div class="alert warn">Carga una proforma primero.</div>`;
  const cfg=S.config; const c=conteoEstados();
  const acta=filasActa();
  const compl=reclamosCompletados();
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
    ${compl.length?`<div class="alert info" style="margin-bottom:8px">🩹 <b>${compl.length}</b> fila(s) estaban A MEDIAS en la base (la chequeadora aún las digitaba):
      la remisión ya matcheó (empresa + fecha), así que el PDF está probado y se completaron los huecos con la proforma.
      Van marcadas en Observaciones (“completada con proforma …”). Cuando la chequeadora termine y recargues las bases, el dato real gana solo. Verifícalas.</div>`:''}
    <div class="tbl-wrap" style="max-height:340px;overflow-y:auto"><table class="tbl"><tr>${cab}</tr>${filas}</table></div>
    ${acta.length>200?'<div class="note">(vista previa limitada a 200 filas; el export lleva todas)</div>':''}
  </div>

  ${cardActaPendientes(cab)}

  <div class="card"><h3>2 · Excel digitadora (${pend.length} pendientes de digitación)</h3>
    <div class="flexrow"><button class="btn sec" onclick="Exportes.xlsxDigitadora()" ${pend.length?'':'disabled'}>⬇ Descargar .xlsx</button>
    <span class="note">remisión + datos de la proforma + archivo/página del comprobante + notas · en orden por fecha y luego remisión (menor a mayor)</span></div></div>

  <div class="card"><h3>3 · PDF de pendientes</h3>
    <div class="flexrow"><button class="btn sec" onclick="Exportes.pdfPendientes()" ${pend.filter(r=>r.evidencia).length?'':'disabled'}>⬇ Generar PDF</button>
    <span class="note">páginas confirmadas de los comprobantes (deduplicadas), en el MISMO orden del Excel — fecha y luego remisión — para que la digitadora trabaje renglón a página</span></div></div>

  <div class="card"><h3>4 · Resumen del corte</h3>
    <div class="flexrow" style="margin-bottom:8px">
      <button class="btn sec mini" onclick="Exportes.copiarResumen()">📋 Copiar</button>
      <button class="btn sec mini" onclick="Exportes.xlsxResumen()">⬇ .xlsx</button></div>
    <pre class="mono" style="white-space:pre-wrap;font-size:12px;color:var(--text)">${escapeHtml(resumen)}</pre></div>`;
}

function cardActaPendientes(cab){
  const cfg=S.config;
  const pendC=pendientesConComprobante();
  if(!pendC.length) return '';
  const dlAreas=(cfg.areasObservadas||[]).map(a=>`<option value="${escapeHtml(a)}">`).join('');
  const ccs=Array.from(new Set([CC_AREA_AJENA,'3701.02.11','3702.02.11'].concat(ccCatalogo())));
  const dlCC=ccs.map(c=>`<option value="${escapeHtml(String(c))}">`).join('');
  const editor=pendC.map(rc=>{
    const v=valoresActaPendiente(rc); const s=rc.secundarios||{};
    const autoStyle='border-color:var(--warn)';
    const matBase=materialBasePendiente(rc);
    const matCell=s.material
      ?escapeHtml(s.material)+(matBase&&matBase!==s.material?' <span class="note">→ '+escapeHtml(matBase)+'</span>':'')
      :(matBase?'<span class="note">detectado: '+escapeHtml(matBase)+'</span>':'—');
    return `<tr>
      <td class="mono"><b>${escapeHtml(rc.remision)}</b></td>
      <td>${s.fecha?fmtFecha(s.fecha):''}</td>
      <td>${matCell}</td>
      <td>${escapeHtml([s.origen,s.destino].filter(Boolean).join(' → ')||'—')}</td>
      <td><input list="dlAreasPend" value="${escapeHtml(v.area)}" placeholder="nuestra"
        style="width:110px;${v.autoArea&&v.area?autoStyle:''}" title="vacío = nuestra; área ajena → CC fijo ${CC_AREA_AJENA}"
        onchange="Exportes.setPendArea('${rc.id}',this.value)"></td>
      <td><input list="dlCCPend" class="mono" value="${escapeHtml(v.cc)}" placeholder="CC"
        style="width:110px;${v.autoCC&&v.cc?autoStyle:''}" title="propuesta automática — confírmala o corrígela"
        onchange="Exportes.setPendCC('${rc.id}',this.value)">${v.autoCC&&v.cc?' <span class="badge naranja" title="propuesta automática, revísala">auto</span>':''}</td>
    </tr>`;
  }).join('');
  const filas=filasActaPendientes().map(row=>'<tr>'+row.map(x=>`<td>${escapeHtml(fmtNumTSV(x,cfg.decimalTSV))}</td>`).join('')+'</tr>').join('');
  return `<div class="card"><h3>1b · Bloque acta de PENDIENTES de digitación (${pendC.length} con comprobante)</h3>
    <div class="note" style="margin-bottom:8px">Mismo modelo A..S, llenado como lo hace César: fecha, remisión, placa, cantidad y
    actividad (material) de la proforma; kilometrajes = origen/destino (Km totales: Putana = destino + 2,5 · Avensa 25,7 ·
    Pekin 67,5 · resto |destino − origen|/1000, editable en ⚙️ Config → kmPorOrigen); m³·Km = Km totales × cantidad;
    unidad como la escribe la base. Solo quedan vacías tus derivadas (A, B, D, E, N, O). El <b>CC</b> es propuesta automática
    (<span class="badge naranja">auto</span> = sin confirmar): área ajena (puente, planta…) → fijo ${CC_AREA_AJENA};
    nuestros → sufijo por MATERIAL (sub base .03.02 · BTC/base .03.04 · crudo .02.11 · terraplén .02.11; mapeo
    editable en ⚙️ Config → ccPorMaterial) y prefijo 3701/3702 según PK ≤ 30 del destino. Las variaciones
    06.*/07.* de ODT/ODL son puntuales: corrígelas aquí. Revisa todo antes de copiar.
    ⚠️ Cuando la digitadora los digite y recargues bases pasarán a ENCONTRADA y saldrán también en el bloque 1: no los pegues dos veces.</div>
    <datalist id="dlAreasPend">${dlAreas}</datalist><datalist id="dlCCPend">${dlCC}</datalist>
    <div class="tbl-wrap" style="margin-bottom:10px"><table class="tbl">
      <tr><th>Remisión</th><th>Fecha</th><th>Material</th><th>Origen → Destino (proforma)</th><th>Área</th><th>CC (col. H)</th></tr>${editor}</table></div>
    <div class="flexrow" style="margin-bottom:8px">
      <button class="btn" onclick="Exportes.copiarActaPend()">📋 Copiar bloque pendientes (TSV)</button>
      <button class="btn sec" onclick="Exportes.xlsxActaPend()">⬇ Descargar .xlsx</button>
    </div>
    <div class="tbl-wrap" style="max-height:260px;overflow-y:auto"><table class="tbl"><tr>${cab}</tr>${filas}</table></div>
  </div>`;
}

function resumenCorte(){
  const c=conteoEstados(); const contr=getContratista(S.corte.contratistaId);
  const q=S.corte.quincena;
  const lin=[];
  lin.push('CORTE '+(contr?contr.nombre:S.corte.contratistaId)+' · '+fmtFecha(q.inicio)+' → '+fmtFecha(q.fin));
  if(S.corte.sinProforma) lin.push('MODO SIN PROFORMA — recibos tomados de la base ('+(S.corte.sinProforma.bases||[]).join('+')+') entre '+fmtFecha(S.corte.sinProforma.inicio)+' → '+fmtFecha(S.corte.sinProforma.fin));
  lin.push('Reclamadas: '+S.corte.reclamos.length);
  for(const e of ESTADOS){ if(c[e]) lin.push('  '+ETIQUETA[e]+': '+c[e]); }
  const listar=(titulo,arr,fmt)=>{ if(arr.length){ lin.push(''); lin.push(titulo+' ('+arr.length+'):'); for(const rc of arr) lin.push('  '+(fmt?fmt(rc):rc.remision)); } };
  listar('EXCLUIDAS UF3',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_UF3'));
  listar('EXCLUIDAS ASFALTO',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_ASFALTO'));
  listar('CON ÁREA OBSERVADA (van al acta con nota)',S.corte.reclamos.filter(r=>r.marcas.indexOf('AREA_OBSERVADA')>=0),rc=>rc.remision+' ['+(rc.subtipo||'')+']');
  listar('EXCLUIDAS OTRA ÁREA (legado/manual)',S.corte.reclamos.filter(r=>r.estado==='EXCLUIDA_OTRA_AREA'),rc=>rc.remision+' ['+(rc.subtipo||'')+']');
  listar('RECHAZADAS',S.corte.reclamos.filter(r=>r.estado==='RECHAZADA'),rc=>(rc.remision||rc.raw));
  listar('DUPLICADAS',S.corte.reclamos.filter(r=>r.estado==='DUPLICADA_EN_PROFORMA'));
  listar('REZAGOS',S.corte.reclamos.filter(r=>r.marcas.indexOf('REZAGO')>=0),rc=>rc.remision+' ('+(rc.candidato?fmtFecha(rc.candidato.fecha):'')+')');
  listar('INTERNOS > 3 KM (verificar acuerdo aparte)',S.corte.reclamos.filter(r=>r.marcas.indexOf('INTERNO_MAYOR_3KM')>=0),rc=>rc.remision+' ('+(rc.candidato?rc.candidato.kmTot:'')+' km)');
  const compl=reclamosCompletados();
  if(compl.length){ lin.push(''); lin.push('COMPLETADAS CON PROFORMA — fila a medias en la base ('+compl.length+'):');
    for(const x of compl) lin.push('  '+x.rc.remision+' ['+x.campos.map(k=>LBL_CAMPO[k]||k).join(', ')+']'); }
  const yn=S.corte.yaNoReclamadas||[];
  if(yn.length){ lin.push(''); lin.push('YA NO RECLAMADAS tras reemplazo de proforma ('+yn.length+'): '+yn.join(', ')); }
  // páginas de PDF que el OCR no pudo cruzar (partes sin reconocer)
  if(S.pdfs.length&&Object.keys(S.ocr.paginas).length){
    const {paginas,counts}=clasificarPaginas();
    const rev=paginas.filter(x=>x.cat==='sin_lectura'||x.cat==='sin_coincidencia');
    if(rev.length){
      lin.push(''); lin.push('PÁGINAS DE PDF POR REVISAR ('+rev.length+' de '+paginas.length+'):');
      for(const x of rev) lin.push('  '+x.archivo+' p.'+x.pg+' — '+(x.cat==='sin_lectura'?'OCR sin lectura':'leyó '+x.toks.join(',')+' (no coincide con nada reclamado)')+(S.ocr.editadas[x.archivo+'#'+x.pg]?' [lectura corregida a mano]':''));
    }
    const desc=paginas.filter(x=>x.cat==='descartada');
    if(desc.length){
      lin.push(''); lin.push('PÁGINAS DESCARTADAS A MANO — revisadas, no eran faltantes ('+desc.length+'): '+desc.map(x=>x.archivo+' p.'+x.pg).join(', '));
    }
    if(counts.sin_procesar) lin.push('  ('+counts.sin_procesar+' páginas sin procesar: corre el OCR en el Paso 5)');
  }
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
  // ---- bloque acta de pendientes: edición de área/CC y exportes ----
  setPendArea(id,val){
    const rc=S.corte.reclamos.find(r=>r.id===id); if(!rc) return;
    rc.actaPend=rc.actaPend||{};
    rc.actaPend.area=String(val||'').trim();
    // área ajena manda el CC fijo; volver a "nuestra" re-propone (borra el CC manual)
    if(rc.actaPend.area) rc.actaPend.cc=CC_AREA_AJENA; else delete rc.actaPend.cc;
    autosave(); render();
  },
  setPendCC(id,val){
    const rc=S.corte.reclamos.find(r=>r.id===id); if(!rc) return;
    rc.actaPend=rc.actaPend||{};
    rc.actaPend.cc=String(val||'').trim();
    autosave(); render();
  },
  async copiarActaPend(){
    const cfg=S.config; const rows=filasActaPendientes();
    const lines=rows.map(r=>r.map(v=>fmtNumTSV(v,cfg.decimalTSV)).join('\t'));
    if(S.ui.tsvHeader) lines.unshift(cfg.actaLayout.map(c=>c.titulo).join('\t'));
    const ok=await copiarTexto(lines.join('\n'));
    toast(ok?('📋 Bloque de pendientes copiado ('+rows.length+' filas).'):'⚠️ No se pudo copiar al portapapeles.');
  },
  xlsxActaPend(){
    const cfg=S.config;
    const aoa=[cfg.actaLayout.map(c=>c.titulo)].concat(filasActaPendientes());
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'PENDIENTES ACTA');
    XLSX.writeFile(wb,this._nombre('bloque_acta_pendientes','xlsx'));
  },
  xlsxDigitadora(){
    const pend=pendientesOrdenadas();
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
    // MISMO orden que el Excel de la digitadora (fecha y luego remisión), para que
    // las páginas del PDF acompañen renglón a renglón su trabajo de digitación.
    const pend=pendientesOrdenadas().filter(r=>r.evidencia);
    if(!pend.length){ toast('No hay pendientes con comprobante confirmado.'); return; }
    try{ await loadScript(CDN.pdflib); }catch(e){ toast('❌ '+e.message); return; }
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
        || rc.marcas.indexOf('REZAGO')>=0 || rc.marcas.indexOf('INTERNO_MAYOR_3KM')>=0
        || rc.marcas.indexOf('AREA_OBSERVADA')>=0){
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
    pdfMeta:S.pdfs.map(p=>({name:p.name,pages:p.numPages,kind:p.kind,ambito:ambitoPdfDe(p),ambitoAuto:!!p.ambitoAuto})),
    ocr:{paginas:S.ocr.paginas,candidatos:S.ocr.candidatos,descartados:S.ocr.descartados,editadas:S.ocr.editadas,revisadas:S.ocr.revisadas}
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
      paginas:(s.ocr&&s.ocr.paginas)||{},candidatos:(s.ocr&&s.ocr.candidatos)||{},
      descartados:(s.ocr&&s.ocr.descartados)||{},editadas:(s.ocr&&s.ocr.editadas)||{},
      revisadas:(s.ocr&&s.ocr.revisadas)||{}};
    S.pdfs=[]; // binarios no serializados: re-seleccionar
    S._esperado={bases:s.basesMeta||{},pdfs:s.pdfMeta||[]};
    S.ui.paso=4; render();
  },
  descartarAuto(){
    localStorage.removeItem(LS_SESION);
    S.corte=null; S.pdfs=[];
    S.ocr={running:false,cancel:false,hecho:0,total:0,paginas:{},candidatos:{},descartados:{},editadas:{},revisadas:{}};
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
    snap,areaObservada,buscarCandidatos,buscarSinCeros,conciliarReclamo,clasificar,
    marcarDuplicadas,conciliarPendientes,reconciliar,tomarRecibosBase,setEstado,conteoEstados,
    resetReclamo,hojasSospechosas,
    obsReclamo,filasActa,resumenCorte,cmpRemision,faltantes,pendientesOrdenadas,
    ambitoPdfDe,ambitoPdfPorNombre,ambitoCompatible,etiquetaAmbito,sugerirAmbitoPdf,clasificarPaginas,
    pkDeTexto,ccCatalogo,propuestaPendiente,valoresActaPendiente,pendientesConComprobante,filasActaPendientes,CC_AREA_AJENA,
    pkMetros,kmTotalesPendiente,unidadDominante,reglaMaterialPendiente,materialBasePendiente,numProforma,
    derivadosProforma,completarDesdeProforma,reclamosCompletados,
    S,ESTADOS,ESTADOS_ACTA
  };
}
if(typeof document!=='undefined'){ init(); }

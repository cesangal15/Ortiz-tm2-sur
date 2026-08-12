#!/usr/bin/env node
/**
 * Verificación de D133 — adelgazar la respuesta de `?action=asistencia`.
 *
 * DE DÓNDE SALE. Medido en campo con la consola de la pantalla (D132): de 112,5 KB de respuesta,
 * `catCC` pesaba 33,4 (751 ítems) y `catCCUsados` 30,0 (495) — y esos 495 eran los MISMOS strings que
 * ya viajaban en `catCC`, repetidos literalmente. A los ~6,5 KB/s de la red de obra, eso son ~10 s por
 * carga gastados en mandar dos veces algo que además casi nunca cambia.
 *
 * LOS TRES CAMBIOS QUE SE COMPRUEBAN AQUÍ:
 *   1. `catCCUsados` viaja como ÍNDICES dentro de `catCC`. Un CC que no esté en CAT_CC (typo al pegarlo
 *      en CC_USADOS) sigue viajando como string: la lista no puede perder elementos por esto.
 *   2. `catCC` NO se manda cuando el cliente devuelve en `&ccv=` la firma que ya tiene. Editar CAT_CC
 *      cambia la firma y el catálogo se reenvía solo — incluido el caso traicionero de REORDENARLO sin
 *      añadir ni quitar nada, que un contador de elementos no distinguiría.
 *   3. `filas` deja de llevar `id_registro`, `timestamp` y `observacion`, que la pantalla no lee.
 *      `cuadrillas[].hora` —que SÍ sale del `timestamp`— tiene que seguir llegando.
 *
 * Y LO QUE NO PUEDE CAMBIAR: el resto de la respuesta, campo por campo, contra el mismo código antes
 * del cambio (se reconstruye la versión previa desde git y se comparan las dos salidas).
 *
 * USO: node backend/pruebas/verificar_d133_payload_resumen.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'CodigoAsistencias.gs');
const SECRETO = 'secreto-de-prueba';
const HOY = '2026-08-11';

/* ---------- datos de mentira, con la forma de los reales ---------- */
const CUADRILLAS = [
  { _row:2, cuadrilla:'ANGEL',   responsables:'angel',   area:'',    estado:'activa' },
  { _row:3, cuadrilla:'EDUARDO', responsables:'eduardo', area:'odt', estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'75781', cedula:'1090', nombre:'JUAN TIERRAS', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel',   estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' },
  { _row:3, codigo:'80001', cedula:'2200', nombre:'PEDRO ODT',    cargo:'OFICIAL',  cuadrilla:'EDUARDO',
    responsable:'eduardo', estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' },
  { _row:4, codigo:'80002', cedula:'2201', nombre:'LUIS ODT',     cargo:'OFICIAL',  cuadrilla:'EDUARDO',
    responsable:'eduardo', estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' }
];
const ASISTENCIA = [
  { _row:2, id_registro:'8f3c1e2a-0b44-4d1e-9a77-1c2d3e4f5a6b', timestamp:'2026-08-11T13:02:11.000Z',
    fecha:HOY, reporta:'angel', cuadrilla:'ANGEL', codigo:'75781', cedula:'1090', nombre:'JUAN TIERRAS',
    cargo:'AYUDANTE', cc:'3701.02.05| EXCAVACION', proyecto:'3701', hora_entrada:'07:00',
    hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'llegó tarde por la vía', turno:'1' },
  { _row:3, id_registro:'b1a2c3d4-1122-4455-8899-aabbccddeeff', timestamp:'2026-08-11T13:05:00.000Z',
    fecha:HOY, reporta:'eduardo', cuadrilla:'EDUARDO', codigo:'80001', cedula:'2200', nombre:'PEDRO ODT',
    cargo:'OFICIAL', cc:'3701.06.01| CUNETA', proyecto:'3701', hora_entrada:'07:00',
    hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }
];
// Catálogo con la pinta del real: strings largos, verbatim de Navision.
const CAT_CC = [];
for(let i=1;i<=40;i++){
  const n = ('0'+i).slice(-2);
  CAT_CC.push({ string_cc:'3701.06.'+n+'| Box abovedados en concreto reforzado de 3.000 psi, item '+n });
}
// CC_USADOS "engordada" como la real (495 de 751): casi todo el catálogo, más un typo que NO está en él.
const CC_USADOS = CAT_CC.slice(0, 30).map(r=>({ string_cc:r.string_cc, area:'' }));
CC_USADOS.push({ string_cc:'3701.99.99| CC PEGADO CON UN TYPO QUE NO EXISTE EN CAT_CC', area:'' });

const HOJAS = {
  CUADRILLAS, PERSONAL, ASISTENCIA, CC_USADOS,
  CAT_CC: CAT_CC.slice(),
  CONFIG:[ { clave:'max_extras_dia', valor:'2' } ],
  FESTIVOS:[], TURNOS:[], CAT_MOTIVOS:[{ string_motivo:'Incapacidad' }],
  MOTIVOS_USADOS:[], NOTAS_ASISTENCIA:[], EXTRAS_ADMIN:[]
};

/* ---------- sandbox de Apps Script (mismo patrón que verificar_d119) ---------- */
function nuevoContexto(fuenteGs, hojas){
  const props = { AUTH_SECRETO: SECRETO, AUTH_V: '1' };
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
    ContentService:{ createTextOutput(txt){ return { texto:txt, setMimeType(){ return this; } }; },
                     MimeType:{ JSON:'JSON' } },
    Utilities:{
      getUuid(){ return 'uuid-fijo'; },
      formatDate(){ return HOY; },
      base64EncodeWebSafe(b){ return Buffer.from(b).toString('base64url'); },
      base64DecodeWebSafe(s){ return Buffer.from(String(s), 'base64url'); },
      newBlob(x){ const b=Buffer.isBuffer(x)?x:Buffer.from(String(x),'utf8');
                  return { getBytes(){ return b; }, getDataAsString(){ return b.toString('utf8'); } }; },
      computeHmacSha256Signature(txt, clave){
        return crypto.createHmac('sha256', String(clave)).update(String(txt), 'utf8').digest();
      },
      Charset:{ UTF_8:'utf8' }
    },
    Logger:{ log(){} },
    PropertiesService:{ getScriptProperties(){ return {
      getProperty(k){ return Object.prototype.hasOwnProperty.call(props,k) ? props[k] : null; },
      setProperty(k,v){ props[k]=String(v); } }; } },
    SpreadsheetApp:{ openById(){ throw new Error('la prueba no debe abrir el Sheet'); } },
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, putAll(){}, getAll(){ return {}; },
                                              remove(){}, removeAll(){} }; } },
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuenteGs, ctx, { filename:'CodigoAsistencias.gs' });
  ctx.readSheet = function(n){ return (hojas[n] || []).slice(); };
  ctx.leerColumnasDeHoja_ = function(n){ return (hojas[n] || []).slice(); };
  ctx.leerFilasPorFecha_ = function(hoja, desde, hasta){
    if(hoja !== 'ASISTENCIA') throw new Error('lector acotado usado sobre ' + hoja);
    return hojas.ASISTENCIA.filter(r => r.fecha >= desde && r.fecha <= hasta);
  };
  ctx.invalidarHoja_ = function(){};
  return ctx;
}

const ctx = nuevoContexto(fs.readFileSync(RUTA_GS, 'utf8'), HOJAS);
const TOKEN = ctx.emitirToken_('admin', 'admin', []);
function get(c, extra){
  const p = Object.assign({ action:'asistencia', fecha:HOY, usuario:'admin', token:TOKEN }, extra||{});
  return { txt: c.doGet({ parameter:p }).texto, json: JSON.parse(c.doGet({ parameter:p }).texto) };
}

let fallos = 0;
function ok(cond, msg, extra){ if(cond) console.log('  ✓ '+msg+(extra?'   '+extra:''));
                               else { fallos++; console.error('  ✗ '+msg+(extra?'   '+extra:'')); } }
/* La reconstrucción del cliente (D133d), replicada tal cual está en `resumen-asistencia.html` — guarda
 * de longitud incluida, que es lo que convierte un dato incompleto en un error visible. */
function expandir(v){
  if(Array.isArray(v)) return v;
  const cols=v.cols, n=cols.length;
  return v.datos.map(function(fila){
    if(fila.length!==n) throw new Error('longitud');
    const o={}; for(let j=0;j<n;j++){ const x=fila[j]; o[cols[j]] = (x==null) ? '' : x; } return o;
  });
}

/* ---------------------------------------------------------------- 1 */
console.log('\n=== D133 · 1) catCCUsados como índices dentro de catCC ===');
const r1 = get(ctx).json;
ok(Array.isArray(r1.catCC) && r1.catCC.length === 40, 'catCC llega entero la primera vez (sin `ccv`)',
   r1.catCC.length + ' ítems');
ok(r1.catCCUsados.filter(v => typeof v === 'number').length === 30,
   'los 30 CC que SÍ están en el catálogo viajan como número', JSON.stringify(r1.catCCUsados.slice(0,4)));
ok(r1.catCCUsados.filter(v => typeof v === 'string').length === 1,
   'el CC con typo, que no está en CAT_CC, viaja como string (no se pierde)');
ok(r1.catCCUsados.every((v,i) => typeof v !== 'number' || r1.catCC[v] === CC_USADOS[i].string_cc),
   'cada índice apunta EXACTAMENTE al string que sustituye');

/* ---------------------------------------------------------------- 2 */
console.log('\n=== D133 · 2) catCC solo cuando el cliente no lo tiene ===');
const conFirma = get(ctx, { ccv: r1.catCCv }).json;
ok(!('catCC' in conFirma), 'con la firma correcta, la clave `catCC` NO viaja');
ok(conFirma.catCCv === r1.catCCv, 'la firma sigue viajando, para poder detectar el cambio');
ok(Array.isArray(conFirma.catCCUsados) && conFirma.catCCUsados.length === 31,
   'los frecuentes siguen llegando: son índices contra el catálogo que el cliente ya guardó');
ok('catCC' in get(ctx, { ccv:'firma-vieja' }).json, 'con una firma que no cuadra, se reenvía entero');
ok('catCC' in get(ctx).json, 'sin `ccv` (frontend viejo), se reenvía entero — retrocompatible');

// El catálogo cambia en el Sheet: la firma tiene que cambiar sola.
const HOJAS_MAS = Object.assign({}, HOJAS, { CAT_CC: CAT_CC.concat([{ string_cc:'3701.06.41| CC NUEVO' }]) });
const ctxMas = nuevoContexto(fs.readFileSync(RUTA_GS, 'utf8'), HOJAS_MAS);
const rMas = JSON.parse(ctxMas.doGet({ parameter:{ action:'asistencia', fecha:HOY, usuario:'admin',
  token: ctxMas.emitirToken_('admin','admin',[]), ccv: r1.catCCv } }).texto);
ok(rMas.catCCv !== r1.catCCv && 'catCC' in rMas,
   'agregar un CC en el Sheet cambia la firma y lo reenvía (sin tocar código ni redesplegar)');

// El caso traicionero: MISMOS elementos, otro orden. Un contador no lo vería; el hash posicional sí.
const revuelto = CAT_CC.slice().reverse();
ok(ctx.firmaLista_(revuelto.map(r=>r.string_cc)) !== ctx.firmaLista_(CAT_CC.map(r=>r.string_cc)),
   'reordenar el catálogo TAMBIÉN cambia la firma (los índices dejarían de apuntar bien)');
ok(ctx.firmaLista_(CAT_CC.map(r=>r.string_cc)) === ctx.firmaLista_(CAT_CC.map(r=>r.string_cc)),
   'la firma es estable: el mismo catálogo da siempre la misma');

/* ---------------------------------------------------------------- 3 */
console.log('\n=== D133 · 3a) filas sin los tres campos que nadie lee ===');
const f0 = expandir(r1.filas)[0];
ok(!('id_registro' in f0) && !('timestamp' in f0) && !('observacion' in f0),
   'id_registro, timestamp y observacion ya no viajan en cada fila');
['_row','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto',
 'hora_entrada','hora_salida','presente','motivo_ausencia','turno'].forEach(function(k){
  if(!(k in f0)){ fallos++; console.error('  ✗ falta el campo `'+k+'`, que la pantalla SÍ usa'); }
});
ok(Object.keys(f0).length === 15, 'quedan los 15 campos que la pantalla usa', Object.keys(f0).length+' campos');
const cuadAngel = r1.cuadrillas.filter(c=>c.cuadrilla==='ANGEL')[0];
ok(cuadAngel && cuadAngel.hora === '2026-08-11T13:02:11.000Z',
   'cuadrillas[].hora sigue saliendo del timestamp (se usa dentro, ya no se reenvía por fila)');
ok(cuadAngel && cuadAngel.reporto === true && cuadAngel.total === 1, 'el resto del bloque de cuadrilla, intacto');

/* ---------------------------------------------------------------- 3b */
console.log('\n=== D133d · 3b) filas y faltantes como cabecera + valores ===');
const COLS_F=['_row','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo','cc','proyecto',
  'hora_entrada','hora_salida','presente','motivo_ausencia','turno'];
ok(r1.filas && Array.isArray(r1.filas.cols) && Array.isArray(r1.filas.datos),
   'filas viaja como {cols, datos}');
ok(JSON.stringify(r1.filas.cols) === JSON.stringify(COLS_F), 'la cabecera son las 15 columnas de siempre');
ok(r1.filas.datos.length === 2 && r1.filas.datos.every(f=>f.length===15),
   'cada fila trae exactamente tantos valores como columnas');
ok(r1.faltantes.cols.indexOf('motivo')>=0 && r1.faltantes.cols.indexOf('incompleto')>=0,
   'faltantes declara las columnas de SUS DOS formas (ausente trae motivo, sin_reportar trae incompleto)');
const reconstruidas=expandir(r1.filas);
ok(reconstruidas[0].nombre==='JUAN TIERRAS' && reconstruidas[0].hora_entrada==='07:00'
   && reconstruidas[0]._row===2 && reconstruidas[0].cc==='3701.02.05| EXCAVACION',
   'al reconstruir vuelven los mismos valores en los mismos campos');
const faltRec=expandir(r1.faltantes);
ok(faltRec.length===1 && faltRec[0].nombre==='LUIS ODT' && faltRec[0].tipo==='sin_reportar',
   'lo mismo con faltantes');
ok(faltRec[0].motivo==='', 'el campo que ese tipo de fila no tiene vuelve como cadena vacía, no como null');
let saltoLaGuarda=false;
try{ expandir({ cols:['a','b','c'], datos:[['1','2']] }); }catch(e){ saltoLaGuarda=true; }
ok(saltoLaGuarda, 'una fila con menos valores que columnas LANZA en vez de dejar campos vacíos');

/* ---------------------------------------------------------------- 4 */
console.log('\n=== D133 · 4) lo demás de la respuesta no cambió ===');
/* Referencia FIJA: el último commit SIN D133 (mismo patrón que `verificar_refactor_horas`). Con `HEAD`
 * la prueba se muerde la cola en cuanto se comitea el cambio — el "antes" pasaría a ser el "después" y
 * la comparación dejaría de comprobar nada (peor: fallaría por comparar índices contra índices ya
 * resueltos). No se actualiza este SHA: es el estado contra el que D133 promete ser neutro. */
const REF_PRE_D133 = 'a7a5c8f';
const { execSync } = require('child_process');
let previo = null;
try{ previo = execSync('git show '+REF_PRE_D133+':backend/CodigoAsistencias.gs', { cwd:RAIZ, maxBuffer:32*1024*1024 }).toString(); }
catch(err){ console.log('  · (no se pudo leer '+REF_PRE_D133+' desde git: se omite la comparación)'); }
if(previo){
  const ctxViejo = nuevoContexto(previo, HOJAS);
  const antes = JSON.parse(ctxViejo.doGet({ parameter:{ action:'asistencia', fecha:HOY, usuario:'admin',
    token: ctxViejo.emitirToken_('admin','admin',[]) } }).texto);
  const ahora = r1;
  const iguales = ['ok','fecha','eventuales','jornada','catMotivos','turnos','extrasAdmin',
                   'notas','config','festivos','areas','cuadrillas'];
  iguales.forEach(function(k){
    const a=JSON.stringify(antes[k]), b=JSON.stringify(ahora[k]);
    if(a!==b){ fallos++; console.error('  ✗ `'+k+'` cambió y no debía'); }
  });
  ok(true, 'idénticos campo por campo: '+iguales.join(', '));
  // Lo que SÍ cambió de forma tiene que dar lo mismo una vez deshecha la codificación del cliente.
  const resueltos = ahora.catCCUsados.map(v => typeof v==='number' ? ahora.catCC[v] : v);
  ok(JSON.stringify(resueltos) === JSON.stringify(antes.catCCUsados),
     'catCCUsados, tras resolver los índices, es exactamente la lista de antes');
  /* `faltantes` mezcla dos formas: el ausente trae `motivo` y el sin-reportar `incompleto`. Antes cada
   * objeto llevaba SOLO sus claves; con la cabecera común, todos llevan las nueve y la que no aplica
   * llega vacía. La diferencia es inofensiva —la pantalla lee esos dos campos como verdadero/falso o
   * con `||''`, y `''` se comporta igual que ausente— pero hay que comprobarlo, no suponerlo: se
   * rellena el "antes" con las claves que le faltaban y se exige igualdad EXACTA de ahí en adelante. */
  const antesFalt = antes.faltantes.map(function(f){
    const o={}; ahora.faltantes.cols.forEach(function(c){ o[c] = (f[c]===undefined ? '' : f[c]); }); return o;
  });
  ok(JSON.stringify(expandir(ahora.faltantes)) === JSON.stringify(antesFalt),
     'faltantes, tras reconstruirlo, es el de antes (con la clave que no aplica vacía en vez de ausente)');
  const soloVacias = antes.faltantes.every(function(f, i){
    return ahora.faltantes.cols.every(function(c){ return f[c]!==undefined || antesFalt[i][c]===''; });
  });
  ok(soloVacias, 'y lo único que se añadió son cadenas vacías: ningún valor real cambió');
  // En `filas`, además de la forma, D133 quitó tres campos (3a): se quitan también del "antes".
  const antesFilas = antes.filas.map(function(f){
    const o=Object.assign({}, f); delete o.id_registro; delete o.timestamp; delete o.observacion; return o;
  });
  ok(JSON.stringify(expandir(ahora.filas)) === JSON.stringify(antesFilas),
     'filas, tras reconstruirla y descontar los 3 campos muertos, es exactamente la de antes');
  const kb = t => Math.round(t.length/102.4)/10;
  const antesTxt = ctxViejo.doGet({ parameter:{ action:'asistencia', fecha:HOY, usuario:'admin',
    token: ctxViejo.emitirToken_('admin','admin',[]) } }).texto;
  const ahoraTxt = get(ctx, { ccv: r1.catCCv }).txt;
  console.log('  · tamaño con estos datos de mentira: '+kb(antesTxt)+' KB → '+kb(ahoraTxt)+' KB'
    + ' ('+Math.round((1-ahoraTxt.length/antesTxt.length)*100)+' % menos, segunda carga en adelante)');
}

console.log('\n' + (fallos ? '✗ '+fallos+' comprobación(es) fallida(s)' : '✓ todo correcto') + '\n');
process.exit(fallos ? 1 : 0);

#!/usr/bin/env node
/**
 * Verificación de D134 — `maria` reporta la asistencia de la cuadrilla ALBERT mientras `maleja` está
 * de vacaciones (relevo TEMPORAL).
 *
 * QUÉ SE COMPRUEBA Y POR QUÉ. El relevo no agrega lógica: se apoya en que la columna `responsables`
 * de la hoja CUADRILLAS admite VARIOS logins separados por coma. Justamente por eso conviene probarlo,
 * porque todo depende de un dato:
 *   · que a `maria` le llegue ALBERT — y su gente — en el roster;
 *   · que a `maleja` NO le cambie nada (sigue de vacaciones, pero vuelve: su canal debe estar intacto);
 *   · que `maria` no gane de paso ninguna otra cuadrilla, ni permisos que no tenía;
 *   · que el REVERTIR sea de verdad una sola celda: quitando `maria` de `responsables`, el sistema
 *     vuelve exactamente al estado anterior.
 * Y una comprobación de forma: los dos canales COEXISTEN (D03/D107 — el envío pisa fecha+cuadrilla),
 * así que lo que se reporta queda sellado con quién lo reportó (`reporta`).
 *
 * CÓMO. Se carga `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script
 * de mentira y se sustituyen los puntos de lectura/escritura del Sheet por datos de prueba (mismo
 * patrón que `verificar_d119_asistencias_tm2.js`). El HMAC es el real (`crypto` de Node), así que el
 * token firmado de D109 se emite y se verifica de verdad.
 *
 * USO: node backend/pruebas/verificar_d134_maria_albert.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'CodigoAsistencias.gs');

const SECRETO = 'secreto-de-prueba-suficientemente-largo-123456';
const HOY = '2026-08-12';   // miércoles

/* ---------- datos de prueba ----------
 * Las de TIERRAS van con `area` VACÍA a propósito: es como están hoy en el Sheet vivo. ARIEL inactiva
 * (D84). La celda de ALBERT lleva los espacios alrededor de la coma que cualquiera teclea al editarla
 * a mano — si `norm` no los limpiara, el relevo no funcionaría en el Sheet real. */
function cuadrillas(responsablesAlbert){
  return [
    { cuadrilla:'ANGEL',       responsables:'angel',              area:'',    estado:'' },
    { cuadrilla:'ROBINSON',    responsables:'robinson',           area:'',    estado:'activa' },
    { cuadrilla:'ALBERT',      responsables:responsablesAlbert,   area:'',    estado:'' },
    { cuadrilla:'ARIEL',       responsables:'',                   area:'',    estado:'inactiva' },
    { cuadrilla:'ALEJANDRO',   responsables:'alejandro',          area:'',    estado:'' },
    { cuadrilla:'OPERADORES',  responsables:'jeisson',            area:'',    estado:'' },
    { cuadrilla:'VOLQUETEROS', responsables:'mairy',              area:'',    estado:'' },
    { cuadrilla:'JAIRO',       responsables:'jairo',              area:'odl', estado:'activa' }
  ];
}
const PERSONAL = [
  { _row:2, codigo:'70001', cedula:'1001', nombre:'JUAN ALBERT',  cargo:'AYUDANTE', cuadrilla:'ALBERT',
    responsable:'maleja',   estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:3, codigo:'70002', cedula:'1002', nombre:'ANA ALBERT',   cargo:'OFICIAL',  cuadrilla:'ALBERT',
    responsable:'maleja',   estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:4, codigo:'70003', cedula:'1003', nombre:'PEDRO ANGEL',  cargo:'OFICIAL',  cuadrilla:'ANGEL',
    responsable:'angel',    estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:5, codigo:'80002', cedula:'2201', nombre:'LUIS ODL',     cargo:'OFICIAL',  cuadrilla:'JAIRO',
    responsable:'jairo',    estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' }
];
function filaAsis(fecha, codigo, cuadrilla, o){
  return Object.assign({ id_registro:'x', timestamp:'', fecha, reporta:'maleja', cuadrilla, codigo,
    cedula:'', nombre:'', cargo:'', cc:'3701.02.05| EXCAVACION', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }, o);
}
const ASISTENCIA = [ filaAsis(HOY,'70001','ALBERT'), filaAsis(HOY,'70003','ANGEL', { reporta:'angel' }) ];

function hojas(responsablesAlbert){
  return {
    CUADRILLAS: cuadrillas(responsablesAlbert), PERSONAL, ASISTENCIA,
    CONFIG:[ { clave:'max_extras_dia', valor:'2' }, { clave:'domfest_tope', valor:'7' },
             { clave:'proyecto_3701', valor:'3701| TM2 SUR UF1' }, { clave:'proyecto_3702', valor:'3702| TM2 SUR UF2' } ],
    FESTIVOS:[], TURNOS:[], CAT_CC:[], CAT_MOTIVOS:[{ string_motivo:'Incapacidad' }],
    MOTIVOS_USADOS:[], NOTAS_CUADRILLA:[], EXTRAS_ADMIN:[],
    CC_USADOS:[ { string_cc:'3701.02.05| EXCAVACION', area:'' }, { string_cc:'3702.07.01| CUNETA', area:'odl' } ]
  };
}

/* ---------- sandbox de Apps Script ---------- */
function nuevoContexto(fuenteGs, HOJAS){
  const props = { AUTH_SECRETO: SECRETO, AUTH_V: '1' };
  const escrituras = [];
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
    ContentService:{ createTextOutput(txt){ return { texto:txt, setMimeType(){ return this; } }; },
                     MimeType:{ JSON:'JSON' } },
    Utilities:{
      getUuid(){ return 'uuid-fijo'; },
      formatDate(){ return HOY; },
      base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); },
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
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){} }; } },
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuenteGs, ctx, { filename:'CodigoAsistencias.gs' });

  ctx.readSheet = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerColumnasDeHoja_ = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerFilasPorFecha_ = function(hoja, desde, hasta){
    if(hoja !== 'ASISTENCIA') throw new Error('lector acotado usado sobre ' + hoja);
    return ASISTENCIA.filter(r => r.fecha >= desde && r.fecha <= hasta);
  };
  ctx.invalidarHoja_ = function(){};
  ctx.getSheet = function(nombre){
    return {
      nombre, getLastRow(){ return 1; }, getLastColumn(){ return 20; },
      getMaxRows(){ return 1000; }, getMaxColumns(){ return 20; },
      insertRowsAfter(){}, deleteRows(){},
      // La hoja está vacía en la prueba, así que limpiar no tiene nada que hacer: no-op para que el
      // camino de escritura llegue hasta el final en vez de morir en el `catch` general de doPost.
      clearContents(){ return this; }, setNumberFormat(){ return this; },
      appendRow(fila){ escrituras.push({ hoja:nombre, op:'appendRow', fila }); },
      getRange(){ return { setValue(v){ escrituras.push({ hoja:nombre, op:'setValue', v }); },
                           setValues(v){ escrituras.push({ hoja:nombre, op:'setValues', v }); },
                           getValues(){ return []; } }; }
    };
  };
  ctx.borrarFilas_ = function(){ return 0; };
  ctx._escrituras = escrituras;
  return ctx;
}

const FUENTE = fs.readFileSync(RUTA_GS, 'utf8');
// DESPUÉS del relevo (lo que queda en el Sheet con D134) y ANTES (para probar que revertir es una celda).
const ctx    = nuevoContexto(FUENTE, hojas('maleja, maria'));
const ctxPre = nuevoContexto(FUENTE, hojas('maleja'));

/* ---------- utilidades de la prueba ---------- */
let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
function token(c, usuario, rol, areas){ return c.emitirToken_(usuario, rol, areas||[]); }
const TOK_MARIA  = () => token(ctx, 'maria',  'chequeadora', []);
const TOK_MALEJA = () => token(ctx, 'maleja', 'chequeadora', []);
function get(c, params){ return JSON.parse(c.doGet({ parameter: Object.assign({}, params) }).texto); }
function post(c, body){ return JSON.parse(c.doPost({ postData:{ contents: JSON.stringify(body) }, parameter:{} }).texto); }
function ordenar(a){ return (a||[]).slice().sort(); }
function nombres(personas){ return ordenar((personas||[]).map(p => p.nombre)); }

console.log('\n=== D134 — `maria` reporta ALBERT mientras `maleja` está de vacaciones (temporal) ===');

/* ---------------------------------------------------------------- 1 */
console.log('\n1) cuadrillasDeUsuario — el relevo sale de la celda `responsables`, no del código');
ok(JSON.stringify(ctx.cuadrillasDeUsuario('maria')) === JSON.stringify(['ALBERT']),
  "cuadrillasDeUsuario('maria') = ['ALBERT']");
ok(ctx.cuadrillasDeUsuario('maria').length === 1, 'y NADA más: una sola cuadrilla a cargo');
ok(ctx.cuadrillasDeUsuario('  MARIA ').length === 1, 'normaliza mayúsculas/espacios del login (norm)');
ok(ctx.cuadrillasDeUsuario('maria').indexOf('JAIRO') < 0, 'no gana ninguna cuadrilla de drenajes');
ok(ctx.cuadrillasDeUsuario('maria').indexOf('ANGEL') < 0, 'ni ninguna otra de tierras');
console.log('   · la celda se teclea a mano, con espacios alrededor de la coma: `maleja, maria`');
ok(ctx.cuadrillasDeUsuario('maleja').indexOf('ALBERT') >= 0, 'el espacio no rompe a `maleja`');

/* ---------------------------------------------------------------- 2 */
console.log('\n2) NO REGRESIÓN — a los canales existentes no les cambia nada');
['maleja','angel','robinson','alejo','alejandro','jeisson','mairy','jairo','duvan','angie','admin']
  .forEach(function(u){
    ok(JSON.stringify(ordenar(ctx.cuadrillasDeUsuario(u))) === JSON.stringify(ordenar(ctxPre.cuadrillasDeUsuario(u))),
      'cuadrillasDeUsuario(' + u + ') idéntica antes y después del relevo');
  });
ok(JSON.stringify(ctxPre.cuadrillasDeUsuario('maria')) === JSON.stringify([]),
  'y ANTES del relevo `maria` no tenía ninguna → REVERTIR es quitarla de esa única celda');

/* ---------------------------------------------------------------- 3 */
console.log('\n3) Roster — a `maria` le llega la gente de ALBERT, la misma que a `maleja`');
let r = get(ctx, { action:'roster', token:TOK_MARIA(), fecha:HOY });
ok(r.ok === true, 'el roster responde con su token');
ok(JSON.stringify(r.cuadrillas) === JSON.stringify(['ALBERT']), 'una sola cuadrilla en el selector');
ok(JSON.stringify(nombres(r.personas)) === JSON.stringify(['ANA ALBERT','JUAN ALBERT']),
  'con las dos personas de ALBERT');
const rMaleja = get(ctx, { action:'roster', token:TOK_MALEJA(), fecha:HOY });
ok(JSON.stringify(nombres(r.personas)) === JSON.stringify(nombres(rMaleja.personas)),
  'exactamente el mismo roster que ve `maleja` (mismo formulario, otra persona)');
ok((r.catCCUsados||[]).every(cc => String(cc).indexOf('.07.') < 0),
  'sus CC frecuentes son los de TIERRAS (ALBERT), no los de drenajes');
r = get(ctx, { action:'roster', token:TOK_MARIA(), fecha:'2026-01-01' });
ok(nombres(r.personas).length === 0, 'roster date-aware (D72): antes del ingreso no le trae a nadie');

/* ---------------------------------------------------------------- 4 */
console.log('\n4) Alcance — el relevo no le da permisos que `maleja` no tuviera');
ok(JSON.stringify(ctx.areasDeUsuario('maria')) === JSON.stringify(ctx.areasDeUsuario('maleja')),
  'mismas áreas forzadas que `maleja` (ninguna: rol `chequeadora`)');
ok(ctx.cuadrillaPermitidaPara('maria','ALBERT') === ctx.cuadrillaPermitidaPara('maleja','ALBERT'),
  'cuadrillaPermitidaPara: mismo veredicto que `maleja` sobre ALBERT');
ok(ctx.cuadrillaPermitidaPara('maria','JAIRO') === ctx.cuadrillaPermitidaPara('maleja','JAIRO'),
  'y el mismo sobre una de drenajes — el guard por área no se mueve en esta decisión');
ok(ctx.areaDeReportante('maria') === 'tierras', 'areaDeReportante(maria) = tierras (por su cuadrilla)');

/* ---------------------------------------------------------------- 5 */
console.log('\n5) Envío — reporta como `maria` y los dos canales COEXISTEN (D03/D107)');
r = post(ctx, { action:'reporte_asistencia', token:TOK_MARIA(), fecha:HOY, cuadrilla:'ALBERT',
                filas:[{ codigo:'70001', cedula:'1001', nombre:'JUAN ALBERT', cargo:'AYUDANTE',
                         presente:'Si', hora_entrada:'07:00', hora_salida:'15:30',
                         cc:'3701.02.05| EXCAVACION', turno:'1' }] });
ok(r.ok === true, 'el envío de `maria` sobre ALBERT se acepta' + (r.ok ? '' : ' — ' + r.error));
const escritas = ctx._escrituras.filter(e => e.op === 'appendRow' || e.op === 'setValues');
ok(escritas.length > 0, 'y llega a escribir en ASISTENCIA');
ok(JSON.stringify(escritas).indexOf('maria') >= 0, 'sellado con `reporta=maria` (trazabilidad de quién reportó)');
r = post(ctx, { action:'reporte_asistencia', token:TOK_MALEJA(), fecha:HOY, cuadrilla:'ALBERT', filas:[] });
ok(r.ok === true, 'y `maleja` puede seguir enviando la MISMA cuadrilla (el último del día manda)');

/* ---------------------------------------------------------------- 6 */
console.log('\n6) Token firmado (D109) — la identidad no la pone el cliente');
r = get(ctx, { action:'roster', token:TOK_MARIA(), usuario:'admin' });
ok(r.ok === true, '?usuario=admin con su token: la petición pasa…');
ok(JSON.stringify(r.cuadrillas) === JSON.stringify(['ALBERT']),
  '…pero sigue siendo ella: una sola cuadrilla, no las del admin');
const manipulado = ctx._b64url_(Buffer.from(JSON.stringify(
  { u:'maria', r:'admin', a:[], v:'1', t:Date.now() }))) + '.' + TOK_MARIA().split('.')[1];
r = get(ctx, { action:'roster', token: manipulado });
ok(r.ok === false && r.auth === false, 'con el rol editado a `admin`: FIRMA INVÁLIDA, rechazado');

/* ---------------------------------------------------------------- 7 */
console.log('\n7) Semillas del repo — coherentes con lo que hay que dejar en las hojas');
const asisGs = FUENTE;
ok(/\['ALBERT','maleja,maria','tierras',''\]/.test(asisGs),
  "setupHojas() siembra ALBERT con `maleja,maria` (CodigoAsistencias.gs)");
const obraGs = fs.readFileSync(path.join(RAIZ,'backend','Codigo.gs'), 'utf8');
ok(/\['maria','','chequeadora','','seleccion-reporte\.html','activo'\]/.test(obraGs),
  "setupUsuarios() siembra a `maria` con redirige=seleccion-reporte.html (Codigo.gs)");
const sel = fs.readFileSync(path.join(RAIZ,'seleccion-reporte.html'), 'utf8');
ok(/'maria':\s*\[\{href:'reporte-chequeadora\.html'/.test(sel),
  'seleccion-reporte.html tiene el tile de obra de `maria`…');
ok(!/usuario!=='maria'/.test(sel),
  '…y NO está en la lista de excluidos, así que recibe el tile de asistencia automático');

console.log(fallos ? '\n=== ' + fallos + ' FALLO(S) ===\n' : '\n=== TODO OK ===\n');
process.exit(fallos ? 1 : 0);

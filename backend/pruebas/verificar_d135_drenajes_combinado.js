#!/usr/bin/env node
/**
 * Verificación de D135 — en el resumen de asistencias, `angie` mira DRENAJES COMPLETO (`odt,odl`)
 * en vez de ODT y ODL por separado.
 *
 * EL BUG QUE SE REPRODUCE AQUÍ. `asistenciaDia` filtra las filas de ASISTENCIA por área ANTES de
 * cruzarlas con el personal esperado. En drenajes la gente se mueve entre cuadrillas ODT y ODL según
 * el frente y su fila en PERSONAL se queda en la de origen, así que mirando SOLO ODT una persona de
 * cuadrilla ODT que ese día se reportó dentro de una cuadrilla ODL sale como `sin_reportar`: la fila
 * existe, pero el filtro la dejó fuera del cruce. En campo (ago-2026) fueron 8 personas. Peor que el
 * susto: "completarlas" desde el resumen habría DUPLICADO la fila.
 *
 * QUÉ SE COMPRUEBA
 *   1. El backend YA sabe hacer lo correcto con `&area=odt,odl` (D116) — el falso faltante desaparece
 *      y no aparece ninguno nuevo. No hace falta redesplegar el Apps Script.
 *   2. La vista combinada devuelve EXACTAMENTE la unión de ODT y ODL (ni pierde ni añade filas), así
 *      que el Parte de Navision descargado desde ella es el mismo que descargando las dos por separado.
 *   3. El selector de `resumen-asistencia.html` ofrece Todas / Tierras / Drenajes y ya no los sueltos,
 *      y los helpers de vista (dom/fest de D115, aviso del pisado por cuadrilla) siguen dando lo mismo
 *      con el valor combinado que con el suelto.
 *   4. Regresión cero: al admin no le cambia el selector y tierras no se ve afectada.
 *
 * USO: node backend/pruebas/verificar_d135_drenajes_combinado.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'CodigoAsistencias.gs');
const SECRETO = 'secreto-de-prueba-suficientemente-largo-123456';
const HOY = '2026-08-13';   // jueves

/* ---------- datos de prueba ----------
 * PEDRO ODT y ANA ODT están en cuadrillas de ODT (EDUARDO / DUVAN) pero ese día los reportó JAIRO,
 * que es de ODL: es el caso real. LUIS ODL es el simétrico (cuadrilla ODL, reportado por EDUARDO).
 * JUAN TIERRAS está para comprobar que tierras no entra ni sale de esta vista. */
const CUADRILLAS = [
  { cuadrilla:'ANGEL',   responsables:'angel',   area:'',    estado:'' },
  { cuadrilla:'EDUARDO', responsables:'eduardo', area:'odt', estado:'activa' },
  { cuadrilla:'DUVAN',   responsables:'duvan',   area:'odt', estado:'' },
  { cuadrilla:'JAIRO',   responsables:'jairo',   area:'odl', estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'75781', cedula:'1090', nombre:'JUAN TIERRAS', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel',   estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:3, codigo:'80001', cedula:'2200', nombre:'PEDRO ODT',    cargo:'OFICIAL',  cuadrilla:'EDUARDO',
    responsable:'eduardo', estado:'activo', fecha_ingreso:'2026-02-01', fecha_retiro:'' },
  { _row:4, codigo:'80003', cedula:'2202', nombre:'ANA ODT',      cargo:'AYUDANTE', cuadrilla:'DUVAN',
    responsable:'duvan',   estado:'activo', fecha_ingreso:'2026-02-01', fecha_retiro:'' },
  { _row:5, codigo:'80002', cedula:'2201', nombre:'LUIS ODL',     cargo:'OFICIAL',  cuadrilla:'JAIRO',
    responsable:'jairo',   estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' }
];
function filaAsis(fecha, codigo, cuadrilla, o){
  return Object.assign({ id_registro:'x', timestamp:'', fecha, reporta:'angel', cuadrilla, codigo,
    cedula:'', nombre:'', cargo:'', cc:'3701.02.05| EXCAVACION', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }, o);
}
const CC_ODT = '3701.06.01| ALCANTARILLA';
const CC_ODL = '3702.07.01| CUNETA';
const ASISTENCIA = [
  filaAsis(HOY,'75781','ANGEL'),
  // los dos de ODT, reportados DENTRO de la cuadrilla ODL de Jairo (el frente de esa semana)
  filaAsis(HOY,'80001','JAIRO',   { reporta:'jairo',   proyecto:'3702', cc:CC_ODL }),
  filaAsis(HOY,'80003','JAIRO',   { reporta:'jairo',   proyecto:'3702', cc:CC_ODL }),
  // y el simétrico: uno de ODL reportado dentro de una cuadrilla ODT
  filaAsis(HOY,'80002','EDUARDO', { reporta:'eduardo', proyecto:'3701', cc:CC_ODT })
];
const HOJAS = {
  CUADRILLAS, PERSONAL, ASISTENCIA,
  CONFIG:[ { clave:'max_extras_dia', valor:'2' }, { clave:'domfest_tope', valor:'7' },
           { clave:'proyecto_3701', valor:'3701| TM2 SUR UF1' }, { clave:'proyecto_3702', valor:'3702| TM2 SUR UF2' } ],
  FESTIVOS:[], TURNOS:[], CAT_CC:[], CAT_MOTIVOS:[{ string_motivo:'Incapacidad' }],
  MOTIVOS_USADOS:[], NOTAS_CUADRILLA:[], EXTRAS_ADMIN:[],
  CC_USADOS:[ { string_cc:'3701.02.05| EXCAVACION', area:'' },
              { string_cc:CC_ODT, area:'odt' },
              { string_cc:CC_ODL, area:'odl' } ]
};

/* ---------- sandbox de Apps Script (mismo molde que verificar_d119_asistencias_tm2.js) ---------- */
function nuevoContexto(fuenteGs){
  const props = { AUTH_SECRETO: SECRETO, AUTH_V: '1' };
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
    return { nombre, getLastRow(){ return 1; }, getLastColumn(){ return 20; },
      getMaxRows(){ return 1000; }, getMaxColumns(){ return 20; },
      insertRowsAfter(){}, deleteRows(){}, appendRow(){},
      getRange(){ return { setValue(){}, setValues(){}, getValues(){ return []; } }; } };
  };
  ctx.borrarFilas_ = function(){ return 0; };
  return ctx;
}
const ctx = nuevoContexto(fs.readFileSync(RUTA_GS, 'utf8'));

let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
const TOK_ANGIE = () => ctx.emitirToken_('angie', 'asistencia_plus_tm2', ['tierras','odt','odl']);
function get(params){ return JSON.parse(ctx.doGet({ parameter: Object.assign({}, params) }).texto); }
/* D133d — `filas`/`faltantes` de `?action=asistencia` viajan como {cols, datos}. */
function lista(v){
  if(Array.isArray(v)) return v;
  if(v && Array.isArray(v.cols) && Array.isArray(v.datos))
    return v.datos.map(f => { const o={}; v.cols.forEach((c,j)=>{ o[c] = (f[j]==null ? '' : f[j]); }); return o; });
  return [];
}
function sinReportar(area){
  const r = get({ action:'asistencia', token:TOK_ANGIE(), fecha:HOY, area:area });
  if(r.ok !== true) throw new Error('el resumen respondió ok:false con area=' + area);
  return lista(r.faltantes).filter(f => f.tipo === 'sin_reportar').map(f => f.nombre).sort();
}

console.log('\n=== D135 — el resumen de `angie` mira DRENAJES completo (ODT + ODL) ===');

/* ---------------------------------------------------------------- 1 */
console.log('\n1) El bug: mirando UNA sola área salen falsos "sin reportar"');
const soloODT = sinReportar('odt');
const soloODL = sinReportar('odl');
ok(soloODT.indexOf('PEDRO ODT') >= 0 && soloODT.indexOf('ANA ODT') >= 0,
  'en la vista ODT, los dos que reportó JAIRO (ODL) salen como sin reportar — ' + JSON.stringify(soloODT));
ok(soloODL.indexOf('LUIS ODL') >= 0,
  'y en la vista ODL, el que reportó EDUARDO (ODT) también — ' + JSON.stringify(soloODL));
console.log('   (sus filas SÍ están en ASISTENCIA: lo que falla es el cruce, no el dato)');

/* ---------------------------------------------------------------- 2 */
console.log('\n2) La corrección: con la vista combinada `odt,odl` no queda ninguno');
const combinada = sinReportar('odt,odl');
ok(combinada.length === 0, 'cero "sin reportar" en drenajes completo — ' + JSON.stringify(combinada));
ok(sinReportar('').length === 0, 'y tampoco en "Todas" (donde el bug nunca se dio)');

/* ---------------------------------------------------------------- 3 */
console.log('\n3) La vista combinada = la UNIÓN exacta de ODT y ODL (ni pierde ni añade)');
function filasDe(area){
  return lista(get({ action:'asistencia', token:TOK_ANGIE(), fecha:HOY, area:area }).filas)
    .map(f => f.cuadrilla + '|' + f.codigo).sort();
}
const union = filasDe('odt').concat(filasDe('odl')).sort();
ok(JSON.stringify(filasDe('odt,odl')) === JSON.stringify(union),
  'las filas de `odt,odl` son las de ODT más las de ODL, sin duplicados ni ausencias');
ok(filasDe('odt,odl').every(k => k.indexOf('ANGEL') < 0), 'y ninguna de tierras se cuela');
const exp = get({ action:'export', token:TOK_ANGIE(), fecha:HOY, area:'odt,odl' });
ok(exp.ok === true && lista(exp.filas).length === 3,
  'el Parte de Navision de la vista combinada trae las 3 filas de drenajes del día');
ok(lista(exp.filas).every(f => f.cuadrilla !== 'ANGEL'), 'y ninguna de tierras');

/* ---------------------------------------------------------------- 4 */
console.log('\n4) Tierras no se ve afectada');
const tierras = sinReportar('tierras');
ok(tierras.length === 0, 'sigue sin faltantes falsos — ' + JSON.stringify(tierras));
ok(filasDe('tierras').length === 1 && filasDe('tierras')[0].indexOf('ANGEL') === 0,
  'y su vista sigue trayendo solo su fila');

/* ---------------------------------------------------------------- 5: frontend */
console.log('\n5) resumen-asistencia.html — el selector y los helpers de vista');
const RESUMEN = fs.readFileSync(path.join(RAIZ, 'resumen-asistencia.html'), 'utf8');
function fnDe(nombre){
  const m = RESUMEN.match(new RegExp('function\\s+' + nombre + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  if(!m) throw new Error('no se encontró la función ' + nombre + ' en resumen-asistencia.html');
  return m[0];
}
const vista = {};
vm.createContext(vista);
vm.runInContext(['areasFiltro','filtroEsDrenajes','esVistaTierras','usaFlujoDomFest','esVistaDrenajes',
  'opcionesVerComo','etiquetaArea'].map(fnDe).join('\n') + '\nvar STATE={rol:"",areaFiltro:""};', vista);
function conVista(rol, areaFiltro, fn, arg){ vista.STATE = { rol, areaFiltro }; return vista[fn](arg); }

ok(JSON.stringify(conVista('asistencia_plus_tm2','','opcionesVerComo')) === JSON.stringify(['','tierras','odt,odl']),
  'ofrece Todas / Tierras / Drenajes — los sueltos ODT y ODL se retiraron');
ok(conVista('asistencia_plus_tm2','','etiquetaArea','odt,odl') === 'Drenajes (ODT + ODL)',
  'y la opción se llama "Drenajes (ODT + ODL)"');
ok(conVista('asistencia_plus_tm2','odt,odl','esVistaDrenajes') === true,
  'esVistaDrenajes = true (le llega el aviso del pisado por cuadrilla en dom/fest, D115)');
ok(conVista('asistencia_plus_tm2','odt,odl','usaFlujoDomFest') === true,
  'usaFlujoDomFest = true (guía de dom/fest y export sin el aviso de "sin reportar")');
ok(conVista('asistencia_plus_tm2','odt,odl','esVistaTierras') === false,
  'esVistaTierras = false (la fila de extras del admin, D73, es de tierras y no entra en este Parte)');
ok(conVista('asistencia_plus_tm2','odt,odl','filtroEsDrenajes') === true, 'filtroEsDrenajes = true');
console.log('   · regresión cero para los demás roles:');
ok(JSON.stringify(conVista('admin','','opcionesVerComo')) === JSON.stringify(['','tierras','odt','odl','odt,odl','uf3']),
  'el selector del admin no cambia (D116): conserva ODT y ODL sueltos y `uf3`');
ok(conVista('residente_dren','','opcionesVerComo') === null, 'residente_dren sigue sin selector (su rol ya es ODT+ODL)');
ok(conVista('duvan','','opcionesVerComo') === null, 'duvan sigue sin selector');
ok(conVista('asistencia_plus_tm2','tierras','esVistaDrenajes') === false, 'en Tierras no se le da el aviso de drenajes');
ok(conVista('asistencia_plus_tm2','tierras','esVistaTierras') === true, 'y en Tierras el Parte sí lleva las extras del admin');

console.log(fallos ? ('\n❌ ' + fallos + ' comprobación(es) en rojo\n') : '\n✅ Todo correcto\n');
process.exit(fallos ? 1 : 0);

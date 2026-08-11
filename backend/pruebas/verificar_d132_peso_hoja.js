#!/usr/bin/env node
/**
 * Verificación de las herramientas de D132 — "el Sheet de asistencias no abre, se queda cargando".
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Las tres funciones nuevas se ejecutan a mano sobre el archivo REAL y dos
 * de ellas BORRAN (`limpiarDuplicadosTodo`, `compactarGrilla`). No hay forma de ensayarlas en campo: se
 * corren cuando el archivo ya está inutilizable. Así que se ensayan aquí, con la misma hoja falsa de
 * `verificar_upsert_asistencia.js` (semántica 1-based real de getRange/deleteRows/deleteColumns).
 *
 * QUÉ COMPRUEBA:
 *   1. `_borrarConPresupuesto_` borra EXACTAMENTE las filas pedidas y ninguna más — el punto delicado
 *      es que borra de abajo hacia arriba en tramos contiguos.
 *   2. Que cortar a la mitad por tiempo es SEGURO: una pasada con presupuesto corto deja filas
 *      pendientes, y volver a ejecutar termina el trabajo con el mismo resultado que una pasada larga.
 *      Es la garantía de que la hoja no queda a medias ni se borra la fila equivocada.
 *   3. `limpiarDuplicadosTodo` conserva la fila MÁS RECIENTE de cada persona-día en todo el histórico,
 *      leyendo solo 6 de las 17 columnas, y NO toca las filas sin fecha válida (D106) ni las que no
 *      tienen ni código ni cédula.
 *   4. `compactarGrilla` recorta solo rejilla VACÍA: nunca por debajo de los datos ni de los
 *      encabezados que el código define para la hoja.
 *   5. `diagnosticoPeso` no lee ni una celda de datos (es lo que le permite correr sobre un archivo
 *      desbocado) y suma bien la rejilla.
 *
 * USO: node backend/pruebas/verificar_d132_peso_hoja.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
const GS = fs.readFileSync(path.join(RAIZ, 'backend', 'CodigoAsistencias.gs'), 'utf8');

const H = ['id_registro','timestamp','fecha','reporta','cuadrilla','codigo','cedula','nombre','cargo',
           'cc','proyecto','hora_entrada','hora_salida','presente','motivo_ausencia','observacion','turno'];

/* ---------- hoja falsa con la semántica de Apps Script (1-based, filas reales) ---------- */
function HojaFalsa(nombre, cabecera, filas, opciones){
  const o = opciones || {};
  this.nombre = nombre;
  this.data = [cabecera.slice()].concat(filas.map(function(r){ return r.slice(); }));
  this.maxRows = o.maxRows || Math.max(1000, this.data.length);
  this.maxCols = o.maxCols || cabecera.length;
  this.celdasLeidas = 0;
}
HojaFalsa.prototype.getLastRow    = function(){ return this.data.length; };
HojaFalsa.prototype.getLastColumn = function(){
  let ancho = 0;
  this.data.forEach(function(r){
    for(let j = r.length - 1; j >= 0; j--){ if(r[j] !== '' && r[j] != null){ ancho = Math.max(ancho, j + 1); break; } }
  });
  return ancho;
};
HojaFalsa.prototype.getMaxRows    = function(){ return this.maxRows; };
HojaFalsa.prototype.getMaxColumns = function(){ return this.maxCols; };
HojaFalsa.prototype.getName       = function(){ return this.nombre; };
HojaFalsa.prototype.getConditionalFormatRules = function(){ return []; };
HojaFalsa.prototype.deleteRows    = function(ini, n){ this.data.splice(ini - 1, n); this.maxRows -= n; };
HojaFalsa.prototype.deleteColumns = function(ini, n){
  this.data.forEach(function(r){ r.splice(ini - 1, n); });
  this.maxCols -= n;
};
HojaFalsa.prototype.insertRowsAfter    = function(_a, n){ this.maxRows += n; };
HojaFalsa.prototype.insertColumnsAfter = function(_a, n){ this.maxCols += n; };
HojaFalsa.prototype.appendRow     = function(fila){ this.data.push(fila.slice()); };
HojaFalsa.prototype.clearContents = function(){ this.data = [this.data[0]]; };
HojaFalsa.prototype.getRange = function(fila, col, nFilas, nCols){
  const sh = this; nFilas = nFilas || 1; nCols = nCols || 1;
  sh.celdasLeidas += nFilas * nCols;
  return {
    getValues: function(){
      const out = [];
      for(let i = 0; i < nFilas; i++){
        const r = sh.data[fila - 1 + i], linea = [];
        for(let j = 0; j < nCols; j++) linea.push(r ? (r[col - 1 + j] === undefined ? '' : r[col - 1 + j]) : '');
        out.push(linea);
      }
      return out;
    },
    setValues: function(vals){
      for(let i = 0; i < vals.length; i++){
        while(sh.data.length < fila + i) sh.data.push(new Array(sh.maxCols).fill(''));
        for(let j = 0; j < vals[i].length; j++) sh.data[fila - 1 + i][col - 1 + j] = vals[i][j];
      }
      return this;
    },
    setValue: function(v){
      while(sh.data.length < fila) sh.data.push(new Array(sh.maxCols).fill(''));
      sh.data[fila - 1][col - 1] = v; return this;
    }
  };
};

/* `ahora` (opcional) sustituye a Date.now para poder cortar el borrado por presupuesto de tiempo. */
function sandbox(hojas, ahora){
  const ss = {
    getSheetByName: function(nom){ return hojas[nom] || null; },
    insertSheet:    function(nom){ hojas[nom] = new HojaFalsa(nom, [], []); return hojas[nom]; },
    getSheets:      function(){ return Object.keys(hojas).map(function(k){ return hojas[k]; }); }
  };
  const Real = Date;
  function FechaFalsa(){ return new Real(arguments[0], arguments[1], arguments[2]); }
  FechaFalsa.now   = ahora || Real.now;
  FechaFalsa.parse = Real.parse;
  const ctx = {
    console, Date: ahora ? FechaFalsa : Date, Math, JSON, Number, String, Array, Object,
    isNaN, parseFloat, parseInt, RegExp, Error,
    SpreadsheetApp:{ openById(){ return ss; }, flush(){} },
    Utilities:{ getUuid(){ return 'uuid'; }, formatDate(){ return '2026-08-01'; } },
    Logger:{ log(){} },
    ContentService:{ createTextOutput(t){ return { texto:t, setMimeType(){ return this; } }; }, MimeType:{ JSON:'JSON', TEXT:'TEXT' } },
    PropertiesService:{ getScriptProperties(){ return { getProperty(){ return null; }, setProperty(){} }; } },
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, putAll(){}, getAll(){ return {}; }, remove(){}, removeAll(){} }; } },
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(GS, ctx, { filename:'CodigoAsistencias.gs' });
  return ctx;
}

let fallos = 0;
function ok(cond, titulo, detalle){
  if(!cond) fallos++;
  console.log('  ' + (cond ? '✓' : '✗') + ' ' + titulo + (detalle ? '   ' + detalle : ''));
}

/* fila de ASISTENCIA: el `id_registro` sirve de etiqueta para saber cuál sobrevivió */
function fila(id, o){
  // OJO con `||` en `fecha`: los casos de prueba usan la cadena vacía a propósito (fila huérfana de D106).
  return [id, o.ts || new Date(2026, 7, 1, 8, 0), o.fecha === undefined ? '2026-08-01' : o.fecha, 'duvan',
          o.cuadrilla || 'ENRIQUE', o.codigo === undefined ? '76333' : o.codigo,
          o.cedula === undefined ? '123' : o.cedula, o.nombre || 'JUAN', 'AYUDANTE',
          '3701.07.01', '3701', '07:00', '15:30', 'Si', '', '', '1'];
}
function ids(sh){ return sh.data.slice(1).map(function(r){ return r[0]; }); }

/* ============ 1 y 2 · borrado por tramos, con y sin corte por tiempo ============ */
console.log('\n=== D132 · borrado en tramos contiguos, de abajo hacia arriba ===');
{
  const filas = [];
  for(let i = 1; i <= 10; i++) filas.push(fila('F' + i, { codigo: String(i) }));
  const sh = new HojaFalsa('ASISTENCIA', H, filas);
  const ctx = sandbox({ ASISTENCIA: sh });
  // filas de hoja 3,4,5 y 9  =>  ids F2,F3,F4 y F8 (la fila 1 es el encabezado)
  const r = ctx._borrarConPresupuesto_(sh, [4, 3, 5, 9], 60000);
  ok(r.borradas === 4 && r.pendientes === 0, 'borra las 4 pedidas, 0 pendientes',
     '(' + r.borradas + '/' + r.pendientes + ')');
  ok(ids(sh).join(',') === 'F1,F5,F6,F7,F9,F10', 'sobreviven exactamente las demás', ids(sh).join(','));
}
{
  const filas = [];
  for(let i = 1; i <= 10; i++) filas.push(fila('F' + i, { codigo: String(i) }));
  const sh = new HojaFalsa('ASISTENCIA', H, filas);
  const ctx = sandbox({ ASISTENCIA: sh }, function(){ return 0; });
  const r = ctx._borrarConPresupuesto_(sh, [3, 4, 9], -1);   // presupuesto agotado antes de empezar
  ok(r.borradas === 0 && r.pendientes === 3, 'presupuesto agotado: no borra nada y las cuenta todas',
     '(' + r.borradas + '/' + r.pendientes + ')');
  ok(ids(sh).length === 10, 'la hoja queda intacta');
}
{
  // Corte A MITAD: el reloj avanza 200 s por consulta, presupuesto 250 s => cae tras el primer tramo.
  const filas = [];
  for(let i = 1; i <= 10; i++) filas.push(fila('F' + i, { codigo: String(i) }));
  const sh = new HojaFalsa('ASISTENCIA', H, filas);
  let t = 0;
  const ctx = sandbox({ ASISTENCIA: sh }, function(){ const v = t; t += 200000; return v; });
  const objetivo = [3, 4, 9];                       // ids F2,F3,F8
  const r1 = ctx._borrarConPresupuesto_(sh, objetivo, 250000);
  ok(r1.borradas > 0 && r1.pendientes > 0, 'pasada 1 corta a mitad',
     'borradas ' + r1.borradas + ', pendientes ' + r1.pendientes);
  ok(ids(sh).indexOf('F8') < 0, 'lo borrado fue lo de ABAJO (F8), que es lo que no corre números');
  // Segunda pasada: las pendientes conservan su número de fila porque estaban por encima.
  const ctx2 = sandbox({ ASISTENCIA: sh });
  const r2 = ctx2._borrarConPresupuesto_(sh, [3, 4], 60000);
  ok(r2.borradas === 2 && r2.pendientes === 0, 'pasada 2 termina el trabajo');
  ok(ids(sh).join(',') === 'F1,F4,F5,F6,F7,F9,F10', 'resultado idéntico al de una sola pasada larga',
     ids(sh).join(','));
}

/* ============ 3 · limpiarDuplicadosTodo sobre el histórico completo ============ */
console.log('\n=== D132 · limpieza de duplicados de TODO el histórico ===');
{
  const T = function(h){ return new Date(2026, 7, 1, h, 0); };
  const filas = [
    fila('a1', { fecha:'2026-08-01', codigo:'100', ts:T(8) }),
    fila('a2', { fecha:'2026-08-01', codigo:'100', ts:T(9) }),      // más reciente: se queda
    fila('b1', { fecha:'2026-08-01', codigo:'200', ts:T(8) }),      // única: se queda
    fila('c1', { fecha:'2026-08-02', codigo:'100', ts:T(8) }),
    fila('c2', { fecha:'2026-08-02', codigo:'100', ts:T(9) }),
    fila('c3', { fecha:'2026-08-02', codigo:'100', ts:T(10) }),     // más reciente: se queda
    fila('d1', { fecha:'',           codigo:'300', ts:T(8) }),      // sin fecha (D106): intacta
    fila('d2', { fecha:'',           codigo:'300', ts:T(9) }),      // intacta
    fila('e1', { fecha:'2026-08-03', codigo:'',  cedula:'', ts:T(8) }),  // sin identificador: intacta
    fila('e2', { fecha:'2026-08-03', codigo:'',  cedula:'', ts:T(9) }),  // intacta
    fila('f1', { fecha:'2026-08-04', codigo:'',  cedula:'999', ts:T(8) }),
    fila('f2', { fecha:'2026-08-04', codigo:'',  cedula:'999', ts:T(9) })  // por cédula: se queda
  ];
  const sh = new HojaFalsa('ASISTENCIA', H, filas);
  const ctx = sandbox({ ASISTENCIA: sh });

  const seco = ctx.limpiarDuplicadosTodo(false);
  ok(seco.sobrantes === 4 && seco.aplicado === false, 'simulación: 4 sobrantes y no borra nada',
     'sobrantes ' + seco.sobrantes + ', filas ' + (sh.data.length - 1));
  ok(sh.data.length - 1 === 12, 'la hoja sigue con sus 12 filas tras la simulación');

  const antes = sh.celdasLeidas;
  const r = ctx.limpiarDuplicadosTodo(true);
  ok(r.borradas === 4, 'aplicado: borra 4', 'borradas ' + r.borradas);
  ok(ids(sh).join(',') === 'a2,b1,c3,d1,d2,e1,e2,f2', 'se queda la más reciente de cada persona-día',
     ids(sh).join(','));
  ok(antes > 0, 'la lectura pasó por getRange (contabilizada)');

  // Idempotencia: volver a correrla no encuentra nada.
  const ctx2 = sandbox({ ASISTENCIA: sh });
  const r2 = ctx2.limpiarDuplicadosTodo(true);
  ok(r2.sobrantes === 0, 'segunda ejecución: ya no hay sobrantes');
}
{
  // Lee 6 columnas, no las 17: es lo que le permite correr sobre una hoja desbocada.
  const filas = [];
  for(let i = 1; i <= 50; i++) filas.push(fila('F' + i, { codigo: String(i) }));
  const sh = new HojaFalsa('ASISTENCIA', H, filas);
  const ctx = sandbox({ ASISTENCIA: sh });
  sh.celdasLeidas = 0;
  ctx.limpiarDuplicadosTodo(false);
  ok(sh.celdasLeidas <= 50 * 6 + H.length, 'lee ~6 columnas de 17',
     sh.celdasLeidas + ' celdas para 50 filas (17 columnas serían ' + (50 * 17) + ')');
}

/* ============ 4 · compactarGrilla ============ */
console.log('\n=== D132 · recorte de la rejilla vacía ===');
{
  // 60.000 filas de rejilla con 100 de datos, y 40 columnas con 17 de encabezado.
  const filas = [];
  for(let i = 1; i <= 100; i++) filas.push(fila('F' + i, { codigo: String(i) }));
  const sh = new HojaFalsa('ASISTENCIA', H, filas, { maxRows: 60000, maxCols: 40 });
  const ctx = sandbox({ ASISTENCIA: sh });

  const seco = ctx.compactarGrilla(false);
  ok(seco.aplicado === false && sh.getMaxRows() === 60000, 'simulación: no toca la rejilla');
  ok(seco.celdas > 2000000, 'reporta las celdas que liberaría', seco.celdas + ' celdas');

  ctx.compactarGrilla(true);
  ok(sh.getMaxRows() === 101 + 200, 'deja los datos + el colchón de 200 filas', 'maxRows ' + sh.getMaxRows());
  ok(sh.getMaxColumns() === 17, 'recorta hasta el ancho de los encabezados', 'maxCols ' + sh.getMaxColumns());
  ok(sh.data.length - 1 === 100 && ids(sh)[99] === 'F100', 'no perdió ni una fila de datos');
  ok(sh.data[1].length === 17, 'no perdió ni una columna de datos');
}
{
  // Hoja ya ajustada: no debe tocarla.
  const sh = new HojaFalsa('CONFIG', ['clave','valor'], [['proyecto_3701','X']], { maxRows: 100, maxCols: 2 });
  const ctx = sandbox({ CONFIG: sh });
  const r = ctx.compactarGrilla(true);
  ok(r.hojas === 0 && sh.getMaxRows() === 100 && sh.getMaxColumns() === 2, 'hoja sin sobrante: intacta');
}

/* ============ 5 · diagnosticoPeso ============ */
console.log('\n=== D132 · peso del archivo ===');
{
  const a = new HojaFalsa('ASISTENCIA', H, [fila('F1', {})], { maxRows: 200000, maxCols: 17 });
  const c = new HojaFalsa('CONFIG', ['clave','valor'], [['k','v']], { maxRows: 1000, maxCols: 2 });
  const ctx = sandbox({ ASISTENCIA: a, CONFIG: c });
  a.celdasLeidas = 0; c.celdasLeidas = 0;
  const r = ctx.diagnosticoPeso();
  ok(a.celdasLeidas === 0 && c.celdasLeidas === 0, 'NO lee ni una celda de datos (solo metadatos)');
  ok(r.total === 200000 * 17 + 1000 * 2, 'suma bien la rejilla de todas las hojas', r.total + ' celdas');
  ok(r.hojas[0].nombre === 'ASISTENCIA', 'ordena por peso, la más pesada primero');
  ok(r.vacias > 3000000, 'separa lo vacío de lo usado', r.vacias + ' celdas vacías');
}

console.log('\n' + (fallos ? '✗ ' + fallos + ' comprobación(es) fallida(s)' : '✓ todo correcto') + '\n');
process.exit(fallos ? 1 : 0);

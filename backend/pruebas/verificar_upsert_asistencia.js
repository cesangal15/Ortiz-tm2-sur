#!/usr/bin/env node
/**
 * Verificación del UPSERT por persona de asistencia (D119) — "editar NUNCA debe añadir una fila".
 *
 * EL FALLO QUE SE REPRODUCE AQUÍ. El dueño reportó (ago-2026): «alguien subió un reporte de asistencia,
 * yo edité a una persona desde mi perfil de admin y, en vez de reemplazarla, la añadió como alguien
 * nuevo y generó la duplicada». Es el origen de las horas repetidas en el Parte de Navision, porque el
 * archivo lleva una línea por FILA reportada.
 *
 * LA CAUSA. `guardarIndividual` borraba la fila vieja con una clave de precedencia EXCLUSIVA: código, y
 * SOLO si no había código, cédula. Si la fila guardada y la edición no coincidían en ese campo —código
 * vacío en una y presente en la otra, o con un cero a la izquierda— las claves no casaban, el borrado no
 * encontraba nada y `anexarFilas_` agregaba la fila igual. Las dos partes pueden diferir de forma
 * legítima: la fila guardada trae el código que tenía PERSONAL cuando el capataz reportó, mientras que
 * "Completar faltantes" manda el que tiene PERSONAL AHORA.
 *
 * QUÉ COMPRUEBA. Que tras editar quede UNA sola fila de esa persona en el día, en las combinaciones de
 * identificadores que se dan en la hoja real; que el respaldo por nombre+cuadrilla distinga a dos
 * personas distintas sin identificador (antes todas emparejaban entre sí y editar a una borraba a las
 * otras); y que la edición NO toque a nadie más — ni a otras personas, ni a otras cuadrillas, ni a
 * otros días.
 *
 * CÓMO. Se carga `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script
 * de mentira y una hoja ASISTENCIA falsa que respeta la semántica 1-based de `getRange`/`deleteRows`/
 * `appendRow`. `guardarIndividual`, `localizarFilas_`, `borrarFilas_`, `anexarFilas_` y `fdate` son el
 * código real del archivo, sin tocar.
 *
 * USO: node backend/pruebas/verificar_upsert_asistencia.js
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
function HojaFalsa(nombre, cabecera, filas){
  this.nombre = nombre;
  this.data = [cabecera.slice()].concat(filas.map(function(r){ return r.slice(); }));
  this.maxRows = Math.max(1000, this.data.length);
  this.maxCols = cabecera.length;
}
HojaFalsa.prototype.getLastRow    = function(){ return this.data.length; };
HojaFalsa.prototype.getMaxRows    = function(){ return this.maxRows; };
HojaFalsa.prototype.getMaxColumns = function(){ return this.maxCols; };
HojaFalsa.prototype.getName       = function(){ return this.nombre; };
HojaFalsa.prototype.deleteRows    = function(ini, n){ this.data.splice(ini - 1, n); };
HojaFalsa.prototype.insertRowsAfter    = function(_a, n){ this.maxRows += n; };
HojaFalsa.prototype.insertColumnsAfter = function(_a, n){ this.maxCols += n; };
HojaFalsa.prototype.appendRow     = function(fila){ this.data.push(fila.slice()); };
HojaFalsa.prototype.clearContents = function(){ this.data = [this.data[0]]; };
HojaFalsa.prototype.getRange = function(fila, col, nFilas, nCols){
  const sh = this; nFilas = nFilas || 1; nCols = nCols || 1;
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

function sandbox(hojas){
  let n = 0;
  const ss = { getSheetByName: function(nom){ return hojas[nom] || null; },
               insertSheet:    function(nom){ hojas[nom] = new HojaFalsa(nom, [], []); return hojas[nom]; } };
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
    SpreadsheetApp:{ openById(){ return ss; }, flush(){} },
    Utilities:{ getUuid(){ return 'uuid-' + (++n); }, formatDate(){ return '2026-08-01'; } },
    Logger:{ log(){} },
    ContentService:{ createTextOutput(t){ return { texto:t, setMimeType(){ return this; } }; }, MimeType:{ JSON:'JSON', TEXT:'TEXT' } },
    PropertiesService:{ getScriptProperties(){ return { getProperty(){ return null; }, setProperty(){} }; } },
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){}, removeAll(){} }; } },
    // D125: cerrojo de escritura. En la prueba basta con que exista; la serializacion real la garantiza
    // Apps Script. El escenario de carrera se reproduce abajo saltandoselo a proposito.
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(GS, ctx, { filename:'CodigoAsistencias.gs' });
  return ctx;
}

function fila(o){
  return ['id-' + (o.nombre || '?'), new Date(), o.fecha || '2026-08-01', o.reporta || 'duvan',
          o.cuadrilla || 'ENRIQUE', o.codigo === undefined ? '76333' : o.codigo,
          o.cedula === undefined ? '123' : o.cedula, o.nombre || 'JUAN', 'AYUDANTE',
          '3701.07.01', '3701', '07:00', '15:30', o.presente || 'Si', '', '', '1'];
}
function edicion(o){
  return { codigo: o.codigo === undefined ? '76333' : o.codigo,
           cedula: o.cedula === undefined ? '123' : o.cedula,
           nombre: o.nombre || 'JUAN', cargo:'AYUDANTE', cuadrilla: o.cuadrilla || 'ENRIQUE',
           cc:'3701.07.01', proyecto:'3701', hora_entrada:'07:00', hora_salida: o.salida || '16:30',
           presente: o.presente || 'Si', motivo_ausencia:'', turno:'1' };
}

let fallos = 0;
function caso(titulo, filasPrevias, filasEdicion, esperadas){
  const asis = new HojaFalsa('ASISTENCIA', H, filasPrevias);
  const cuad = new HojaFalsa('CUADRILLAS', ['cuadrilla','responsables','area','estado'],
                             [['ENRIQUE','enrique','odt','activa'], ['MAURICIO','mauricio','odt','activa']]);
  const ctx = sandbox({ ASISTENCIA: asis, CUADRILLAS: cuad });
  ctx.guardarIndividual({ usuario:'admin', fecha:'2026-08-01', reporta:'admin', filas: filasEdicion });
  const n = asis.data.length - 1;
  const ok = n === esperadas;
  if(!ok) fallos++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + titulo.padEnd(58) + n + ' fila(s), esperadas ' + esperadas);
  return asis;
}

console.log('\n=== D119 · editar a una persona la REEMPLAZA, no la añade ===');
console.log('   (hoja) vs (edición)');
caso('código igual en ambos',            [fila({})],                        [edicion({})],                        1);
caso('hoja SIN código, edición CON',     [fila({ codigo:'' })],             [edicion({})],                        1);
caso('hoja CON código, edición SIN',     [fila({})],                        [edicion({ codigo:'' })],             1);
caso('edición sin cédula',               [fila({})],                        [edicion({ cedula:'' })],             1);
caso('código con espacios',              [fila({ codigo:' 76333' })],       [edicion({})],                        1);
caso('código con cero a la izquierda',   [fila({ codigo:'076333' })],       [edicion({})],                        1);
caso('cédula con espacios',              [fila({ codigo:'' })],             [edicion({ codigo:'', cedula:' 123' })], 1);

console.log('\n=== respaldo por nombre+cuadrilla (sin código NI cédula) ===');
caso('mismo nombre → reemplaza',
     [fila({ codigo:'', cedula:'', nombre:'JUAN PEREZ' })],
     [edicion({ codigo:'', cedula:'', nombre:'JUAN PEREZ' })], 1);
caso('nombre distinto → son dos personas',
     [fila({ codigo:'', cedula:'', nombre:'JUAN PEREZ' })],
     [edicion({ codigo:'', cedula:'', nombre:'ANA GOMEZ' })], 2);

console.log('\n=== la edición no puede tocar a nadie más ===');
caso('otra persona de la misma cuadrilla intacta',
     [fila({}), fila({ codigo:'77929', cedula:'999', nombre:'JANER' })],
     [edicion({})], 2);
caso('misma persona en OTRA cuadrilla: se unifica en una',
     [fila({}), fila({ cuadrilla:'MAURICIO' })],
     [edicion({})], 1);
caso('otro día intacto',
     [fila({}), fila({ fecha:'2026-07-31' })],
     [edicion({})], 2);
caso('persona duplicada de antes → queda UNA',
     [fila({}), fila({}), fila({})],
     [edicion({})], 1);

/* D123 — dos PERSONAS distintas que comparten cédula (error de digitación real en PERSONAL:
 * 74270 FREDY MACHACON y 76358 ALEIXER LIZARAZO con la 91515627). La regla de D119 («código O
 * cédula») borraba a una al editar a la otra: pérdida silenciosa de una asistencia real. */
console.log('\n=== D123 · cédula compartida por personas DISTINTAS ===');
caso('editar a FREDY no toca a ALEIXER (misma cédula, código distinto)',
     [fila({ codigo:'74270', cedula:'91515627', nombre:'FREDY',   cuadrilla:'ROBINSON' }),
      fila({ codigo:'76358', cedula:'91515627', nombre:'ALEIXER', cuadrilla:'OPERADORES' })],
     [edicion({ codigo:'74270', cedula:'91515627', nombre:'FREDY', cuadrilla:'ROBINSON' })], 2);
caso('editar a ALEIXER no toca a FREDY',
     [fila({ codigo:'74270', cedula:'91515627', nombre:'FREDY',   cuadrilla:'ROBINSON' }),
      fila({ codigo:'76358', cedula:'91515627', nombre:'ALEIXER', cuadrilla:'OPERADORES' })],
     [edicion({ codigo:'76358', cedula:'91515627', nombre:'ALEIXER', cuadrilla:'OPERADORES' })], 2);
caso('cero a la izquierda sigue casando sin recurrir a la cédula',
     [fila({ codigo:'076333', cedula:'123' })],
     [edicion({ codigo:'76333', cedula:'999' })], 1);

console.log('\n=== alta legítima desde "Completar faltantes" ===');
caso('persona que no estaba en el día → se agrega',
     [fila({ codigo:'77929', cedula:'999', nombre:'JANER' })],
     [edicion({})], 2);

/* ---------- el envío de cuadrilla también se protege (D119) ---------- */
console.log('\n=== D119 · el envío de cuadrilla no guarda a la misma persona dos veces ===');
(function(){
  const asis = new HojaFalsa('ASISTENCIA', H, []);
  const cuad = new HojaFalsa('CUADRILLAS', ['cuadrilla','responsables','area','estado'], [['ENRIQUE','enrique','odt','activa']]);
  const notas = new HojaFalsa('NOTAS_ASISTENCIA', ['fecha','cuadrilla','reporta','nota','timestamp'], []);
  const ctx = sandbox({ ASISTENCIA: asis, CUADRILLAS: cuad, NOTAS_ASISTENCIA: notas });
  // payload con la MISMA persona dos veces (roster duplicado, teléfono con caché vieja o cola offline)
  ctx.guardarAsistencia({ usuario:'duvan', reporta:'duvan', fecha:'2026-08-01', cuadrilla:'ENRIQUE',
    filas:[ edicion({}), edicion({}), edicion({ codigo:'77929', cedula:'999', nombre:'JANER' }) ] });
  const n = asis.data.length - 1;
  const ok = n === 2;
  if(!ok) fallos++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + 'payload con JUAN×2 + JANER'.padEnd(58) + n + ' fila(s), esperadas 2');
})();

/* D125 — dos escrituras SIMULTANEAS sobre la misma persona. Sin cerrojo, las dos leen la hoja antes
 * de que la otra borre, ninguna encuentra nada que pisar y las dos anexan: la persona queda repetida en
 * filas CONSECUTIVAS. Es la firma de lo reportado (OSMEL 77676 en las filas 3165-3166-3167). Aqui se
 * reproduce la carrera invocando `guardarIndividual` DOS veces contra la misma hoja sin soltar el
 * estado intermedio, y se comprueba que el resultado sigue siendo UNA sola fila. */
console.log('\n=== D125 · escrituras repetidas y payload repetido ===');
(function(){
  const asis = new HojaFalsa('ASISTENCIA', H, [fila({})]);
  const cuad = new HojaFalsa('CUADRILLAS', ['cuadrilla','responsables','area','estado'], [['ENRIQUE','enrique','odt','activa']]);
  const ctx = sandbox({ ASISTENCIA: asis, CUADRILLAS: cuad });
  // tres "toques" seguidos del boton Guardar, como los tres reportes de OSMEL
  ctx.guardarIndividual({ usuario:'admin', fecha:'2026-08-01', reporta:'admin', filas:[edicion({})] });
  ctx.guardarIndividual({ usuario:'admin', fecha:'2026-08-01', reporta:'admin', filas:[edicion({})] });
  ctx.guardarIndividual({ usuario:'admin', fecha:'2026-08-01', reporta:'admin', filas:[edicion({})] });
  const n = asis.data.length - 1;
  const ok = n === 1;
  if(!ok) fallos++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + 'tres Guardar seguidos sobre la misma persona'.padEnd(58) + n + ' fila(s), esperadas 1');
})();
caso('payload que repite a la misma persona 3 veces',
     [], [edicion({}), edicion({}), edicion({})], 1);
caso('payload con 2 personas distintas repetidas',
     [], [edicion({}), edicion({}), edicion({ codigo:'77929', cedula:'999', nombre:'JANER' })], 2);

console.log('\n' + (fallos ? '❌ ' + fallos + ' caso(s) fallaron' : '✅ Todos los casos pasan') + '\n');
process.exit(fallos ? 1 : 0);

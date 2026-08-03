#!/usr/bin/env node
/**
 * Verificación de NO-REGRESIÓN del refactor D112 — el Parte de Navision, celda a celda.
 *
 * QUÉ COMPRUEBA. D112 sacó el clasificador de horas de dentro de `resumen-asistencia.html` a un archivo
 * compartido (`horas-nomina.js`) para que `horas-persona.html` calcule EXACTAMENTE lo mismo que el
 * generador del Parte. El movimiento tenía que ser literal: ni una línea de lógica distinta. Este arnés
 * lo demuestra en vez de afirmarlo.
 *
 * CÓMO. Carga DOS veces el generador y compara sus salidas:
 *   · ANTES  = `resumen-asistencia.html` tal como está en git ANTES del refactor (se saca con
 *              `git show <ref>:resumen-asistencia.html`, no de una transcripción a mano — una copia
 *              tecleada podría "corregir" sin querer justo lo que se quiere verificar).
 *   · DESPUÉS= el `horas-nomina.js` de hoy + el `resumen-asistencia.html` de hoy.
 * Los dos se evalúan en su propio sandbox de `vm` (con los mínimos stubs de navegador que el script
 * necesita para cargarse) y se comparan **celda a celda** las 18 columnas A–R que `buildParteRow`
 * escribe en la hoja `Parte`, sobre una batería de casos.
 *
 * POR QUÉ UN BANCO DE PRUEBAS EN NODE Y NO EL SHEET REAL. Este entorno no tiene acceso al Google Sheet
 * de asistencias ni al Apps Script desplegado. Hay precedente exacto: D99 verificó así 21 respuestas y
 * D102 otras 612. La entrada de `buildParteRow` es puramente la fila cruda + CONFIG/FESTIVOS/TURNOS —
 * lo mismo que devuelve `?action=export` —, así que reproducirla en Node cubre el cálculo completo; lo
 * único que no cubre es SheetJS escribiendo el .xlsx, que el refactor no toca.
 *
 * USO:  node backend/pruebas/verificar_refactor_horas.js [ref-git-del-antes]
 *       (por defecto usa el commit anterior al refactor que encuentre en el historial de la rama).
 * Salida: 0 si TODAS las celdas coinciden; 1 si hay una sola diferencia (con el caso que la produce).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');

/* ---------- carga de una versión del generador en su propio sandbox ---------- */
// El <script> de la página se evalúa tal cual; solo hace falta que existan los objetos que TOCA al
// cargarse (window.onload = …). Nada de DOM real: no se llama a ninguna función que lo use.
function sandbox(){
  const ctx = {
    console,
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    navigator:{},
    performance:{ now(){ return 0; } },
    setTimeout, clearTimeout,
    Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt,
    Blob:function(){}, URL:{ createObjectURL(){ return ''; }, revokeObjectURL(){} }
  };
  ctx.window = ctx;
  ctx.document = { createElement(){ return { style:{} }; }, getElementById(){ return null; },
    head:{ appendChild(){} }, body:{ appendChild(){}, removeChild(){} }, querySelectorAll(){ return []; } };
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}
// Todos los <script> EN LÍNEA de un HTML (los que llevan src se cargan aparte, a propósito: así el
// arnés falla si alguien olvida incluir `horas-nomina.js` en la página).
function scriptsEnLinea(html){
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}
function cargarVersion(nombre, piezas){
  const ctx = sandbox();
  piezas.forEach(function(src, i){
    try{ vm.runInContext(src, ctx, { filename: nombre + '#' + i }); }
    catch(err){ throw new Error('No se pudo evaluar ' + nombre + ' (pieza ' + i + '): ' + err.message); }
  });
  ['clasificarHoras','turnoRowFor','tipoJornadaDeFecha','buildParteRow','buildAdminExtraRow'].forEach(function(f){
    if(typeof ctx[f] !== 'function') throw new Error(nombre + ': falta la función ' + f + ' (¿se cargó horas-nomina.js?)');
  });
  return ctx;
}

function refAnterior(argv){
  if(argv[2]) return argv[2];
  // Commit anterior al refactor = el último que todavía tenía el clasificador dentro del HTML.
  const log = execSync('git log --format=%H -n 40 -- resumen-asistencia.html', { cwd: RAIZ }).toString().trim().split('\n');
  for(const sha of log){
    const html = execSync('git show ' + sha + ':resumen-asistencia.html', { cwd: RAIZ }).toString();
    if(html.indexOf('function clasificarHoras(') >= 0) return sha;
  }
  throw new Error('No se encontró en el historial una versión de resumen-asistencia.html con el clasificador dentro.');
}

/* ---------- datos de entrada (los mismos para las dos versiones) ---------- */
// CONFIG como la del Sheet vivo (D72/D77/D81): jornada estándar, ventana nocturna y topes.
const CONFIG = {
  entrada_lv:'07:00', salida_lv:'15:30', almuerzo_ini:'12:00', almuerzo_fin:'13:00',
  entrada_sab:'07:00', salida_sab:'11:30', entrada_dom:'07:00', salida_dom:'15:00',
  ord_lun_vie:'7.5', ord_sabado:'4.5', ord_domingo:'0',
  nocturno_desde:'19:00', nocturno_hasta:'06:00', max_extras_dia:'2', domfest_tope:'7',
  proyecto_3701:'3701| T2 - UF1 - R4513 PR 09+800 - PR 30+000',
  admin_recurso:'99999| ADMIN PRUEBA'
};
// TURNOS: el diurno T1 y los nocturnos T2–T5, con y sin variante de sábado/viernes, para ejercitar
// `turnoRowFor` en sus cuatro ramas (sabado / viernes / lj / lv) y el cruce de medianoche.
const TURNOS = [
  { turno:'1', tipo_dia:'lj',      entrada:'07:00', salida:'15:30', descanso_ini:'12:00', descanso_fin:'13:00' },
  { turno:'1', tipo_dia:'viernes', entrada:'07:00', salida:'16:30', descanso_ini:'12:00', descanso_fin:'13:00' },
  { turno:'1', tipo_dia:'sabado',  entrada:'07:00', salida:'11:30', descanso_ini:'',      descanso_fin:'' },
  { turno:'2', tipo_dia:'lj',      entrada:'15:00', salida:'23:00', descanso_ini:'18:00', descanso_fin:'19:00' },
  { turno:'2', tipo_dia:'sabado',  entrada:'15:00', salida:'20:00', descanso_ini:'',      descanso_fin:'' },
  { turno:'3', tipo_dia:'lj',      entrada:'22:00', salida:'06:00', descanso_ini:'02:00', descanso_fin:'03:00' },
  { turno:'4', tipo_dia:'lj',      entrada:'20:00', salida:'05:00', descanso_ini:'00:00', descanso_fin:'00:30' },
  { turno:'4', tipo_dia:'lv',      entrada:'20:00', salida:'05:00', descanso_ini:'00:00', descanso_fin:'00:30' },
  { turno:'5', tipo_dia:'lv',      entrada:'06:00', salida:'14:00', descanso_ini:'10:00', descanso_fin:'10:30' }
];
const FESTIVOS = ['2026-07-13','2026-08-07'];
// Fechas escogidas por TIPO DE DÍA: lunes, jueves, viernes, sábado, domingo y dos festivos (uno de
// ellos en lunes) — es lo que decide la rama del clasificador y la fila de TURNOS que aplica.
const FECHAS = ['2026-07-06','2026-07-09','2026-07-10','2026-07-11','2026-07-12','2026-07-13','2026-08-07','2026-08-03'];
const TURNOS_CASO = ['', '1', '2', '3', '4', '5', '9'];   // '9' = turno inexistente (cae a jornada por defecto)
const HORARIOS = [
  ['07:00','15:30'],   // jornada exacta
  ['07:00','17:30'],   // 2 h de extra diurna
  ['07:00','19:30'],   // extra por encima del tope (avisoExtra) + cruce a la ventana nocturna
  ['06:30','15:30'],   // entrada antes de la programada (ancla a la entrada REAL)
  ['15:00','23:00'],   // turno de tarde exacto
  ['15:00','01:00'],   // cruce de medianoche con extras nocturnas
  ['22:00','06:00'],   // nocturno completo
  ['22:00','06:30'],   // extra que pasa del fin de la ventana nocturna (parte diurna)
  ['20:00','05:00'],   // turno 4
  ['07:00','15:00'],   // jornada dom/fest típica
  ['07:00','17:00'],   // dom/fest con extra
  ['07:00','20:00'],   // dom/fest por encima de 7+2 (avisoDomFest)
  ['08:00','12:00'],   // media jornada
  // Minutos que NO caen en media hora: es lo único que ejercita de verdad el redondeo a 2 decimales
  // (con horarios "en punto y media" un round1 y un round2 dan lo mismo y la comparación sería ciega).
  ['07:10','15:35'],
  ['06:50','17:05'],
  ['22:20','06:40'],
  ['07:05','15:20'],
  ['', ''],            // sin horas (fila incompleta)
  ['07:00', ''],       // salida vacía
  ['13:00','12:00']    // salida ANTES de la entrada (se interpreta como cruce de medianoche)
];
const CAT_TRAB = { '75781':'75781| YONH JAIRO REYES GONZALEZ' };

function casos(){
  const out = [];
  FECHAS.forEach(function(fecha){
    TURNOS_CASO.forEach(function(turno){
      HORARIOS.forEach(function(hh){
        // presentes
        out.push({ fecha, fila:{ codigo:'75781', nombre:'YONH JAIRO REYES GONZALEZ', cc:'3701.02.05| EXCAVACION',
          proyecto:'3701', hora_entrada:hh[0], hora_salida:hh[1], presente:'Si', motivo_ausencia:'', turno } });
        // presente sin código en el catálogo (respaldo "codigo| NOMBRE" de la columna A)
        out.push({ fecha, fila:{ codigo:'00042', nombre:'Persona Nueva', cc:'3702.02.08| CONFORMACION',
          proyecto:'3702', hora_entrada:hh[0], hora_salida:hh[1], presente:'Si', motivo_ausencia:'', turno } });
      });
      // ausentes (todas las horas en 0, con motivo)
      out.push({ fecha, fila:{ codigo:'75781', nombre:'YONH JAIRO REYES GONZALEZ', cc:'', proyecto:'',
        hora_entrada:'', hora_salida:'', presente:'No', motivo_ausencia:'Incapacidad', turno } });
    });
  });
  return out;
}
// Extras del admin (D73): el otro constructor de filas del Parte que toca este archivo.
const EXTRAS_ADMIN = [];
['diurna','nocturna','domfest'].forEach(function(tipo){
  [0.5, 1, 2, 3, 7, 9].forEach(function(horas){
    EXTRAS_ADMIN.push({ tipo, horas, cc:'3701.02.05| EXCAVACION', proyecto:'3701', fecha:'2026-07-09' });
  });
});

/* ---------- comparación celda a celda ---------- */
function celda(v){
  // Distingue 0 de '' (Navision no lee igual una celda vacía que un cero) y conserva el tipo.
  return (typeof v) + ':' + String(v);
}
function compararFilas(a, b){
  const difs = [];
  const n = Math.max(a.length, b.length);
  for(let i=0;i<n;i++){
    if(celda(a[i]) !== celda(b[i]))
      difs.push({ col: String.fromCharCode(65+i), antes: a[i], despues: b[i] });
  }
  ['_aviso','_avisoExtra','_nombre'].forEach(function(k){
    if(celda(a[k]) !== celda(b[k])) difs.push({ col:k, antes:a[k], despues:b[k] });
  });
  return difs;
}

function main(){
  const ref = refAnterior(process.argv);
  const htmlAntes = execSync('git show ' + ref + ':resumen-asistencia.html', { cwd: RAIZ }).toString();
  const htmlHoy   = fs.readFileSync(path.join(RAIZ, 'resumen-asistencia.html'), 'utf8');
  const nomina    = fs.readFileSync(path.join(RAIZ, 'horas-nomina.js'), 'utf8');

  // La página de hoy TIENE que cargar horas-nomina.js: si alguien quita el <script src>, esto lo caza.
  if(htmlHoy.indexOf('src="horas-nomina.js"') < 0)
    throw new Error('resumen-asistencia.html ya no carga horas-nomina.js — el Parte se quedaría sin clasificador.');
  if(htmlHoy.indexOf('function clasificarHoras(') >= 0)
    throw new Error('resumen-asistencia.html volvió a tener su propia copia de clasificarHoras: eso es justo lo que D112 elimina.');

  const ANTES  = cargarVersion('antes('+ref.slice(0,8)+')', scriptsEnLinea(htmlAntes));
  const DESPUES= cargarVersion('despues', [nomina].concat(scriptsEnLinea(htmlHoy)));

  let nCasos = 0, nCeldas = 0, fallos = 0;
  const lista = casos();
  lista.forEach(function(c){
    // El tipo de jornada NO se fuerza: lo deriva cada versión de la fecha (así también se compara esa
    // derivación, que es la que decide la rama dom/fest del clasificador).
    const proyectoStr = CONFIG.proyecto_3701;
    const tjA = ANTES.tipoJornadaDeFecha(c.fecha, FESTIVOS);
    const tjB = DESPUES.tipoJornadaDeFecha(c.fecha, FESTIVOS);
    if(tjA !== tjB){ fallos++; console.error('✗ tipoJornadaDeFecha difiere en ' + c.fecha + ': ' + tjA + ' vs ' + tjB); return; }
    const trA = ANTES.turnoRowFor(c.fila.turno, c.fecha, TURNOS, tjA);
    const trB = DESPUES.turnoRowFor(c.fila.turno, c.fecha, TURNOS, tjB);
    if(JSON.stringify(trA) !== JSON.stringify(trB)){
      fallos++; console.error('✗ turnoRowFor difiere: fecha=' + c.fecha + ' turno=' + c.fila.turno); return;
    }
    const filaA = ANTES.buildParteRow(c.fila, proyectoStr, CONFIG, tjA, CAT_TRAB, trA);
    const filaB = DESPUES.buildParteRow(c.fila, proyectoStr, CONFIG, tjB, CAT_TRAB, trB);
    const difs = compararFilas(filaA, filaB);
    nCasos++; nCeldas += 18;
    if(difs.length){
      fallos++;
      console.error('✗ Fila distinta — ' + c.fecha + ' turno=' + (c.fila.turno||'(sin)') + ' ' +
        (c.fila.hora_entrada||'--') + '→' + (c.fila.hora_salida||'--') + ' presente=' + c.fila.presente);
      difs.forEach(function(d){ console.error('    col ' + d.col + ': antes=' + JSON.stringify(d.antes) + '  después=' + JSON.stringify(d.despues)); });
    }
  });

  // Filas del canal "solo extras" del admin (D73)
  EXTRAS_ADMIN.forEach(function(ex){
    const a = ANTES.buildAdminExtraRow(ex, CONFIG.proyecto_3701, CONFIG.admin_recurso);
    const b = DESPUES.buildAdminExtraRow(ex, CONFIG.proyecto_3701, CONFIG.admin_recurso);
    const difs = compararFilas(a, b);
    nCasos++; nCeldas += 18;
    if(difs.length){
      fallos++;
      console.error('✗ Fila de extra del admin distinta — ' + ex.tipo + ' ' + ex.horas + 'h');
      difs.forEach(function(d){ console.error('    col ' + d.col + ': antes=' + JSON.stringify(d.antes) + '  después=' + JSON.stringify(d.despues)); });
    }
  });

  // Y el clasificador crudo, campo a campo (por si algún día una columna deja de escribirse en el Parte
  // pero el valor se sigue usando en pantalla — p. ej. `avisoExtra` en el detalle por cuadrilla D76).
  let nClasif = 0;
  FECHAS.forEach(function(fecha){
    const tj = ANTES.tipoJornadaDeFecha(fecha, FESTIVOS);
    TURNOS_CASO.forEach(function(turno){
      const tr = ANTES.turnoRowFor(turno, fecha, TURNOS, tj);
      HORARIOS.forEach(function(hh){
        const a = ANTES.clasificarHoras(tj, hh[0], hh[1], CONFIG, tr);
        const b = DESPUES.clasificarHoras(tj, hh[0], hh[1], CONFIG, tr);
        nClasif++;
        if(JSON.stringify(a) !== JSON.stringify(b)){
          fallos++;
          console.error('✗ clasificarHoras difiere — ' + fecha + ' T' + (turno||'-') + ' ' + hh[0] + '→' + hh[1]);
          console.error('    antes  : ' + JSON.stringify(a));
          console.error('    después: ' + JSON.stringify(b));
        }
      });
    });
  });

  console.log('Referencia del "antes": ' + ref);
  console.log('Filas del Parte comparadas : ' + nCasos + '  (' + nCeldas + ' celdas A–R)');
  console.log('Clasificaciones comparadas : ' + nClasif);
  if(fallos){ console.error('\n❌ ' + fallos + ' diferencia(s). El refactor NO es neutro.'); process.exit(1); }
  console.log('\n✅ Idéntico celda a celda: el refactor de D112 no cambia una sola celda del Parte.');
}

main();

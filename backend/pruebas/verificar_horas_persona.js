#!/usr/bin/env node
/**
 * Verificación de `horas-persona.html` (D112) — la REGLA DE ORO, comprobada.
 *
 * Lo que esta pantalla promete es que sus números son EXACTAMENTE los del Parte de Navision. Este arnés
 * lo comprueba sin fiarse de que "usan el mismo archivo": coge un período completo de una persona,
 * calcula sus totales por los DOS caminos y los compara.
 *   · Camino Parte  : `buildParteRow` de `resumen-asistencia.html` (el que escribe el .xlsx), fila a
 *                     fila, sumando las columnas C·D·E·F·G·H.
 *   · Camino pantalla: `calcular()` de `horas-persona.html`.
 * Si difieren en un decimal, falla.
 *
 * Comprueba además, sobre casos con fecha conocida:
 *   · el período de corte 11→10 (límites, cambio de año y que dos períodos seguidos no compartan día);
 *   · una persona RETIRADA a mitad de período: salen sus días y los posteriores al retiro no cuentan
 *     como "sin reporte";
 *   · que un día reportado presente SIN centro de costo no entra en los totales (no va al Parte) pero
 *     sí queda listado aparte;
 *   · que un domingo sin reporte no cuenta como ausencia ni como día sin reporte (D81).
 *
 * USO: node backend/pruebas/verificar_horas_persona.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');

function sandbox(){
  const ctx = {
    console,
    localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    navigator:{}, performance:{ now(){ return 0; } },
    setTimeout, clearTimeout,
    Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt,
    Blob:function(){}, URL:{ createObjectURL(){ return ''; }, revokeObjectURL(){} }
  };
  ctx.window = ctx;
  ctx.document = { createElement(){ return { style:{}, click(){}, select(){} }; }, getElementById(){ return null; },
    head:{ appendChild(){} }, body:{ appendChild(){}, removeChild(){} }, querySelectorAll(){ return []; },
    execCommand(){ return true; } };
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}
function scriptsEnLinea(html){
  const out=[]; const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while((m=re.exec(html))!==null) out.push(m[1]);
  return out;
}
function cargar(nombre, piezas){
  const ctx=sandbox();
  piezas.forEach(function(src,i){
    try{ vm.runInContext(src, ctx, { filename:nombre+'#'+i }); }
    catch(err){ throw new Error('No se pudo evaluar '+nombre+' (pieza '+i+'): '+err.message); }
  });
  return ctx;
}

const NOMINA  = fs.readFileSync(path.join(RAIZ,'horas-nomina.js'),'utf8');
const RESUMEN = fs.readFileSync(path.join(RAIZ,'resumen-asistencia.html'),'utf8');
const PANTALLA= fs.readFileSync(path.join(RAIZ,'horas-persona.html'),'utf8');
if(PANTALLA.indexOf('src="horas-nomina.js"') < 0)
  throw new Error('horas-persona.html no carga horas-nomina.js: estaría calculando con otro clasificador.');
if(/function\s+clasificarHoras\s*\(/.test(PANTALLA))
  throw new Error('horas-persona.html tiene su propia copia de clasificarHoras: eso es exactamente lo que D112 prohíbe.');

const PARTE = cargar('resumen-asistencia', [NOMINA].concat(scriptsEnLinea(RESUMEN)));
const VISTA = cargar('horas-persona',      [NOMINA].concat(scriptsEnLinea(PANTALLA)));

/* ---------- datos de entrada (los mismos del otro arnés) ---------- */
const CONFIG = {
  entrada_lv:'07:00', salida_lv:'15:30', almuerzo_ini:'12:00', almuerzo_fin:'13:00',
  entrada_sab:'07:00', salida_sab:'11:30', entrada_dom:'07:00', salida_dom:'15:00',
  nocturno_desde:'19:00', nocturno_hasta:'06:00', max_extras_dia:'2', domfest_tope:'7',
  proyecto_3701:'3701| T2 - UF1 - R4513 PR 09+800 - PR 30+000'
};
const TURNOS = [
  { turno:'1', tipo_dia:'lj',      entrada:'07:00', salida:'15:30', descanso_ini:'12:00', descanso_fin:'13:00' },
  { turno:'1', tipo_dia:'viernes', entrada:'07:00', salida:'16:30', descanso_ini:'12:00', descanso_fin:'13:00' },
  { turno:'1', tipo_dia:'sabado',  entrada:'07:00', salida:'11:30', descanso_ini:'',      descanso_fin:'' },
  { turno:'4', tipo_dia:'lj',      entrada:'20:00', salida:'05:00', descanso_ini:'00:00', descanso_fin:'00:30' },
  { turno:'4', tipo_dia:'lv',      entrada:'20:00', salida:'05:00', descanso_ini:'00:00', descanso_fin:'00:30' }
];
const FESTIVOS = ['2026-07-20','2026-08-07'];

let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
function igual(a, b, msg){ ok(a===b, msg+'  (obtenido: '+JSON.stringify(a)+(a===b?'':', esperado: '+JSON.stringify(b))+')'); }

/* ================= 1) Totales de la pantalla == suma de las filas del Parte ================= */
// Período real de corte: 11 jul → 10 ago 2026. Persona con extras, dom/fest, nocturnos y ausencias.
function fila(fecha, o){
  return Object.assign({ fecha, reporta:'jeisson', cuadrilla:'ANGEL', codigo:'75781', cedula:'1090',
    nombre:'JUAN PEREZ', cargo:'AYUDANTE', cc:'3701.02.05| EXCAVACION', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }, o);
}
const FILAS = [
  fila('2026-07-13'),                                                    // lunes normal
  fila('2026-07-14', { hora_salida:'17:30' }),                           // 2 h extra diurna
  fila('2026-07-15', { hora_salida:'19:35' }),                           // extra por encima del tope (aviso)
  fila('2026-07-16', { turno:'4', hora_entrada:'20:00', hora_salida:'05:00' }),   // nocturno con cruce
  fila('2026-07-17', { turno:'4', hora_entrada:'20:00', hora_salida:'06:20' }),   // nocturno + extra que pasa de las 06:00
  fila('2026-07-18', { hora_salida:'11:30' }),                           // sábado
  fila('2026-07-19', { hora_entrada:'07:00', hora_salida:'15:00', turno:'' }),    // DOMINGO trabajado
  fila('2026-07-20', { hora_entrada:'07:00', hora_salida:'17:00', turno:'' }),    // FESTIVO con extra dom/fest
  fila('2026-07-21', { presente:'No', motivo_ausencia:'Incapacidad', cc:'', proyecto:'', hora_entrada:'', hora_salida:'', turno:'' }),
  fila('2026-07-22', { presente:'No', motivo_ausencia:'Permiso',     cc:'', proyecto:'', hora_entrada:'', hora_salida:'', turno:'' }),
  fila('2026-07-23', { cc:'', proyecto:'' }),                            // presente SIN CC (no va al Parte)
  fila('2026-07-24', { hora_entrada:'07:10', hora_salida:'15:35' }),     // minutos sueltos (redondeo)
  fila('2026-07-27', { cc:'3701.I010305| ENCARGADOS, INSPECTORES Y CAPATACES' })  // otro CC
];
const PERSONA = { codigo:'75781', cedula:'1090', nombre:'JUAN PEREZ', cargo:'AYUDANTE', cuadrilla:'ANGEL',
  estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'', enPersonal:true };
const RESP = { ok:true, desde:'2026-07-11', hasta:'2026-08-10', dias:31, persona:PERSONA, filas:FILAS,
  config:CONFIG, festivos:FESTIVOS, turnos:TURNOS };

console.log('\n1) Totales de la pantalla == suma de las filas del Parte de Navision');
const calc = VISTA.calcular(RESP);
// Suma por el camino del generador del Parte: una fila A–R por registro, columnas C(2)…H(7).
const totParte = { C:0, D:0, E:0, F:0, G:0, H:0 };
FILAS.forEach(function(f){
  // El generador NO incluye en el Parte las filas presentes sin CC (no tienen proyecto con el que
  // filtrarlas); la pantalla las excluye igual de los totales. Se comprueba aparte, en el punto 4.
  if(f.presente==='Si' && !String(f.cc||'').trim()) return;
  const tj = PARTE.tipoJornadaDeFecha(f.fecha, FESTIVOS);
  const tr = PARTE.turnoRowFor(f.turno, f.fecha, TURNOS, tj);
  const row = PARTE.buildParteRow(f, CONFIG.proyecto_3701, CONFIG, tj, {}, tr);
  totParte.C += Number(row[2])||0; totParte.D += Number(row[3])||0; totParte.E += Number(row[4])||0;
  totParte.F += Number(row[5])||0; totParte.G += Number(row[6])||0; totParte.H += Number(row[7])||0;
});
const r2 = n => Math.round(n*100)/100;
igual(calc.tot.ordinarias,       r2(totParte.C), 'C · Horas ordinarias');
igual(calc.tot.ord_domfest,      r2(totParte.D), 'D · Horas ordinarias Dom/Fest');
igual(calc.tot.extra_diurna,     r2(totParte.E), 'E · Horas extras diurnas');
igual(calc.tot.extra_nocturna,   r2(totParte.F), 'F · Horas extras nocturnas');
igual(calc.tot.recargo_noct_ord, r2(totParte.G), 'G · Recargo hora nocturna ord');
igual(calc.tot.extra_domfest,    r2(totParte.H), 'H · Horas extras diurnas Dom/Fest');
console.log('     (totales: C='+calc.tot.ordinarias+' D='+calc.tot.ord_domfest+' E='+calc.tot.extra_diurna
  +' F='+calc.tot.extra_nocturna+' G='+calc.tot.recargo_noct_ord+' H='+calc.tot.extra_domfest+')');

console.log('\n2) Conteos del período');
// 13 filas − 2 ausencias − 1 presente sin CC (esa no cuenta como día trabajado: no va al Parte).
igual(calc.diasTrabajados, 10, 'días trabajados (13 filas − 2 ausencias − 1 sin CC)');
igual(calc.diasAusentes, 2, 'días ausentes (con motivo)');
igual(Object.keys(calc.porMotivo).length, 2, 'motivos distintos de ausencia');
igual(calc.porMotivo['Incapacidad'], 1, 'ausencias por Incapacidad');
ok(Object.keys(calc.porCC).length===2, 'desglose por CC: 2 centros de costo distintos');
// Horas por CC = horas trabajadas (sin el recargo nocturno, que no son horas adicionales).
const sumaCC = Object.keys(calc.porCC).reduce((a,k)=>a+calc.porCC[k], 0);
const sumaTrab = calc.tot.ordinarias+calc.tot.ord_domfest+calc.tot.extra_diurna+calc.tot.extra_nocturna+calc.tot.extra_domfest;
ok(Math.abs(sumaCC - sumaTrab) < 0.02, 'Σ horas por CC == Σ horas trabajadas de los totales');

console.log('\n3) Días SIN REPORTE (no son ausencias) y domingos');
// Del 11-jul al 10-ago hay 31 días; con 13 filas quedan 18 sin fila. De esos hay que descontar los
// domingos y festivos SIN fila (D81: que no se reporte un domingo es lo normal, no una ausencia).
const domFestSinFila = [];
VISTA.diasDelRango('2026-07-11','2026-08-10').forEach(function(f){
  if(FILAS.some(x=>x.fecha===f)) return;
  if(VISTA.tipoJornadaDeFecha(f, FESTIVOS)==='domfest') domFestSinFila.push(f);
});
igual(calc.sinReporte.length, 31 - FILAS.length - domFestSinFila.length,
  'sin reporte = días del rango − días con fila − dom/fest sin fila');
ok(calc.sinReporte.indexOf('2026-07-26')<0, 'un domingo sin fila NO cuenta como día sin reporte');
ok(calc.sinReporte.indexOf('2026-08-07')<0, 'un festivo sin fila (07-ago) NO cuenta como día sin reporte');
ok(calc.sinReporte.indexOf('2026-07-30')>=0, 'un jueves sin fila SÍ cuenta como día sin reporte');
igual(calc.diasAusentes, 2, 'los días sin reporte NO se suman a las ausencias');

console.log('\n4) Presente SIN centro de costo (no va al Parte)');
igual(calc.fuera.length, 1, 'queda listado aparte 1 día sin CC');
igual(calc.fuera[0].f.fecha, '2026-07-23', 'es el día correcto');
ok(!calc.detalle.find(x=>x.f.fecha==='2026-07-23').enParte, 'la fila se marca como "no va al Parte"');
ok(calc.porCC[''] === undefined, 'no aparece un CC vacío en el desglose');

console.log('\n5) Persona RETIRADA a mitad de período');
const RESP_RET = JSON.parse(JSON.stringify(RESP));
RESP_RET.persona.fecha_retiro = '2026-07-25';   // primer día que YA NO trabaja
const calcRet = VISTA.calcular(RESP_RET);
ok(calcRet.detalle.some(x=>x.f.fecha==='2026-07-24'), 'sus días anteriores al retiro siguen saliendo');
ok(calcRet.sinReporte.every(f=>f < '2026-07-25'), 'ningún día desde el retiro cuenta como sin reporte');
ok(calcRet.sinReporte.length < calc.sinReporte.length, 'el retiro reduce los días esperados');
igual(calcRet.tot.ordinarias, calc.tot.ordinarias, 'los totales de horas no cambian por el retiro');
// Ingreso a mitad de período (el simétrico): los días anteriores al ingreso tampoco se esperan.
const RESP_ING = JSON.parse(JSON.stringify(RESP));
RESP_ING.persona.fecha_ingreso = '2026-07-13';
const calcIng = VISTA.calcular(RESP_ING);
ok(calcIng.sinReporte.every(f=>f >= '2026-07-13'), 'ningún día anterior al ingreso cuenta como sin reporte');

console.log('\n6) Período de corte 11→10 (CORTE_DIA)');
const hoyOriginal = VISTA.hoyBogota;
function conHoy(fecha, fn){ VISTA.hoyBogota = function(){ return fecha; }; try{ return fn(); } finally { VISTA.hoyBogota = hoyOriginal; } }
let p = conHoy('2026-08-03', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2026-07-11→2026-08-10', 'hoy 3-ago (antes del corte): 11 jul → 10 ago');
p = conHoy('2026-08-10', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2026-07-11→2026-08-10', 'hoy 10-ago (el día del corte) cierra ese período');
p = conHoy('2026-08-11', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2026-08-11→2026-09-10', 'hoy 11-ago abre el siguiente');
p = conHoy('2026-08-03', ()=>VISTA.periodoCorte(-1));
igual(p.desde+'→'+p.hasta, '2026-06-11→2026-07-10', 'período anterior');
p = conHoy('2026-01-05', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2025-12-11→2026-01-10', 'cambio de año hacia atrás');
p = conHoy('2026-12-20', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2026-12-11→2027-01-10', 'cambio de año hacia adelante');
p = conHoy('2026-03-05', ()=>VISTA.periodoCorte(0));
igual(p.desde+'→'+p.hasta, '2026-02-11→2026-03-10', 'febrero (mes corto)');
// Ningún día contado dos veces: el fin de un período y el inicio del siguiente son consecutivos.
conHoy('2026-08-03', function(){
  for(let k=-12;k<=0;k++){
    const a=VISTA.periodoCorte(k), b=VISTA.periodoCorte(k+1);
    const sig=new Date(Number(a.hasta.slice(0,4)), Number(a.hasta.slice(5,7))-1, Number(a.hasta.slice(8,10))+1);
    const sigISO=sig.getFullYear()+'-'+('0'+(sig.getMonth()+1)).slice(-2)+'-'+('0'+sig.getDate()).slice(-2);
    if(sigISO!==b.desde){ fallos++; console.error('  ✗ hueco/solape entre períodos '+k+' y '+(k+1)+': '+a.hasta+' → '+b.desde); return; }
  }
  console.log('  ✓ 13 períodos consecutivos encadenan sin huecos ni días repetidos');
});
const mc = conHoy('2026-02-17', ()=>VISTA.mesCalendario());
igual(mc.desde+'→'+mc.hasta, '2026-02-01→2026-02-28', 'mes calendario (febrero)');

console.log('\n7) Texto para copiar y CSV');
// `STATE` se declara con `let`, así que no es una propiedad del objeto global del sandbox: hay que
// asignarlo ejecutando código DENTRO del contexto (los objetos se pasan por referencia sin copiar).
VISTA.__calc = calc; VISTA.__resp = RESP;
vm.runInContext('STATE._calc = __calc; STATE.data = __resp;', VISTA);
const txt = VISTA.textoResumen();
ok(txt.indexOf('JUAN PEREZ')>=0 && txt.indexOf('75781')>=0, 'el texto de WhatsApp lleva nombre y código');
ok(txt.indexOf('Ordinarias: '+calc.tot.ordinarias+' h')>=0, 'lleva las ordinarias del período');
ok(txt.indexOf('liquidación final la hace nómina')>=0, 'lleva la advertencia de nómina');
ok(txt.indexOf('11 jul → 10 ago')>=0, 'lleva el período en el formato del encabezado');
// El CSV se comprueba a nivel de humo (que se arme sin reventar): el contenido depende de Blob/URL,
// que aquí son de mentira.
let csvOk=true; try{ VISTA.descargarCSV(); }catch(err){ csvOk=false; console.error('    '+err.message); }
ok(csvOk, 'la descarga del CSV se arma sin errores');

if(fallos){ console.error('\n❌ '+fallos+' comprobación(es) fallida(s).'); process.exit(1); }
console.log('\n✅ Todo correcto: los totales de "Horas por persona" son los del Parte, celda a celda.');

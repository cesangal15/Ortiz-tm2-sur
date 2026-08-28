#!/usr/bin/env node
/**
 * Verificación de D142 — "Revisión de horas": las extras del ADMIN y el personal EVENTUAL.
 *
 * QUÉ SE ARREGLÓ. La pantalla `horas-persona.html` (D112) servía para todo el mundo menos para dos
 * casos, y los dos por la misma razón de fondo: reconstruye el período leyendo `ASISTENCIA` + la ficha
 * de `PERSONAL`, y hay gente cuyas horas no se cuentan así.
 *   1. **El admin** no está en PERSONAL ni en ASISTENCIA (D73: su jornada ordinaria va por fuera del
 *      sistema y solo registra extras de días puntuales, en `EXTRAS_ADMIN`). Buscarse a sí mismo no
 *      podía funcionar: no hay fila que encontrar. Ahora tiene endpoint (`?action=persona_admin`) y
 *      entrada propia.
 *   2. **El personal eventual** (D85) SÍ salía en el buscador y SÍ traía sus días —esa parte nunca
 *      estuvo rota, y este arnés lo deja comprobado para que no se vuelva a dudar—, pero se le
 *      contaban como "días sin reporte" todos los días que no trabajó, que es justo lo que el resto
 *      del módulo NO hace con un eventual (roster, faltantes y D94 lo excluyen). 25 avisos en un
 *      período de 26 días enterraban los 2 que sí trabajó.
 *
 * QUÉ COMPRUEBA
 *   1) `?action=personal` devuelve al eventual (el buscador de la pantalla se surte de ahí).
 *   2) `?action=persona` devuelve los días de un eventual como los de cualquiera.
 *   3) `?action=persona_admin`: rechaza a quien no es admin, valida fechas y rango (D106), y acota a
 *      [desde, hasta] devolviendo las filas ordenadas.
 *   4) `doGet` pone `_rol` DESDE EL TOKEN y pisa un `&_rol=admin` tecleado en la URL (D109).
 *   5) `clasificarExtraAdmin` reparte a las mismas columnas que repartía `buildAdminExtraRow` antes
 *      del refactor (referencia escrita a mano aquí: día normal E/F topado a 2; dom/fest D + H).
 *   6) El generador del Parte y la pantalla dan el MISMO total para el mismo mes de extras — que es la
 *      regla de oro de D112 aplicada al canal del admin.
 *   7) `calcular()` con `esAdmin`: sin ausencias, sin "sin reporte", CC agregados.
 *   8) `calcular()` con un EVENTUAL: cero "días sin reporte"; con un activo en el mismo caso, los días
 *      sí se cuentan (si no, la comprobación 8 pasaría por accidente).
 *   9) Que nadie se haya fabricado una copia del cálculo (la regla de D112, comprobada sobre el texto).
 *  10) Que la pantalla PINTE los dos casos: la ficha del admin sin secciones que no le aplican, la tabla,
 *      el texto de WhatsApp y el CSV; y la nota que le explica al eventual por qué no tiene huecos.
 *
 * Mutaciones deliberadas con las que este arnés falla (no es ciego): quitar el guard de rol de
 * `horasAdmin`; devolver `e.parameter._rol` sin pisarlo con el del token; quitar la condición
 * `if(!eventual)` del bloque de `sinReporte`.
 *
 * USO: node backend/pruebas/verificar_d142_horas_admin_eventual.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');

/* ================= arnés ================= */
let ok = 0, fallos = [];
function comprobar(desc, cond, obtenido){
  if(cond){ ok++; console.log('  ✓ ' + desc + (obtenido!==undefined ? '  (obtenido: '+JSON.stringify(obtenido)+')' : '')); }
  else { fallos.push(desc + (obtenido!==undefined ? '  → obtenido: '+JSON.stringify(obtenido) : '')); console.log('  ✗ ' + desc + (obtenido!==undefined ? '\n      obtenido: '+JSON.stringify(obtenido) : '')); }
}
function casi(a, b){ return Math.abs((a||0)-(b||0)) < 0.0001; }

/* ================= 1. backend en un sandbox ================= */
const GS = fs.readFileSync(path.join(RAIZ,'backend','CodigoAsistencias.gs'),'utf8');
const ctx = {
  console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
  ContentService:{ createTextOutput(txt){ return { texto:txt, setMimeType(){ return this; } }; },
                   MimeType:{ JSON:'JSON' } },
  Utilities:{ getUuid(){ return 'uuid'; }, formatDate(){ return ''; } },
  Logger:{ log(){} },
  PropertiesService:{ getScriptProperties(){ return { getProperty(){ return null; }, setProperty(){} }; } },
  SpreadsheetApp:{ openById(){ throw new Error('El endpoint no debe abrir el Sheet en esta prueba'); } },
  CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){} }; } },
  LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename:'CodigoAsistencias.gs' });

const CUADRILLAS = [{ cuadrilla:'ANGEL', responsables:'angel', area:'tierras', estado:'activa' }];
const PERSONAL = [
  { _row:2, codigo:'75000', cedula:'1001', nombre:'JUAN ACTIVO', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel', estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' },
  // El caso de D85: el encargado que solo trabaja en ocasiones puntuales.
  { _row:3, codigo:'75111', cedula:'1002', nombre:'JAVIER EVENTUAL', cargo:'ENCARGADO', cuadrilla:'ANGEL',
    responsable:'', estado:'eventual', fecha_ingreso:'2026-01-01', fecha_retiro:'' }
];
const CONFIG = { max_extras_dia:'2', domfest_tope:'7', admin_recurso:'77463| CESAR AUGUSTO GALVIS SANDINO',
  almuerzo_ini:'12:00', almuerzo_fin:'13:00', entrada_lv:'07:00', salida_lv:'15:30', nocturno_desde:'19:00' };
const EXTRAS_ADMIN = [
  { fecha:'2026-08-04', cc:'3701.I010303| JEFES', proyecto:'3701', horas:2,   tipo:'diurna',   timestamp:'', reporta:'admin' },
  { fecha:'2026-08-12', cc:'3702.I010303| JEFES', proyecto:'3702', horas:1.5, tipo:'nocturna', timestamp:'', reporta:'admin' },
  { fecha:'2026-08-16', cc:'3701.I010303| JEFES', proyecto:'3701', horas:9,   tipo:'domfest',  timestamp:'', reporta:'admin' },
  { fecha:'2026-09-20', cc:'3701.I010303| JEFES', proyecto:'3701', horas:2,   tipo:'diurna',   timestamp:'', reporta:'admin' }   // FUERA del período
];
const ASISTENCIA_EVENTUAL = [
  { id_registro:'x', timestamp:'', fecha:'2026-08-16', reporta:'admin', cuadrilla:'ANGEL', codigo:'75111',
    cedula:'1002', nombre:'JAVIER EVENTUAL', cargo:'ENCARGADO', cc:'3701.I010305| ENCARGADOS', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:00', presente:'Si', motivo_ausencia:'', observacion:'', turno:'' }
];

ctx.readSheet = function(nombre){
  if(nombre==='PERSONAL')      return PERSONAL;
  if(nombre==='CUADRILLAS')    return CUADRILLAS;
  if(nombre==='EXTRAS_ADMIN')  return EXTRAS_ADMIN;
  if(nombre==='CONFIG')        return Object.keys(CONFIG).map(function(k){ return { clave:k, valor:CONFIG[k] }; });
  return [];
};
ctx.getConfigMap = function(){ return CONFIG; };
ctx.getFestivos  = function(){ return ['2026-08-17']; };
ctx.leerFilasPorFecha_ = function(){ return ASISTENCIA_EVENTUAL; };
function pedir(params){ return JSON.parse(ctx.doGet({ parameter: Object.assign({}, params) }).texto); }
// La autenticación no es lo que se prueba aquí: se sustituye el portero por una sesión fija.
function conSesion(usuario, rol, fn){
  const antes = ctx.sesion_;
  ctx.sesion_ = function(){ return { ok:true, usuario:usuario, rol:rol }; };
  try{ return fn(); } finally { ctx.sesion_ = antes; }
}

console.log('\n1) El buscador de la pantalla ve al personal EVENTUAL (?action=personal)');
{
  const r = conSesion('admin','admin', function(){ return pedir({ action:'personal', usuario:'admin', area:'' }); });
  const nombres = (r.personal||[]).map(function(p){ return p.nombre; });
  comprobar('devuelve ok', r.ok===true);
  comprobar('el eventual está en la lista', nombres.indexOf('JAVIER EVENTUAL')>=0, nombres);
  const ev = (r.personal||[]).find(function(p){ return p.codigo==='75111'; });
  comprobar('viene con estado=eventual (la pantalla lo etiqueta con eso)', ev && ev.estado==='eventual', ev && ev.estado);
}

console.log('\n2) ?action=persona devuelve los días de un EVENTUAL como los de cualquiera');
{
  const r = conSesion('admin','admin', function(){
    return pedir({ action:'persona', usuario:'admin', area:'', codigo:'75111', desde:'2026-08-11', hasta:'2026-09-10' }); });
  comprobar('devuelve ok', r.ok===true, r.error);
  comprobar('trae su día reportado', (r.filas||[]).length===1, (r.filas||[]).length);
  comprobar('la ficha conserva estado=eventual', r.persona && r.persona.estado==='eventual', r.persona && r.persona.estado);
}

console.log('\n3) ?action=persona_admin — guard de rol, fechas y rango');
{
  const noAdmin = conSesion('residente','residente', function(){
    return pedir({ action:'persona_admin', usuario:'residente', desde:'2026-08-11', hasta:'2026-09-10' }); });
  comprobar('un residente NO puede leer las extras del admin', noAdmin.ok===false, noAdmin.error);
  comprobar('el error explica por qué', /administrador/i.test(String(noAdmin.error||'')), noAdmin.error);

  const sinFecha = conSesion('admin','admin', function(){
    return pedir({ action:'persona_admin', usuario:'admin', desde:'', hasta:'2026-09-10' }); });
  comprobar('sin fecha válida no responde datos (D106)', sinFecha.ok===false, sinFecha.error);

  const malFecha = conSesion('admin','admin', function(){
    return pedir({ action:'persona_admin', usuario:'admin', desde:'2026-02-31', hasta:'2026-09-10' }); });
  comprobar('una fecha que no existe se rechaza (D106)', malFecha.ok===false, malFecha.error);

  const invertido = conSesion('admin','admin', function(){
    return pedir({ action:'persona_admin', usuario:'admin', desde:'2026-09-10', hasta:'2026-08-11' }); });
  comprobar('período invertido se rechaza', invertido.ok===false, invertido.error);

  const largo = conSesion('admin','admin', function(){
    return pedir({ action:'persona_admin', usuario:'admin', desde:'2025-01-01', hasta:'2026-12-31' }); });
  comprobar('período mayor al tope se rechaza', largo.ok===false, largo.error);

  const r = conSesion('admin','admin', function(){
    return pedir({ action:'persona_admin', usuario:'admin', desde:'2026-08-11', hasta:'2026-09-10' }); });
  comprobar('el admin sí lo lee', r.ok===true, r.error);
  comprobar('marca esAdmin (la pantalla decide con eso)', r.esAdmin===true);
  comprobar('acota al período: deja fuera la extra del 20-sep', (r.filas||[]).length===2, (r.filas||[]).map(function(f){ return f.fecha; }));
  comprobar('las filas salen ordenadas por fecha', (r.filas||[])[0].fecha==='2026-08-12' && (r.filas||[])[1].fecha==='2026-08-16',
    (r.filas||[]).map(function(f){ return f.fecha; }));
  comprobar('la ficha lleva el No. Recurso de CONFIG', r.persona && r.persona.codigo===CONFIG.admin_recurso, r.persona && r.persona.codigo);
  comprobar('devuelve config y festivos para clasificar en el cliente',
    !!(r.config && r.festivos), { config:!!r.config, festivos:!!r.festivos });
}

console.log('\n4) El ROL sale del token, no de la URL (D109)');
{
  const colado = conSesion('residente','residente', function(){
    return pedir({ action:'persona_admin', usuario:'residente', _rol:'admin', desde:'2026-08-11', hasta:'2026-09-10' }); });
  comprobar('un &_rol=admin tecleado en la URL no cuela', colado.ok===false, colado.error);
}

/* ================= 2. cliente: clasificador compartido y pantalla ================= */
function sandbox(){
  const c = {
    console, localStorage:{ getItem(){ return null; }, setItem(){}, removeItem(){} },
    navigator:{}, performance:{ now(){ return 0; } }, setTimeout, clearTimeout,
    Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt,
    Blob:function(){}, URL:{ createObjectURL(){ return ''; }, revokeObjectURL(){} }
  };
  c.window = c;
  c.document = { createElement(){ return { style:{}, click(){}, select(){} }; }, getElementById(){ return null; },
    head:{ appendChild(){} }, body:{ appendChild(){}, removeChild(){} }, querySelectorAll(){ return []; },
    execCommand(){ return true; } };
  c.globalThis = c;
  return vm.createContext(c);
}
function scriptsEnLinea(html){
  const out=[]; const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while((m=re.exec(html))!==null) out.push(m[1]);
  return out;
}
function cargar(nombre, piezas){
  const c=sandbox();
  piezas.forEach(function(src,i){
    try{ vm.runInContext(src, c, { filename:nombre+'#'+i }); }
    catch(err){ throw new Error('No se pudo evaluar '+nombre+' (pieza '+i+'): '+err.message); }
  });
  return c;
}
const NOMINA   = fs.readFileSync(path.join(RAIZ,'horas-nomina.js'),'utf8');
const RESUMEN  = fs.readFileSync(path.join(RAIZ,'resumen-asistencia.html'),'utf8');
const PANTALLA = fs.readFileSync(path.join(RAIZ,'horas-persona.html'),'utf8');
const PARTE = cargar('resumen-asistencia', [NOMINA].concat(scriptsEnLinea(RESUMEN)));
const VISTA = cargar('horas-persona',      [NOMINA].concat(scriptsEnLinea(PANTALLA)));

console.log('\n5) clasificarExtraAdmin reparte como repartía el generador antes del refactor');
{
  // Referencia escrita a mano: la regla de D73 (día normal) + D120 (dom/fest), tal cual estaba dentro
  // de buildAdminExtraRow. Si el refactor hubiera movido una coma, esto lo caza.
  function referencia(ex){
    const E={C:0,D:0,Ex:0,Fx:0,H:0};
    if(ex.tipo==='diurna')        E.Ex=Math.min(ex.horas,2);
    else if(ex.tipo==='nocturna') E.Fx=Math.min(ex.horas,2);
    else if(ex.tipo==='domfest'){ E.D=Math.min(ex.horas,7); E.H=Math.min(Math.max(0,ex.horas-7),2); }
    return E;
  }
  const casos=[{tipo:'diurna',horas:2},{tipo:'diurna',horas:1.5},{tipo:'diurna',horas:3},
               {tipo:'nocturna',horas:2},{tipo:'nocturna',horas:0.5},
               {tipo:'domfest',horas:7},{tipo:'domfest',horas:9},{tipo:'domfest',horas:5},{tipo:'domfest',horas:12}];
  let iguales=0;
  casos.forEach(function(ex){
    const cl=VISTA.clasificarExtraAdmin(ex, CONFIG), ref=referencia(ex);
    const bien = casi(cl.extra_diurna,ref.Ex) && casi(cl.extra_nocturna,ref.Fx)
              && casi(cl.ord_domfest,ref.D)  && casi(cl.extra_domfest,ref.H)
              && casi(cl.ordinarias,0)       && casi(cl.recargo_noct_ord,0);
    if(bien) iguales++;
    else console.log('      ✗ ' + JSON.stringify(ex) + ' → ' + JSON.stringify(cl) + ' vs ' + JSON.stringify(ref));
  });
  comprobar('los '+casos.length+' casos reparten igual que la regla escrita a mano', iguales===casos.length, iguales+'/'+casos.length);
  comprobar('nunca escribe ordinarias en día normal (D73: solo la extra)',
    VISTA.clasificarExtraAdmin({tipo:'diurna',horas:2}, CONFIG).ordinarias===0);
  comprobar('un dom/fest por encima de 7+2 se avisa en vez de perderse',
    VISTA.clasificarExtraAdmin({tipo:'domfest',horas:12}, CONFIG).avisoDomFest===true);
}

console.log('\n6) Regla de oro (D112): el Parte y la pantalla dan el MISMO total de extras del admin');
{
  const extras = EXTRAS_ADMIN.filter(function(e){ return e.fecha>='2026-08-11' && e.fecha<='2026-09-10'; });
  // Camino Parte: las filas A–R que de verdad se escriben en el .xlsx.
  const totParte = { C:0, D:0, E:0, F:0, G:0, H:0 };
  extras.forEach(function(ex){
    const row = PARTE.buildAdminExtraRow(ex, '3701', CONFIG.admin_recurso, CONFIG);
    totParte.C += Number(row[2])||0; totParte.D += Number(row[3])||0; totParte.E += Number(row[4])||0;
    totParte.F += Number(row[5])||0; totParte.G += Number(row[6])||0; totParte.H += Number(row[7])||0;
  });
  // Camino pantalla: calcular() con la respuesta del endpoint nuevo.
  const c = VISTA.calcular({ esAdmin:true, desde:'2026-08-11', hasta:'2026-09-10', filas:extras,
    config:CONFIG, festivos:['2026-08-17'], turnos:[] });
  comprobar('C ordinarias',            casi(c.tot.ordinarias,       totParte.C), [c.tot.ordinarias, totParte.C]);
  comprobar('D ordinarias Dom/Fest',   casi(c.tot.ord_domfest,      totParte.D), [c.tot.ord_domfest, totParte.D]);
  comprobar('E extra diurna',          casi(c.tot.extra_diurna,     totParte.E), [c.tot.extra_diurna, totParte.E]);
  comprobar('F extra nocturna',        casi(c.tot.extra_nocturna,   totParte.F), [c.tot.extra_nocturna, totParte.F]);
  comprobar('G recargo nocturno ord.', casi(c.tot.recargo_noct_ord, totParte.G), [c.tot.recargo_noct_ord, totParte.G]);
  comprobar('H extra diurna Dom/Fest', casi(c.tot.extra_domfest,    totParte.H), [c.tot.extra_domfest, totParte.H]);
}

console.log('\n7) calcular() en el canal del admin: sin ausencias y sin "días sin reporte"');
{
  const extras = EXTRAS_ADMIN.filter(function(e){ return e.fecha>='2026-08-11' && e.fecha<='2026-09-10'; });
  const c = VISTA.calcular({ esAdmin:true, desde:'2026-08-11', hasta:'2026-09-10', filas:extras,
    config:CONFIG, festivos:['2026-08-17'], turnos:[] });
  comprobar('cuenta los días con extra', c.diasTrabajados===2, c.diasTrabajados);
  comprobar('cero días ausentes (el canal no reporta ausencias)', c.diasAusentes===0, c.diasAusentes);
  comprobar('cero días "sin reporte" (la jornada ordinaria va por fuera del sistema)',
    c.sinReporte.length===0, c.sinReporte.length);
  comprobar('el detalle lleva una fila por extra', c.detalle.length===2, c.detalle.length);
  comprobar('agrega las horas por centro de costo', Object.keys(c.porCC).length===2, Object.keys(c.porCC));
  comprobar('la fila del detalle dice de qué tipo era la extra',
    /nocturna/.test(c.detalle[0].f.observacion||''), c.detalle[0].f.observacion);
}

console.log('\n8) Al EVENTUAL no se le cuentan "días sin reporte" (D85)');
{
  const filas = ASISTENCIA_EVENTUAL.map(function(r){
    return { fecha:r.fecha, reporta:r.reporta, cuadrilla:r.cuadrilla, codigo:r.codigo, cedula:r.cedula,
      nombre:r.nombre, cargo:r.cargo, cc:r.cc, proyecto:r.proyecto, hora_entrada:r.hora_entrada,
      hora_salida:r.hora_salida, presente:r.presente, motivo_ausencia:'', observacion:'', turno:'' };
  });
  const base = { desde:'2026-08-11', hasta:'2026-09-10', filas, config:CONFIG, festivos:['2026-08-17'], turnos:[] };
  const ev = VISTA.calcular(Object.assign({}, base, { persona:{ enPersonal:true, estado:'eventual',
    fecha_ingreso:'2026-01-01', fecha_retiro:'' } }));
  const act = VISTA.calcular(Object.assign({}, base, { persona:{ enPersonal:true, estado:'activo',
    fecha_ingreso:'2026-01-01', fecha_retiro:'' } }));
  comprobar('el eventual sale con sus horas del día que sí trabajó', ev.diasTrabajados===1, ev.diasTrabajados);
  comprobar('al eventual NO se le marcan días sin reporte', ev.sinReporte.length===0, ev.sinReporte.length);
  // Control: si la misma persona fuera activa, esos días SÍ se cuentan. Sin esto, la comprobación
  // anterior podría estar pasando porque el cálculo no encuentra días, no porque los excluya.
  comprobar('control — al activo SÍ se le cuentan (si no, lo de arriba sería casualidad)',
    act.sinReporte.length>20, act.sinReporte.length);
  comprobar('y sus horas son las mismas en los dos casos', casi(ev.tot.ord_domfest, act.tot.ord_domfest),
    [ev.tot.ord_domfest, act.tot.ord_domfest]);
}

console.log('\n9) La pantalla no se fabricó una copia del cálculo');
{
  comprobar('horas-persona.html sigue cargando horas-nomina.js',
    PANTALLA.indexOf('src="horas-nomina.js"')>=0);
  comprobar('no tiene su propia clasificarExtraAdmin',
    !/function\s+clasificarExtraAdmin\s*\(/.test(PANTALLA));
  comprobar('el generador del Parte tampoco: la llama, no la reimplementa',
    !/function\s+clasificarExtraAdmin\s*\(/.test(RESUMEN) && /clasificarExtraAdmin\(/.test(RESUMEN));
}

console.log('\n10) La pantalla PINTA el caso del admin (no basta con que calcule)');
{
  const extras = EXTRAS_ADMIN.filter(function(e){ return e.fecha>='2026-08-11' && e.fecha<='2026-09-10'; });
  const d = { ok:true, esAdmin:true, desde:'2026-08-11', hasta:'2026-09-10', dias:31, filas:extras,
    config:CONFIG, festivos:['2026-08-17'], turnos:[],
    persona:{ codigo:CONFIG.admin_recurso, cedula:'', nombre:'admin', cargo:'Administrador',
      cuadrilla:'', estado:'', fecha_ingreso:'', fecha_retiro:'', enPersonal:false } };
  // `STATE` y `PERSONA_ADMIN` se declaran con let/const: no son propiedades del objeto global del
  // sandbox, hay que tocarlas ejecutando código DENTRO del contexto (mismo apaño que D112).
  VISTA.__d = d;
  vm.runInContext("STATE.usuario='admin'; STATE.rol='admin'; STATE.persona=PERSONA_ADMIN;"
    + " STATE.desde=__d.desde; STATE.hasta=__d.hasta; STATE.data=__d;", VISTA);
  let html='';
  try{ html=VISTA.resultadoHtml(d); }catch(err){ html='ERROR: '+err.message; }
  comprobar('resultadoHtml no revienta con la respuesta del canal del admin', html.indexOf('ERROR:')!==0, html.slice(0,120));
  comprobar('el encabezado dice de qué se trata', /Mis horas extra/.test(html));
  comprobar('enseña el No. Recurso de Navision', html.indexOf(CONFIG.admin_recurso)>=0);
  comprobar('NO enseña la sección de ausencias (no aplica)', !/Ausencias por motivo/.test(html));
  comprobar('cuenta "días con extra" en vez de "días trabajados"',
    /Días con extra/.test(html) && !/Días trabajados/.test(html));
  let det='';
  try{ det=VISTA.detalleHtml(vm.runInContext('STATE._calc', VISTA)); }catch(err){ det='ERROR: '+err.message; }
  comprobar('la tabla del detalle se arma', det.indexOf('ERROR:')!==0 && /<table>/.test(det), det.slice(0,120));
  let txt='';
  try{ txt=VISTA.textoResumen(); }catch(err){ txt='ERROR: '+err.message; }
  comprobar('el texto para WhatsApp se arma y no inventa un código de trabajador',
    /MIS HORAS EXTRA/.test(txt) && !/cód\./.test(txt), txt.split('\n')[0]);
  let cayo=false;
  try{ VISTA.descargarCSV(); }catch(err){ cayo=true; }
  comprobar('la descarga del CSV se arma sin errores', !cayo);

  // Y el eventual, en la misma pantalla: se le dice por qué no tiene "días sin reporte".
  const dEv = { ok:true, desde:'2026-08-11', hasta:'2026-09-10', dias:31, config:CONFIG,
    festivos:['2026-08-17'], turnos:[],
    filas:[{ fecha:'2026-08-16', reporta:'admin', cuadrilla:'ANGEL', codigo:'75111', cedula:'1002',
      nombre:'JAVIER EVENTUAL', cargo:'ENCARGADO', cc:'3701.I010305| ENCARGADOS', proyecto:'3701',
      hora_entrada:'07:00', hora_salida:'15:00', presente:'Si', motivo_ausencia:'', observacion:'', turno:'' }],
    persona:{ codigo:'75111', cedula:'1002', nombre:'JAVIER EVENTUAL', cargo:'ENCARGADO', cuadrilla:'ANGEL',
      estado:'eventual', fecha_ingreso:'2026-01-01', fecha_retiro:'', enPersonal:true } };
  VISTA.__dEv = dEv;
  vm.runInContext('STATE.data=__dEv; STATE.persona=__dEv.persona;', VISTA);
  let htmlEv='';
  try{ htmlEv=VISTA.resultadoHtml(dEv); }catch(err){ htmlEv='ERROR: '+err.message; }
  comprobar('la ficha del eventual lleva su etiqueta', /badge">eventual/.test(htmlEv));
  comprobar('y explica por qué no se le cuentan días sin reporte',
    /<b>personal eventual<\/b>/.test(htmlEv) && /no se cuentan/.test(htmlEv));
}

console.log('\n' + '-'.repeat(72));
if(fallos.length){
  console.log('❌ ' + fallos.length + ' comprobación(es) fallida(s) de ' + (ok+fallos.length) + ':');
  fallos.forEach(function(f){ console.log('   · ' + f); });
  process.exit(1);
}
console.log('✅ Todo correcto: ' + ok + ' comprobaciones.');
console.log('   Las extras del admin llegan a la revisión de horas con los MISMOS números del Parte,');
console.log('   y al personal eventual ya no se le cuenta como hueco un día que nunca se le esperó.');

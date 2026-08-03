#!/usr/bin/env node
/**
 * Verificación del endpoint `?action=persona` (D112) — sobre todo su CERROJO DE ÁREA.
 *
 * El endpoint es de solo lectura, pero decide QUIÉN puede ver las horas de QUIÉN, y esa decisión tiene
 * que estar en el BACKEND: la identidad sale del token firmado (D109), así que de nada sirve esconder
 * un botón si la URL contesta igual. Aquí se comprueba que un `residente_dren` (o la residente de UF3)
 * que teclee en la URL el código de alguien de TIERRAS recibe `ok:false` y NO los datos.
 *
 * CÓMO. Se carga `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script
 * de mentira y se sustituyen los DOS puntos de lectura del Sheet (`readSheet` y `leerFilasPorFecha_`)
 * por datos de prueba. Todo lo demás —`areasEfectivas`, `areaDeCuadrillaMap`, `cuadrillaEnAreas`,
 * `fdateValida_`, `diasDelRango`— es el código real del archivo, sin tocar.
 *
 * USO: node backend/pruebas/verificar_endpoint_persona.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
const GS = fs.readFileSync(path.join(RAIZ, 'backend', 'CodigoAsistencias.gs'), 'utf8');

/* ---------- servicios de Apps Script de mentira ---------- */
const ctx = {
  console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
  ContentService:{ createTextOutput(txt){ return { texto:txt, setMimeType(){ return this; } }; },
                   MimeType:{ JSON:'JSON' } },
  Utilities:{ getUuid(){ return 'uuid'; }, formatDate(){ return '2026-08-03'; } },
  Logger:{ log(){} },
  PropertiesService:{ getScriptProperties(){ return { getProperty(){ return null; }, setProperty(){} }; } },
  SpreadsheetApp:{ openById(){ throw new Error('El endpoint no debe abrir el Sheet en esta prueba'); } },
  CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){} }; } }
};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(GS, ctx, { filename:'CodigoAsistencias.gs' });

/* ---------- datos de prueba ---------- */
const CUADRILLAS = [
  { cuadrilla:'ANGEL',    responsables:'angel',    area:'tierras', estado:'activa' },
  { cuadrilla:'MAURICIO', responsables:'mauricio', area:'odt',     estado:'activa' },
  { cuadrilla:'JAIRO',    responsables:'jairo',    area:'odl',     estado:'activa' },
  { cuadrilla:'UF3',      responsables:'',         area:'uf3',     estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'75781', cedula:'1090', nombre:'JUAN PEREZ',   cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel', estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:3, codigo:'80001', cedula:'2200', nombre:'PEDRO DRENAJE', cargo:'OFICIAL',  cuadrilla:'MAURICIO',
    responsable:'mauricio', estado:'activo', fecha_ingreso:'2026-02-01', fecha_retiro:'' },
  // Persona MOVIDA de cuadrilla: hoy está en drenajes, pero su histórico del período es de tierras.
  { _row:4, codigo:'80002', cedula:'2201', nombre:'LUIS MUDADO',  cargo:'OFICIAL',  cuadrilla:'JAIRO',
    responsable:'jairo', estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' },
  // Retirada a mitad de período.
  { _row:5, codigo:'80003', cedula:'2202', nombre:'ANA RETIRADA', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel', estado:'inactivo', fecha_ingreso:'2026-01-01', fecha_retiro:'2026-07-25' }
];
function filaAsis(fecha, codigo, cuadrilla, o){
  return Object.assign({ id_registro:'x', timestamp:'', fecha, reporta:'angel', cuadrilla, codigo,
    cedula:'', nombre:'', cargo:'', cc:'3701.02.05| EXCAVACION', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }, o);
}
const ASISTENCIA = [
  filaAsis('2026-07-13','75781','ANGEL'),
  filaAsis('2026-07-14','75781','ANGEL', { hora_salida:'17:30' }),
  filaAsis('2026-07-15','75781','ANGEL', { presente:'No', motivo_ausencia:'Incapacidad', cc:'', hora_entrada:'', hora_salida:'' }),
  filaAsis('2026-08-20','75781','ANGEL'),                       // FUERA del período (no debe salir)
  filaAsis('2026-07-13','80001','MAURICIO'),
  // El mudado: en julio reportaba en tierras (ANGEL), en agosto ya en drenajes (JAIRO).
  filaAsis('2026-07-13','80002','ANGEL'),
  filaAsis('2026-08-05','80002','JAIRO'),
  filaAsis('2026-07-20','80003','ANGEL'),
  filaAsis('2026-07-24','80003','ANGEL')
];
const HOJAS = { CUADRILLAS, PERSONAL, CONFIG:[
    { clave:'max_extras_dia', valor:'2' }, { clave:'domfest_tope', valor:'7' },
    { clave:'nocturno_desde', valor:'19:00' }, { clave:'nocturno_hasta', valor:'06:00' }
  ], FESTIVOS:[{ fecha:'2026-07-20' }], TURNOS:[
    { turno:'1', tipo_dia:'lj', entrada:'07:00', salida:'15:30', descanso_ini:'12:00', descanso_fin:'13:00', cruza_medianoche:'' }
  ] };

let lecturasCompletasDeAsistencia = 0;
ctx.readSheet = function(nombre){
  if(nombre === 'ASISTENCIA'){ lecturasCompletasDeAsistencia++; return ASISTENCIA.slice(); }
  return (HOJAS[nombre] || []).slice();
};
ctx.leerFilasPorFecha_ = function(hoja, desde, hasta){
  if(hoja !== 'ASISTENCIA') throw new Error('lector acotado usado sobre ' + hoja);
  return ASISTENCIA.filter(r => r.fecha >= desde && r.fecha <= hasta);
};

/* ---------- utilidades de la prueba ---------- */
let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
function llamar(params){
  const salida = ctx.horasPersona({ parameter: params });
  return JSON.parse(salida.texto);
}
const PERIODO = { desde:'2026-07-11', hasta:'2026-08-10' };

console.log('\n1) Consulta normal (residente de tierras sobre su gente)');
let r = llamar(Object.assign({ usuario:'residente', codigo:'75781' }, PERIODO));
ok(r.ok === true, 'responde ok');
ok(r.filas.length === 3, 'trae solo las filas del período (3 de 4; la del 20-ago queda fuera) — ' + r.filas.length);
ok(r.filas.every(f => f.fecha >= PERIODO.desde && f.fecha <= PERIODO.hasta), 'ninguna fila se sale del rango');
ok(r.persona && r.persona.nombre === 'JUAN PEREZ', 'trae la ficha de la persona');
ok(!!r.config && !!r.turnos && Array.isArray(r.festivos), 'trae config, turnos y festivos (para clasificar en el cliente)');
ok(r.filas.some(f => f.presente === 'No' && f.motivo_ausencia === 'Incapacidad'), 'conserva la ausencia con su motivo');
ok(r.filas[0].fecha <= r.filas[r.filas.length-1].fecha, 'las filas vienen ordenadas por fecha');
ok(lecturasCompletasDeAsistencia === 0, 'NO lee la hoja ASISTENCIA entera (usa el lector acotado, D102)');

console.log('\n2) Cerrojo de área EN EL BACKEND (D69h/D109)');
r = llamar(Object.assign({ usuario:'residente_dren', codigo:'75781' }, PERIODO));
ok(r.ok === false, 'un residente_dren pidiendo por URL a alguien de TIERRAS recibe ok:false');
ok(!r.filas, 'y no recibe ninguna fila');
r = llamar(Object.assign({ usuario:'residente_uf3', codigo:'75781' }, PERIODO));
ok(r.ok === false, 'la residente de UF3 tampoco puede ver a alguien de tierras');
r = llamar(Object.assign({ usuario:'jeisson', codigo:'80001' }, PERIODO));
ok(r.ok === false, 'y al revés: jeisson (tierras) no puede ver a alguien de drenajes');
r = llamar(Object.assign({ usuario:'residente_dren', codigo:'80001' }, PERIODO));
ok(r.ok === true && r.filas.length === 1, 'el residente_dren SÍ ve a su propia gente');
r = llamar(Object.assign({ usuario:'admin', codigo:'75781' }, PERIODO));
ok(r.ok === true, 'el admin sin filtro ve a cualquiera');
r = llamar(Object.assign({ usuario:'admin', area:'odt', codigo:'75781' }, PERIODO));
ok(r.ok === false, 'el admin con "Ver como ODT" queda acotado igual que un residente de área');

console.log('\n3) Histórico: manda la cuadrilla de CADA FILA, no solo la actual de PERSONAL');
// LUIS MUDADO está HOY en JAIRO (odl) pero en julio reportaba en ANGEL (tierras).
r = llamar(Object.assign({ usuario:'residente_dren', codigo:'80002' }, PERIODO));
ok(r.ok === true, 'el residente de drenajes puede consultarlo (hoy es de su área)');
ok(r.filas.length === 1 && r.filas[0].cuadrilla === 'JAIRO', 'pero solo ve sus días de drenajes, no los de tierras');
r = llamar(Object.assign({ usuario:'residente', codigo:'80002' }, PERIODO));
ok(r.ok === true && r.filas.length === 1 && r.filas[0].cuadrilla === 'ANGEL',
  'el residente de tierras ve los días en que fue de tierras, aunque hoy ya no lo sea');

console.log('\n4) Persona retirada a mitad de período');
r = llamar(Object.assign({ usuario:'residente', codigo:'80003' }, PERIODO));
ok(r.ok === true && r.filas.length === 2, 'salen sus días trabajados antes del retiro');
ok(r.persona.fecha_retiro === '2026-07-25', 'la ficha trae la fecha de retiro (el cliente no espera los días posteriores)');
ok(String(r.persona.estado) !== 'activo', 'la ficha la marca como retirada');

console.log('\n5) Validaciones de entrada');
r = llamar({ usuario:'residente', codigo:'75781', desde:'', hasta:'2026-08-10' });
ok(r.ok === false, 'fecha vacía: rechazada (D106)');
r = llamar({ usuario:'residente', codigo:'75781', desde:'2026-02-31', hasta:'2026-08-10' });
ok(r.ok === false, 'fecha inexistente (31 de febrero): rechazada (D106)');
r = llamar({ usuario:'residente', codigo:'75781', desde:'2026-08-10', hasta:'2026-07-11' });
ok(r.ok === false, 'rango invertido: rechazado');
r = llamar({ usuario:'residente', codigo:'75781', desde:'2025-01-01', hasta:'2026-08-10' });
// MAX_DIAS_RANGO se declara con `const`, así que no es propiedad del objeto global del sandbox:
// se lee ejecutando dentro del contexto.
const MAX_DIAS = vm.runInContext('MAX_DIAS_RANGO', ctx);
ok(r.ok === false && /máximo/.test(r.error||''), 'rango de más de ' + MAX_DIAS + ' días: rechazado');
r = llamar(Object.assign({ usuario:'residente' }, PERIODO));
ok(r.ok === false, 'sin código ni cédula: rechazado');
r = llamar(Object.assign({ usuario:'residente', codigo:'99999' }, PERIODO));
ok(r.ok === false, 'código que no existe: rechazado con mensaje, no una respuesta vacía');

console.log('\n6) Búsqueda por cédula (personas sin código)');
r = llamar(Object.assign({ usuario:'residente', codigo:'', cedula:'1090' }, PERIODO));
ok(r.ok === true && r.persona.codigo === '75781', 'encuentra por cédula cuando no se manda código');

console.log('\n7) Solo lectura de punta a punta');
// Se extrae el CUERPO real de la función (contando llaves) y se busca cualquier ruta de escritura.
// Vale más que confiar en la lectura del diff: si alguien mete un setValues aquí dentro, falla.
function cuerpoDe(nombre){
  const i = GS.indexOf('function ' + nombre + '(');
  if(i < 0) throw new Error('no se encontró la función ' + nombre);
  let j = GS.indexOf('{', i), nivel = 0, k = j;
  for(; k < GS.length; k++){
    if(GS[k] === '{') nivel++;
    else if(GS[k] === '}'){ nivel--; if(nivel === 0) break; }
  }
  return GS.slice(j, k+1);
}
const CUERPO = cuerpoDe('horasPersona');
const ESCRITURAS = ['setValues','setValue','deleteRows','deleteRow','appendRow','clearContents','insertRows','getSheet('];
const encontradas = ESCRITURAS.filter(w => CUERPO.indexOf(w) >= 0);
ok(encontradas.length === 0, 'el cuerpo de horasPersona no contiene ninguna ruta de escritura' + (encontradas.length?' (encontrado: '+encontradas.join(', ')+')':''));
ok(GS.indexOf("if(a==='persona')") >= 0 || /a\s*===\s*'persona'/.test(GS), 'el endpoint está registrado en doGet');

if(fallos){ console.error('\n❌ '+fallos+' comprobación(es) fallida(s).'); process.exit(1); }
console.log('\n✅ El endpoint `persona` responde bien y su cerrojo de área es del backend, no de la interfaz.');

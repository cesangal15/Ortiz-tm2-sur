#!/usr/bin/env node
/**
 * Verificación de D121 — el administrador pasa a llamarse `cesar` (antes `admin`).
 *
 * POR QUÉ ESTA PRUEBA. `admin` era a la vez NOMBRE DE USUARIO y ROL, y las dos cosas se leen en sitios
 * distintos: los guards de PANTALLA miran el ROL (que NO cambia) y el backend de asistencias decide por
 * NOMBRE DE USUARIO (`areasDeUsuario`, `cuadrillasDeUsuario`, `guardarIndividual`, `gestionPersonal` —
 * ver §4.2 de arquitectura). El fallo que se evita aquí es SILENCIOSO: renombrar la fila de la hoja
 * `USUARIOS` a `cesar` sin tocar el código lo habría dejado entrando igual (el rol sigue siendo `admin`)
 * pero SIN cuadrillas que elegir en el formulario y SIN permiso para completar faltantes ni gestionar
 * personal — con un "No autorizado" que no explica nada.
 *
 * QUÉ SE COMPRUEBA:
 *   1) `esAdmin_` reconoce `cesar` y, durante la transición, también `admin` (el código y la hoja
 *      privada se cambian por separado: la app tiene que funcionar antes y después de renombrar).
 *   2) `cuadrillasDeUsuario('cesar')` devuelve TODAS las cuadrillas activas (no las inactivas).
 *   3) `areasDeUsuario('cesar')` = `[]` (sin filtro) y el `&area=` le sigue sirviendo de "Ver como".
 *   4) `guardarIndividual` y `gestionPersonal` lo autorizan, y siguen rechazando a un desconocido.
 *   5) La semilla de `backend/Codigo.gs` (hoja `USUARIOS`) ya no crea la fila `admin` sino `cesar`,
 *      conservando el ROL `admin`.
 *
 * CÓMO. Se carga `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script
 * de mentira; las funciones comprobadas son las reales del archivo, sin tocar.
 *
 * USO: node backend/pruebas/verificar_d121_usuario_cesar.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'CodigoAsistencias.gs');
const RUTA_OBRA = path.join(RAIZ, 'backend', 'Codigo.gs');
const HOY = '2026-08-03';

/* ---------- datos de prueba (mismo molde que la prueba de D119) ----------
 * Las de TIERRAS van con `area` VACÍA a propósito: es como están en el Sheet vivo. ARIEL va inactiva. */
const CUADRILLAS = [
  { cuadrilla:'ANGEL',      responsables:'angel',    area:'',    estado:'' },
  { cuadrilla:'OPERADORES', responsables:'jeisson',  area:'',    estado:'activa' },
  { cuadrilla:'ARIEL',      responsables:'ariel',    area:'',    estado:'inactiva' },
  { cuadrilla:'EDUARDO',    responsables:'eduardo',  area:'odt', estado:'activa' },
  { cuadrilla:'JAIRO',      responsables:'jairo',    area:'odl', estado:'activa' },
  { cuadrilla:'UF3',        responsables:'',         area:'uf3', estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'75781', cedula:'1090', nombre:'JUAN TIERRAS', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel', estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' }
];
const HOJAS = { CUADRILLAS, PERSONAL, ASISTENCIA:[], CONFIG:[], FESTIVOS:[], TURNOS:[], CAT_CC:[],
                CAT_MOTIVOS:[], MOTIVOS_USADOS:[], NOTAS_CUADRILLA:[], EXTRAS_ADMIN:[], CC_USADOS:[] };

/* ---------- sandbox de Apps Script ---------- */
function nuevoContexto(fuenteGs){
  const props = { AUTH_SECRETO:'secreto-de-prueba-suficientemente-largo-123456', AUTH_V:'1' };
  const escrituras = [];
  const ctx = {
    console, Date, Math, JSON, Number, String, Array, Object, isNaN, parseFloat, parseInt, RegExp, Error,
    ContentService:{ createTextOutput(txt){ return { texto:txt, setMimeType(){ return this; } }; },
                     MimeType:{ JSON:'JSON' } },
    Utilities:{ getUuid(){ return 'uuid-fijo'; }, formatDate(){ return HOY; }, Charset:{ UTF_8:'utf8' } },
    Logger:{ log(){} },
    PropertiesService:{ getScriptProperties(){ return {
      getProperty(k){ return Object.prototype.hasOwnProperty.call(props,k) ? props[k] : null; },
      setProperty(k,v){ props[k]=String(v); } }; } },
    SpreadsheetApp:{ openById(){ throw new Error('la prueba no debe abrir el Sheet'); } },
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuenteGs, ctx, { filename:'CodigoAsistencias.gs' });

  ctx.readSheet            = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerColumnasDeHoja_  = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerFilasPorFecha_   = function(){ return []; };
  ctx.invalidarHoja_       = function(){};
  ctx.localizarFilas_      = function(){ return []; };
  ctx.borrarFilas_         = function(){ return 0; };
  ctx.anexarFilas_         = function(_sh, filas){ escrituras.push({ op:'anexar', n:(filas||[]).length }); };
  ctx.getSheet = function(nombre){
    return {
      nombre, getLastRow(){ return 1; }, getLastColumn(){ return 20; },
      getMaxRows(){ return 1000; }, getMaxColumns(){ return 20; },
      insertRowsAfter(){}, deleteRows(){},
      appendRow(fila){ escrituras.push({ hoja:nombre, op:'appendRow', fila }); },
      getRange(){ return { setValue(){}, setValues(){}, getValues(){ return []; } }; }
    };
  };
  ctx._escrituras = escrituras;
  return ctx;
}

const ctx = nuevoContexto(fs.readFileSync(RUTA_GS, 'utf8'));

let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
function r(salida){ return JSON.parse(salida.texto); }

console.log('\n=== D121 — el administrador se llama `cesar` (el ROL sigue siendo `admin`) ===');

/* ---------------------------------------------------------------- 1 */
console.log('\n1) esAdmin_ — quién es el administrador');
ok(ctx.esAdmin_('cesar') === true, "`cesar` es el administrador");
ok(ctx.esAdmin_('  CESAR ') === true, 'normaliza mayúsculas/espacios (norm), como el resto del mapa');
ok(ctx.esAdmin_('admin') === true, '`admin` se sigue aceptando durante la transición (alias, como alejo/alejandro)');
ok(ctx.esAdmin_('angie') === false && ctx.esAdmin_('residente') === false && ctx.esAdmin_('') === false,
  'y nadie más lo es');

/* ---------------------------------------------------------------- 2 */
console.log('\n2) cuadrillasDeUsuario — el admin elige entre TODAS las activas');
const cuads = ctx.cuadrillasDeUsuario('cesar');
ok(cuads.indexOf('ANGEL') >= 0 && cuads.indexOf('OPERADORES') >= 0, 'las de tierras (columna `area` VACÍA)');
ok(cuads.indexOf('EDUARDO') >= 0 && cuads.indexOf('JAIRO') >= 0, 'las de ODT y ODL');
ok(cuads.indexOf('UF3') >= 0, 'y las de UF3 (el admin no tiene filtro de área)');
ok(cuads.indexOf('ARIEL') < 0, 'las INACTIVAS siguen fuera (D84)');
ok(JSON.stringify(ctx.cuadrillasDeUsuario('admin')) === JSON.stringify(cuads),
  'con el nombre viejo devuelve exactamente lo mismo (transición sin sorpresas)');

/* ---------------------------------------------------------------- 3 */
console.log('\n3) areasDeUsuario / areasEfectivas — sigue sin filtro y conserva el "Ver como"');
ok(JSON.stringify(ctx.areasDeUsuario('cesar')) === JSON.stringify([]), "areasDeUsuario('cesar') = [] (todas)");
const areasEf = (params) => ctx.areasEfectivas({ parameter: Object.assign({}, params) });
ok(JSON.stringify(areasEf({ usuario:'cesar' })) === JSON.stringify([]), 'sin &area= : ve todas');
ok(JSON.stringify(areasEf({ usuario:'cesar', area:'odt,odl' })) === JSON.stringify(['odt','odl']),
  '&area=odt,odl : drenajes completo (D116)');
ok(JSON.stringify(areasEf({ usuario:'cesar', area:'uf3' })) === JSON.stringify(['uf3']), '&area=uf3 : UF3');
ok(JSON.stringify(areasEf({ usuario:'cesar', area:'basura' })) === JSON.stringify([]),
  'un área inventada se ignora y quedan todas');

/* ---------------------------------------------------------------- 4 */
console.log('\n4) permisos de escritura — completar faltantes y gestión de personal');
ok(r(ctx.guardarIndividual({ usuario:'cesar', fecha:HOY, filas:[] })).ok === true,
  '`cesar` completa faltantes');
ok(r(ctx.guardarIndividual({ usuario:'admin', fecha:HOY, filas:[] })).ok === true,
  'y el nombre viejo también, mientras dure la transición');
const rechazo = r(ctx.guardarIndividual({ usuario:'pepito', fecha:HOY, filas:[] }));
ok(rechazo.ok === false && /No autorizado/.test(rechazo.error||''), 'un desconocido sigue rechazado');
ok(r(ctx.gestionPersonal({ usuario:'cesar', op:'alta', cuadrilla:'ANGEL', codigo:'99999',
                           nombre:'NUEVO DE PRUEBA', cargo:'AYUDANTE' })).ok === true,
  '`cesar` da de alta personal en cualquier área');
const rechazo2 = r(ctx.gestionPersonal({ usuario:'pepito', op:'alta', cuadrilla:'ANGEL', codigo:'99998' }));
ok(rechazo2.ok === false && /No autorizado/.test(rechazo2.error||''), 'un desconocido sigue rechazado');

/* ---------------------------------------------------------------- 5 */
console.log('\n5) semilla de la hoja USUARIOS (backend/Codigo.gs)');
const obra = fs.readFileSync(RUTA_OBRA, 'utf8');
ok(/\['cesar','','admin','','menu\.html','activo'\]/.test(obra),
  "setupUsuarios() siembra `cesar` con el ROL `admin` y entrada a menu.html");
ok(!/\['admin','','admin'/.test(obra), 'y ya NO siembra la fila `admin`');

console.log('\n' + (fallos ? '✗ ' + fallos + ' comprobación(es) fallaron' : '✓ todo correcto') + '\n');
process.exit(fallos ? 1 : 0);

#!/usr/bin/env node
/**
 * Verificación de D119 — `angie`, la persona dedicada a ASISTENCIAS de TM2 Sur, con alcance
 * MULTI-ÁREA (tierras + ODT + ODL) y UF3 fuera.
 *
 * QUÉ SE COMPRUEBA Y POR QUÉ. Es el primer usuario del módulo que mezcla tierras y drenajes, así que
 * las dos cosas que pueden salir mal son simétricas y las dos llegan a Navision:
 *   · que le FALTE algo suyo — sobre todo las cuadrillas de tierras, cuya columna `area` en la hoja
 *     CUADRILLAS está VACÍA (ANGEL, OPERADORES…): sin la normalización `'' -> tierras` no vería
 *     ninguna, y el filtro por área es el mismo que decide qué sale en el Parte;
 *   · que le SOBRE UF3, que no es suya (la lleva `residente_uf3`, D101) — ni para leer, ni para
 *     escribir, ni tecleando `&area=uf3` en la URL.
 * Más las dos piezas de diseño nuevas de esta decisión: la INTERSECCIÓN de `areasEfectivas` (el
 * `&area=` acota pero nunca amplía) y el cerrojo de identidad del token firmado (D109).
 *
 * CÓMO. Se carga `backend/CodigoAsistencias.gs` en un sandbox de `vm` con los servicios de Apps Script
 * de mentira y se sustituyen los puntos de lectura/escritura del Sheet por datos de prueba. Todo lo
 * demás —`areasDeUsuario`, `areasEfectivas`, `cuadrillasDeUsuario`, `cuadrillaPermitidaPara`,
 * `verificarToken_`, `doGet`, `doPost`— es el código real del archivo, sin tocar. El HMAC y el base64
 * son los de verdad (módulo `crypto` de Node), así que la prueba de firma inválida es real y no una
 * imitación.
 *
 * El bloque 9 (NO REGRESIÓN) compara las respuestas de los roles existentes contra las del MISMO
 * archivo en `git HEAD`, carácter a carácter. Si no hay git disponible, ese bloque se salta avisando.
 *
 * USO: node backend/pruebas/verificar_d119_asistencias_tm2.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const RUTA_GS = path.join(RAIZ, 'backend', 'CodigoAsistencias.gs');

const SECRETO = 'secreto-de-prueba-suficientemente-largo-123456';
const HOY = '2026-08-03';

/* ---------- datos de prueba ----------
 * Las de TIERRAS van con `area` VACÍA a propósito: es como están hoy en el Sheet vivo, y es justo el
 * caso que rompería el filtro si `norm(r.area)||'tierras'` desapareciera. ARIEL va inactiva (D84). */
const CUADRILLAS = [
  { cuadrilla:'ANGEL',       responsables:'angel',     area:'',      estado:'' },
  { cuadrilla:'ROBINSON',    responsables:'robinson',  area:'',      estado:'activa' },
  { cuadrilla:'OPERADORES',  responsables:'jeisson',   area:'',      estado:'' },
  { cuadrilla:'ARIEL',       responsables:'ariel',     area:'',      estado:'inactiva' },
  { cuadrilla:'EDUARDO',     responsables:'eduardo',   area:'odt',   estado:'activa' },
  { cuadrilla:'ENRIQUE',     responsables:'enrique',   area:'odt',   estado:'activa' },
  { cuadrilla:'DUVAN',       responsables:'duvan',     area:'odt',   estado:'' },
  { cuadrilla:'JAIRO',       responsables:'jairo',     area:'odl',   estado:'activa' },
  { cuadrilla:'UF3',         responsables:'',          area:'uf3',   estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'75781', cedula:'1090', nombre:'JUAN TIERRAS', cargo:'AYUDANTE', cuadrilla:'ANGEL',
    responsable:'angel',    estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' },
  { _row:3, codigo:'80001', cedula:'2200', nombre:'PEDRO ODT',    cargo:'OFICIAL',  cuadrilla:'EDUARDO',
    responsable:'eduardo',  estado:'activo', fecha_ingreso:'2026-02-01', fecha_retiro:'' },
  { _row:4, codigo:'80002', cedula:'2201', nombre:'LUIS ODL',     cargo:'OFICIAL',  cuadrilla:'JAIRO',
    responsable:'jairo',    estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' },
  { _row:5, codigo:'90001', cedula:'3300', nombre:'SARA UF3',     cargo:'AYUDANTE', cuadrilla:'UF3',
    responsable:'',         estado:'activo', fecha_ingreso:'2026-01-01', fecha_retiro:'' }
];
function filaAsis(fecha, codigo, cuadrilla, o){
  return Object.assign({ id_registro:'x', timestamp:'', fecha, reporta:'angel', cuadrilla, codigo,
    cedula:'', nombre:'', cargo:'', cc:'3701.02.05| EXCAVACION', proyecto:'3701',
    hora_entrada:'07:00', hora_salida:'15:30', presente:'Si', motivo_ausencia:'', observacion:'', turno:'1' }, o);
}
const ASISTENCIA = [
  filaAsis('2026-08-03','75781','ANGEL'),
  filaAsis('2026-08-03','80001','EDUARDO', { reporta:'eduardo' }),
  filaAsis('2026-08-03','80002','JAIRO',   { reporta:'jairo', proyecto:'3702', cc:'3702.06.01| CUNETA' }),
  filaAsis('2026-08-03','90001','UF3',     { reporta:'residente_uf3', proyecto:'3703', cc:'3703.02.05| EXCAV' }),
  // 02-ago-2026 = DOMINGO. Solo una cuadrilla reportó: en el flujo de dom/fest, los demás NO son faltantes.
  filaAsis('2026-08-02','75781','ANGEL')
];
const HOJAS = {
  CUADRILLAS, PERSONAL, ASISTENCIA,
  CONFIG:[ { clave:'max_extras_dia', valor:'2' }, { clave:'domfest_tope', valor:'7' },
           { clave:'proyecto_3701', valor:'3701| TM2 SUR UF1' }, { clave:'proyecto_3702', valor:'3702| TM2 SUR UF2' } ],
  FESTIVOS:[], TURNOS:[], CAT_CC:[], CAT_MOTIVOS:[{ string_motivo:'Incapacidad' }],
  MOTIVOS_USADOS:[], NOTAS_CUADRILLA:[], EXTRAS_ADMIN:[],
  CC_USADOS:[ { string_cc:'3701.02.05| EXCAVACION', area:'' },      // vacía = tierras
              { string_cc:'3701.06.01| CUNETA',     area:'odt' },
              { string_cc:'3702.06.01| CUNETA',     area:'odl' },
              { string_cc:'3703.02.05| EXCAV',      area:'uf3' } ]
};

/* ---------- sandbox de Apps Script ---------- */
function nuevoContexto(fuenteGs){
  const props = { AUTH_SECRETO: SECRETO, AUTH_V: '1' };
  const escrituras = [];   // lo que el código intentó escribir en el Sheet
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
    /* D125 metió `LockService.getScriptLock()` en `doPost` (serializar las escrituras) y este sandbox se
     * quedó sin él: TODO POST moría en el `catch` general y devolvía `ok:false`. Las cuatro
     * comprobaciones de escritura que deben SALIR BIEN llevaban desde entonces en rojo — y las que
     * esperan un rechazo pasaban por el motivo equivocado, que es lo de verdad peligroso: un guard de
     * permisos que se cree cumplido porque la petición falla por otra cosa.
     * Aquí basta con que exista; la serialización real la garantiza Apps Script. */
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fuenteGs, ctx, { filename:'CodigoAsistencias.gs' });

  ctx.readSheet = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  // Lector acotado por COLUMNAS (D102). Aquí devuelve las filas enteras: los campos de más no cambian
  // nada de lo que se comprueba, y evita tener que recortar la hoja de mentira columna por columna.
  ctx.leerColumnasDeHoja_ = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerFilasPorFecha_ = function(hoja, desde, hasta){
    if(hoja !== 'ASISTENCIA') throw new Error('lector acotado usado sobre ' + hoja);
    return ASISTENCIA.filter(r => r.fecha >= desde && r.fecha <= hasta);
  };
  ctx.invalidarHoja_ = function(){};
  // Hoja de mentira: registra lo que se escribiría sin tocar nada real.
  ctx.getSheet = function(nombre){
    return {
      nombre, getLastRow(){ return 1; }, getLastColumn(){ return 20; },
      getMaxRows(){ return 1000; }, getMaxColumns(){ return 20; },
      insertRowsAfter(){}, deleteRows(){},
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

const ctx = nuevoContexto(fs.readFileSync(RUTA_GS, 'utf8'));

/* ---------- utilidades de la prueba ---------- */
let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }
function token(c, usuario, rol, areas){ return c.emitirToken_(usuario, rol, areas||[]); }
const TOK_ANGIE = () => token(ctx, 'angie', 'asistencia_plus_tm2', ['tierras','odt','odl']);

function get(c, params){ return JSON.parse(c.doGet({ parameter: Object.assign({}, params) }).texto); }
function post(body){
  return JSON.parse(ctx.doPost({ postData:{ contents: JSON.stringify(body) }, parameter:{} }).texto);
}
function ordenar(a){ return (a||[]).slice().sort(); }
/* D133d — `?action=asistencia` manda `filas` y `faltantes` como {cols, datos} (cabecera una vez). Los
 * demás endpoints las siguen mandando como array de objetos. Este helper devuelve siempre una lista de
 * objetos, así que las comprobaciones de abajo se escriben igual sea cual sea la forma. */
function lista(v){
  if(Array.isArray(v)) return v;
  if(v && Array.isArray(v.cols) && Array.isArray(v.datos))
    return v.datos.map(f => { const o={}; v.cols.forEach((c,j)=>{ o[c] = (f[j]==null ? '' : f[j]); }); return o; });
  return [];
}

console.log('\n=== D119 — usuario de asistencias TM2 Sur (tierras + ODT + ODL) ===');

/* ---------------------------------------------------------------- 1 */
console.log('\n1) areasDeUsuario');
ok(JSON.stringify(ctx.areasDeUsuario('angie')) === JSON.stringify(['tierras','odt','odl']),
  "areasDeUsuario('angie') = ['tierras','odt','odl']");
ok(ctx.areasDeUsuario('angie').indexOf('uf3') < 0, 'UF3 NO está entre sus áreas');
ok(ctx.areasDeUsuario('ANGIE  ').length === 3, 'normaliza mayúsculas/espacios (norm) como el resto del mapa');

/* ---------------------------------------------------------------- 2 y 3 */
console.log('\n2-3) cuadrillasDeUsuario — todas las activas de sus tres áreas, ni UF3 ni inactivas');
const cuads = ctx.cuadrillasDeUsuario('angie');
ok(cuads.indexOf('ANGEL') >= 0 && cuads.indexOf('OPERADORES') >= 0,
  "las de TIERRAS salen aunque su columna `area` esté VACÍA ('' -> tierras)");
ok(cuads.indexOf('ROBINSON') >= 0, 'también las de tierras con estado explícito `activa`');
ok(cuads.indexOf('EDUARDO') >= 0 && cuads.indexOf('ENRIQUE') >= 0 && cuads.indexOf('DUVAN') >= 0, 'salen las de ODT');
ok(cuads.indexOf('JAIRO') >= 0, 'sale la de ODL');
ok(cuads.indexOf('UF3') < 0, 'NO sale ninguna de UF3');
ok(cuads.indexOf('ARIEL') < 0, 'NO sale la cuadrilla INACTIVA (ARIEL, D84)');
ok(cuads.length === 7, 'son exactamente las 7 activas de sus áreas — ' + cuads.length);
ok(JSON.stringify(ordenar(cuads)) !== JSON.stringify(ordenar(ctx.cuadrillasDeUsuario('duvan'))),
  'su lista es más amplia que la de duvan (que sigue viendo solo ODT+ODL)');

/* ---------------------------------------------------------------- 4 */
console.log('\n4) areasEfectivas — el &area= INTERSECTA: acota, nunca amplía');
function areasDe(params){ return ctx.areasEfectivas({ parameter: params }); }
ok(JSON.stringify(areasDe({ usuario:'angie' })) === JSON.stringify(['tierras','odt','odl']),
  'sin &area= usa sus tres áreas');
ok(JSON.stringify(areasDe({ usuario:'angie', area:'odl' })) === JSON.stringify(['odl']),
  '&area=odl la acota a ODL');
ok(JSON.stringify(areasDe({ usuario:'angie', area:'odt,odl' })) === JSON.stringify(['odt','odl']),
  '&area=odt,odl la acota a drenajes');
ok(JSON.stringify(areasDe({ usuario:'angie', area:'uf3' })) === JSON.stringify(['tierras','odt','odl']),
  '&area=uf3 → intersección VACÍA: se ignora el parámetro y quedan sus tres áreas');
ok(areasDe({ usuario:'angie', area:'uf3' }).indexOf('uf3') < 0, 'y en ningún caso aparece uf3');
ok(areasDe({ usuario:'angie', area:'uf3' }).length === 3, 'ni cae en "todas" (que sería [] = sin filtro)');
ok(JSON.stringify(areasDe({ usuario:'angie', area:'odl,uf3' })) === JSON.stringify(['odl']),
  'mezcla válida+ajena: se queda solo con la válida');
ok(JSON.stringify(areasDe({ usuario:'angie', area:'basura' })) === JSON.stringify(['tierras','odt','odl']),
  'un área inventada se ignora');
console.log('   · y el admin se comporta EXACTAMENTE igual que antes (D116):');
ok(JSON.stringify(areasDe({ usuario:'admin' })) === JSON.stringify([]), 'admin sin filtro = [] (todas)');
ok(JSON.stringify(areasDe({ usuario:'admin', area:'uf3' })) === JSON.stringify(['uf3']), 'admin puede ver UF3');
ok(JSON.stringify(areasDe({ usuario:'admin', area:'odt,odl' })) === JSON.stringify(['odt','odl']), 'admin ODT+ODL');
ok(JSON.stringify(areasDe({ usuario:'admin', area:'basura' })) === JSON.stringify([]), 'admin con basura = todas');
console.log('   · y los roles con área forzada tampoco pueden ampliar:');
ok(JSON.stringify(areasDe({ usuario:'residente_dren', area:'tierras' })) === JSON.stringify(['odt','odl']),
  'residente_dren pidiendo tierras: se ignora, sigue en ODT+ODL');
ok(JSON.stringify(areasDe({ usuario:'jeisson', area:'uf3' })) === JSON.stringify(['tierras']),
  'jeisson pidiendo UF3: se ignora, sigue en tierras');

/* ---------------------------------------------------------------- 5 */
console.log('\n5) Escritura sobre UF3 — rechazada por el backend (D69h)');
ok(ctx.cuadrillaPermitidaPara('angie','UF3') === false, 'cuadrillaPermitidaPara(angie, UF3) = false');
ok(ctx.cuadrillaPermitidaPara('angie','ANGEL') === true,  'pero SÍ una de tierras con `area` vacía');
ok(ctx.cuadrillaPermitidaPara('angie','JAIRO') === true,  'y SÍ una de ODL');

let r = post({ action:'reporte_asistencia', token:TOK_ANGIE(), fecha:HOY, cuadrilla:'UF3', filas:[] });
ok(r.ok === false, 'reporte_asistencia sobre la cuadrilla UF3: rechazado');
r = post({ action:'asistencia_individual', token:TOK_ANGIE(), fecha:HOY,
           filas:[{ cuadrilla:'UF3', codigo:'90001', presente:'Si' }] });
ok(r.ok === false, 'asistencia_individual (completar faltantes) en UF3: rechazado');
ok(/no es de tu área/i.test(String(r.error||'')), 'y lo dice por área, no por permiso genérico');
r = post({ action:'asistencia_individual', token:TOK_ANGIE(), fecha:HOY,
           filas:[{ cuadrilla:'ANGEL', codigo:'75781', presente:'Si' }] });
ok(r.ok === true, 'pero SÍ puede completar faltantes en una cuadrilla de tierras');
r = post({ action:'personal', token:TOK_ANGIE(), op:'alta', cuadrilla:'UF3', codigo:'99999', nombre:'X' });
ok(r.ok === false, 'dar de alta personal en una cuadrilla de UF3: rechazado');
r = post({ action:'personal', token:TOK_ANGIE(), op:'mover', _row:5, cuadrilla:'ANGEL' });
ok(r.ok === false, 'MOVER a alguien DESDE UF3 hacia tierras: rechazado');
r = post({ action:'personal', token:TOK_ANGIE(), op:'mover', _row:2, cuadrilla:'UF3' });
ok(r.ok === false, 'MOVER a alguien de tierras HACIA UF3: rechazado');
r = post({ action:'personal', token:TOK_ANGIE(), op:'mover', _row:2, cuadrilla:'JAIRO' });
ok(r.ok === true, 'pero SÍ puede mover de tierras a ODL (su alcance multi-área)');
r = post({ action:'personal', token:TOK_ANGIE(), op:'retiro', _row:4, fecha_retiro:'2026-08-10' });
ok(r.ok === true, 'y SÍ puede retirar a alguien de ODL');
r = post({ action:'personal', token:TOK_ANGIE(), op:'retiro', _row:5 });
ok(r.ok === false, 'pero NO retirar a alguien de UF3');

/* ---------------------------------------------------------------- 6 */
console.log('\n6) Token firmado (D109) — la identidad no la pone el cliente');
r = get(ctx, { action:'roster', token:TOK_ANGIE() });
ok(r.ok === true, 'con su token, el roster responde');
ok(JSON.stringify(r.areas) === JSON.stringify(['tierras','odt','odl']), 'y responde con SU alcance');

const tok = TOK_ANGIE();
const manipulado = ctx._b64url_(Buffer.from(JSON.stringify(
  { u:'angie', r:'admin', a:['tierras','odt','odl','uf3'], v:'1', t:Date.now() }))) + '.' + tok.split('.')[1];
r = get(ctx, { action:'roster', token: manipulado });
ok(r.ok === false && r.auth === false, 'el mismo token con el rol editado a `admin`: FIRMA INVÁLIDA, rechazado');

r = get(ctx, { action:'roster', token:TOK_ANGIE(), usuario:'admin' });
ok(r.ok === true, '?usuario=admin con su token: la petición pasa…');
ok(JSON.stringify(r.areas) === JSON.stringify(['tierras','odt','odl']),
  '…pero la sesión resultante sigue siendo la suya (el token pisa el parámetro)');
ok(r.cuadrillas.indexOf('UF3') < 0, 'y no le aparece ninguna cuadrilla de UF3');

r = get(ctx, { action:'roster' });
ok(r.ok === false && r.auth === false, 'sin token: rechazada');

console.log('   · y el cerrojo de área alcanza también a ?action=persona (D112):');
r = get(ctx, { action:'persona', token:TOK_ANGIE(), codigo:'90001', desde:'2026-08-01', hasta:'2026-08-31' });
ok(r.ok === false, 'pedir por URL a alguien de UF3: ok:false');
ok(!r.filas, 'y no le llega ninguna fila');
r = get(ctx, { action:'persona', token:TOK_ANGIE(), codigo:'75781', desde:'2026-08-01', hasta:'2026-08-31' });
ok(r.ok === true, 'pero SÍ ve a alguien de tierras');
r = get(ctx, { action:'persona', token:TOK_ANGIE(), codigo:'80002', desde:'2026-08-01', hasta:'2026-08-31' });
ok(r.ok === true, 'y a alguien de ODL');

/* ---------------------------------------------------------------- 7 */
console.log('\n7) Lecturas acotadas por areasEfectivas — una por una');
r = get(ctx, { action:'asistencia', token:TOK_ANGIE(), fecha:HOY });
const cuadResumen = (r.cuadrillas||[]).map(c => c.cuadrilla || c);
ok(r.ok === true, 'asistencia (resumen del día) responde');
ok(lista(r.filas).every(f => f.cuadrilla !== 'UF3'), 'ninguna fila de UF3 en el resumen');
ok(lista(r.filas).some(f => f.cuadrilla === 'ANGEL'), 'sí las de tierras');
ok(lista(r.filas).some(f => f.cuadrilla === 'JAIRO'), 'sí las de ODL');
ok(cuadResumen.indexOf('UF3') < 0, 'la lista de cuadrillas del resumen tampoco trae UF3');
ok(lista(r.faltantes).every(f => f.cuadrilla !== 'UF3'), 'ni los faltantes');

r = get(ctx, { action:'asistencia', token:TOK_ANGIE(), fecha:HOY, area:'uf3' });
ok(r.ok === true && lista(r.filas).every(f => f.cuadrilla !== 'UF3'),
  'y con &area=uf3 tecleado a mano en la URL sigue SIN ver gente de UF3');
ok(lista(r.filas).some(f => f.cuadrilla === 'ANGEL'), 'el parámetro se ignoró: ve sus tres áreas');

r = get(ctx, { action:'asistencia', token:TOK_ANGIE(), fecha:HOY, area:'odl' });
ok(r.ok === true && lista(r.filas).every(f => f.cuadrilla === 'JAIRO'), '&area=odl la deja solo con ODL');

r = get(ctx, { action:'personal', token:TOK_ANGIE() });
ok(r.ok === true && lista(r.personal||r.filas).every(p => p.cuadrilla !== 'UF3'),
  'personalCompleto: sin nadie de UF3');
r = get(ctx, { action:'ausencias', token:TOK_ANGIE(), desde:'2026-08-01', hasta:'2026-08-31' });
ok(r.ok === true, 'ausencias por rango (D94) responde para sus tres áreas');
ok(JSON.stringify(r).indexOf('SARA UF3') < 0, 'y no menciona a nadie de UF3');
r = get(ctx, { action:'export', token:TOK_ANGIE(), fecha:HOY });
ok(r.ok === true, 'export (Parte Navision) responde');
ok(lista(r.filas).every(f => f.proyecto !== '3703'), 'ninguna fila del Parte es del proyecto 3703');
ok(lista(r.filas).every(f => f.cuadrilla !== 'UF3'), 'ni de la cuadrilla UF3');
ok(JSON.stringify(lista(r.filas)).indexOf('SARA UF3') < 0, 'ni aparece su gente');
// NOTA: `proyectoDefecto` (mapa cuadrilla -> proyecto más frecuente) NO se acota por área, y no se
// acota desde D94: es un agregado global e igual para TODOS los roles (residente_dren, residente_uf3,
// jeisson…). Expone el par 'UF3'->'3703' y nada más: ni personas, ni horas, ni CC. Acotarlo cambiaría
// la respuesta de los roles existentes, así que queda FUERA de D119 (ver la entrega).
ok(!!r.proyectoDefecto, 'el mapa proyectoDefecto sigue viniendo completo, como para todos los roles');
r = get(ctx, { action:'roster', token:TOK_ANGIE() });
ok(r.cuadrillasArea && r.cuadrillasArea.ANGEL === 'tierras' && r.cuadrillasArea.JAIRO === 'odl',
  'el roster manda el área de cada cuadrilla, para etiquetar el selector del formulario');

/* ---------------------------------------------------------------- 8 */
console.log('\n8) Dom/fest — el 02-ago-2026 es domingo');
r = get(ctx, { action:'export', token:TOK_ANGIE(), fecha:'2026-08-02' });
ok(r.ok === true, 'el export del domingo responde');
ok(lista(r.filas).every(f => f.cuadrilla !== 'UF3'), 'y sigue sin UF3');
console.log('   (el flujo de dom/fest lo decide el frontend, `usaFlujoDomFest()`: ver el bloque 8b)');

/* ---------------------------------------------------------------- 8b: frontend */
console.log('\n8b) resumen-asistencia.html — helpers de vista del rol nuevo');
const RESUMEN = fs.readFileSync(path.join(RAIZ, 'resumen-asistencia.html'), 'utf8');
function fnDe(nombre){
  const m = RESUMEN.match(new RegExp('function\\s+' + nombre + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'));
  if(!m) throw new Error('no se encontró la función ' + nombre + ' en resumen-asistencia.html');
  return m[0];
}
const vista = {};
vm.createContext(vista);
vm.runInContext(['areasFiltro','filtroEsDrenajes','esVistaTierras','usaFlujoDomFest','esVistaDrenajes','opcionesVerComo']
  .map(fnDe).join('\n') + '\nvar STATE={rol:"",areaFiltro:""};', vista);
function conVista(rol, areaFiltro, fn){ vista.STATE = { rol, areaFiltro }; return vista[fn](); }

ok(conVista('asistencia_plus_tm2','','usaFlujoDomFest') === true, "usaFlujoDomFest = true en vista 'Todas'");
ok(conVista('asistencia_plus_tm2','tierras','usaFlujoDomFest') === true, 'true en Tierras');
ok(conVista('asistencia_plus_tm2','odt','usaFlujoDomFest') === true, 'true en ODT');
ok(conVista('asistencia_plus_tm2','odl','usaFlujoDomFest') === true, 'true en ODL (no depende de la vista)');
console.log('   · esVistaTierras = "la vista INCLUYE tierras" (§2.3b — si no, el Parte sale sin la fila del admin):');
ok(conVista('asistencia_plus_tm2','','esVistaTierras') === true,  "en 'Todas' es TRUE (el Parte lleva la fila de extras del admin)");
ok(conVista('asistencia_plus_tm2','tierras','esVistaTierras') === true, 'en Tierras: true');
ok(conVista('asistencia_plus_tm2','odt','esVistaTierras') === false, 'en ODT: false');
ok(conVista('asistencia_plus_tm2','odl','esVistaTierras') === false, 'en ODL: false');
console.log('   · el aviso del pisado del capataz en dom/fest (D115) le llega donde aplica:');
ok(conVista('asistencia_plus_tm2','','esVistaDrenajes') === true,   "en 'Todas': sí (puede marcar gente de ODT/ODL)");
ok(conVista('asistencia_plus_tm2','odt','esVistaDrenajes') === true, 'en ODT: sí');
ok(conVista('asistencia_plus_tm2','tierras','esVistaDrenajes') === false, 'en Tierras: no (allá el riesgo no existe)');
console.log('   · selector "Ver como":');
ok(JSON.stringify(conVista('asistencia_plus_tm2','','opcionesVerComo')) === JSON.stringify(['','tierras','odt','odl']),
  'ofrece Todas / Tierras / ODT / ODL y nada más (ni uf3)');
ok(JSON.stringify(conVista('admin','','opcionesVerComo')) === JSON.stringify(['','tierras','odt','odl','odt,odl','uf3']),
  'el del admin no cambia (D116)');
ok(conVista('residente_dren','','opcionesVerComo') === null, 'residente_dren sigue SIN selector');
ok(conVista('duvan','','opcionesVerComo') === null, 'duvan sigue sin selector');
console.log('   · REGRESIÓN CERO en los helpers de vista para los roles de antes:');
[['residente','',true],['asistencia_plus','',true],['admin','',true],['admin','tierras',true],
 ['admin','odt',false],['admin','odl',false],['admin','odt,odl',false],['admin','uf3',false],
 ['residente_dren','',false],['residente_odt','',false],['asistencia_plus_uf3','',false]
].forEach(function(c){
  ok(conVista(c[0],c[1],'esVistaTierras') === c[2],
    'esVistaTierras('+c[0]+(c[1]?', '+c[1]:'')+') = '+c[2]);
});
[['residente','',true],['asistencia_plus','',true],['asistencia_plus_dren','',true],['residente_dren','',true],
 ['residente_odt','',true],['residente_odl','',true],['asistencia_plus_uf3','',false],
 ['admin','',true],['admin','odt',true],['admin','odt,odl',true],['admin','uf3',false]
].forEach(function(c){
  ok(conVista(c[0],c[1],'usaFlujoDomFest') === c[2],
    'usaFlujoDomFest('+c[0]+(c[1]?', '+c[1]:'')+') = '+c[2]);
});

/* ---------------------------------------------------------------- 9 */
console.log('\n9) NO REGRESIÓN — respuestas idénticas a las de git HEAD para los roles existentes');
let fuenteVieja = null;
try{
  fuenteVieja = require('child_process')
    .execSync('git show HEAD:backend/CodigoAsistencias.gs', { cwd:RAIZ, encoding:'utf8', stdio:['ignore','pipe','ignore'] });
}catch(e){ /* sin git o sin HEAD: se salta */ }

if(!fuenteVieja){
  console.log('  ⚠ no se pudo leer la versión anterior con git — bloque OMITIDO');
} else {
  const viejo = nuevoContexto(fuenteVieja);
  // `cuadrillasArea` es el ÚNICO campo nuevo del roster (aditivo, D119): se quita antes de comparar y
  // se comprueba aparte que no cambió nada más.
  /* D133 — `?action=asistencia` adelgazó su respuesta A PROPÓSITO: `catCCUsados` viaja como índices
   * dentro de `catCC`, se sumó la firma `catCCv` y `filas` dejó de llevar `id_registro`, `timestamp` y
   * `observacion` (ninguna pantalla los lee). Se deshace ese formato en LAS DOS respuestas antes de
   * comparar: así este guard sigue detectando cualquier OTRA diferencia, que es para lo que está.
   * Si algún día se revierte D133, esta función deja de hacer nada por sí sola — no hay que tocarla. */
  function deshacerD133(o){
    if(Array.isArray(o.catCCUsados) && Array.isArray(o.catCC))
      o.catCCUsados = o.catCCUsados.map(v => typeof v === 'number' ? o.catCC[v] : v);
    delete o.catCCv;
    // D133d: `filas` y `faltantes` viajan como {cols, datos}. Se reconstruyen, y en el lado VIEJO se
    // rellenan las claves que no traía cada objeto (`faltantes` mezcla dos formas) para que las dos
    // salidas sean comparables clave a clave.
    ['filas','faltantes'].forEach(function(k){
      const v=o[k];
      if(v && !Array.isArray(v) && Array.isArray(v.cols) && Array.isArray(v.datos)){
        o[k]=v.datos.map(function(f){
          const x={}; v.cols.forEach(function(c,j){ x[c] = (f[j]==null ? '' : f[j]); }); return x;
        });
        o['_cols_'+k]=v.cols;
      }
    });
    if(Array.isArray(o.filas))
      o.filas.forEach(f => { delete f.id_registro; delete f.timestamp; delete f.observacion; });
    return o;
  }
  // Rellena en el lado viejo las claves que la cabecera común de D133d hace explícitas.
  function alinear(a, b){
    ['filas','faltantes'].forEach(function(k){
      const cols=b['_cols_'+k]; if(!cols || !Array.isArray(a[k])) return;
      a[k]=a[k].map(function(o){ const x={}; cols.forEach(function(c){ x[c]=(o[c]===undefined?'':o[c]); }); return x; });
    });
    // De LOS DOS lados: cuando la referencia de git ya trae D133d, `deshacerD133` también le pone estas
    // claves auxiliares, y borrarlas solo de `b` hacía que las respuestas difirieran por su culpa.
    [a,b].forEach(function(o){ delete o._cols_filas; delete o._cols_faltantes; });
    return a;
  }
  // Devuelve el OBJETO (lo necesita `alinear`, que compara los dos lados entre sí).
  function normalizaObj(txt){
    const o = JSON.parse(txt);
    delete o._ms; delete o._celdas; delete o.cuadrillasArea;
    return deshacerD133(o);
  }
  // Y la versión de siempre, en texto, para las comparaciones que no necesitan alinear nada (POST).
  function normaliza(txt){ return JSON.stringify(normalizaObj(txt)); }
  const ROLES = ['residente','jeisson','duvan','residente_dren','residente_uf3','residente_odt','residente_odl',
                 'admin','mairy','angel','eduardo','jairo'];
  const PETICIONES = [
    { action:'roster' },
    { action:'asistencia', fecha:HOY },
    { action:'asistencia', fecha:'2026-08-02' },
    { action:'personal' },
    { action:'export', fecha:HOY },
    { action:'ausencias', desde:'2026-08-01', hasta:'2026-08-31' },
    { action:'persona', codigo:'75781', desde:'2026-08-01', hasta:'2026-08-31' },
    { action:'persona', codigo:'80002', desde:'2026-08-01', hasta:'2026-08-31' }
  ];
  let distintas = 0, comparadas = 0;
  ROLES.forEach(function(u){
    PETICIONES.forEach(function(p){
      const t = token(viejo, u, 'x', []);
      const a = normalizaObj(viejo.doGet({ parameter: Object.assign({ token:t }, p) }).texto);
      const b = normalizaObj(ctx.doGet({ parameter: Object.assign({ token:t }, p) }).texto);
      comparadas++;
      if(JSON.stringify(alinear(a, b)) !== JSON.stringify(b)){
        distintas++; console.error('  ✗ DIFIERE — usuario=' + u + ' ' + JSON.stringify(p));
      }
    });
  });
  ok(distintas === 0, comparadas + ' respuestas GET comparadas carácter a carácter: ' +
     (distintas ? distintas + ' DIFIEREN' : 'todas idénticas'));

  // Escrituras: mismos rechazos y mismas aceptaciones que antes para los canales existentes.
  let distPost = 0, compPost = 0;
  [ { action:'asistencia_individual', fecha:HOY, filas:[{ cuadrilla:'ANGEL', codigo:'75781', presente:'Si' }] },
    { action:'asistencia_individual', fecha:HOY, filas:[{ cuadrilla:'UF3', codigo:'90001', presente:'Si' }] },
    { action:'personal', op:'alta', cuadrilla:'ANGEL', codigo:'11111', nombre:'NUEVO' },
    { action:'personal', op:'alta', cuadrilla:'UF3',   codigo:'22222', nombre:'NUEVO' },
    { action:'personal', op:'mover', _row:2, cuadrilla:'JAIRO' },
    { action:'personal', op:'retiro', _row:3 }
  ].forEach(function(b){
    ROLES.forEach(function(u){
      const t = token(viejo, u, 'x', []);
      const cuerpo = JSON.stringify(Object.assign({ token:t }, b));
      const a = normaliza(viejo.doPost({ postData:{ contents:cuerpo }, parameter:{} }).texto);
      const c = normaliza(ctx.doPost({ postData:{ contents:cuerpo }, parameter:{} }).texto);
      compPost++;
      if(a !== c){ distPost++; console.error('  ✗ DIFIERE (POST) — usuario=' + u + ' ' + JSON.stringify(b)); }
    });
  });
  ok(distPost === 0, compPost + ' respuestas POST comparadas: ' +
     (distPost ? distPost + ' DIFIEREN' : 'todas idénticas'));

  // Y el campo nuevo del roster está, y es lo único que se agregó.
  const rosterNuevo = JSON.parse(ctx.doGet({ parameter:{ action:'roster', token:token(ctx,'angel','capataz',[]) } }).texto);
  ok(!!rosterNuevo.cuadrillasArea, 'el roster de un capataz trae `cuadrillasArea` (campo aditivo, no rompe nada)');
}

/* ---------------------------------------------------------------- */
console.log('\n' + (fallos ? '❌ ' + fallos + ' comprobación(es) FALLARON' : '✅ Todo correcto'));
process.exit(fallos ? 1 : 0);

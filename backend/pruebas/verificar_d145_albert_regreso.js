#!/usr/bin/env node
/**
 * Verificación de D145 — `albert` vuelve de UF3 a tierras (UF1/UF2) y recupera su login.
 *
 * QUÉ SE COMPRUEBA Y POR QUÉ. Reactivar a alguien es un cambio de DATOS (una fila de la hoja
 * `USUARIOS`), pero tiene dos filos que sí conviene clavar con código:
 *
 *   · que vuelva **solo lo que se acordó**: el reporte de OBRA. La asistencia no se mueve — la
 *     cuadrilla ALBERT conserva el nombre y la reportan `maleja`/`maria` (D84(3)/D134). Si al volver
 *     el sistema le entregara "su" cuadrilla, dos canales se pisarían el mismo día (D03/D107: el
 *     envío pisa fecha+cuadrilla) y quien la reporta todos los días se quedaría sin saberlo.
 *   · que el interruptor de D108 (`estado` en `USUARIOS`) funcione en LOS DOS SENTIDOS: `activo` deja
 *     entrar con el rol y el `redirige` de la fila, y cualquier otra cosa lo bloquea sin borrar nada.
 *     Es el mecanismo por el que salió en D84 y por el que vuelve ahora.
 *
 * Y tres comprobaciones de forma sobre el repo, que es donde vive la otra mitad del cambio: el tile,
 * la exclusión del tile de asistencia y la lista de capataces esperados del panel del encargado.
 *
 * CÓMO. Se cargan los DOS backends reales en un sandbox de `vm` con los servicios de Apps Script de
 * mentira y la lectura del Sheet sustituida por datos de prueba (mismo patrón que
 * `verificar_d134_maria_albert.js`). El HMAC es el de Node, así que el token firmado de D109 se emite
 * y se verifica de verdad.
 *
 * USO: node backend/pruebas/verificar_d145_albert_regreso.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const SECRETO = 'secreto-de-prueba-suficientemente-largo-123456';
const HOY = '2026-09-02';   // miércoles

let fallos = 0;
function ok(cond, msg){ if(cond) console.log('  ✓ '+msg); else { fallos++; console.error('  ✗ '+msg); } }

/* ---------- servicios de Apps Script de mentira (comunes a los dos backends) ---------- */
function servicios(props){
  return {
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
      computeDigest(alg, txt){
        return Array.from(crypto.createHash('sha256').update(String(txt), 'utf8').digest());
      },
      DigestAlgorithm:{ SHA_256:'sha256' },
      Charset:{ UTF_8:'utf8' }
    },
    Logger:{ log(){} },
    PropertiesService:{ getScriptProperties(){ return {
      getProperty(k){ return Object.prototype.hasOwnProperty.call(props,k) ? props[k] : null; },
      setProperty(k,v){ props[k]=String(v); } }; } },
    SpreadsheetApp:{ openById(){ throw new Error('la prueba no debe abrir el Sheet'); } },
    CacheService:{ getScriptCache(){ return { get(){ return null; }, put(){}, remove(){} }; } },
    LockService:{ getScriptLock(){ return { waitLock(){ return true; }, releaseLock(){} }; } },
    Session:{ getScriptTimeZone(){ return 'America/Bogota'; } }
  };
}

function cargar(archivo, HOJAS){
  const ctx = servicios({ AUTH_SECRETO: SECRETO, AUTH_V: '1' });
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'backend', archivo), 'utf8'), ctx, { filename:archivo });
  ctx.readSheet = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerColumnasDeHoja_ = function(nombre){ return (HOJAS[nombre] || []).slice(); };
  ctx.leerFilasPorFecha_ = function(hoja){ return (HOJAS[hoja] || []).slice(); };
  ctx.invalidarHoja_ = function(){};
  return ctx;
}
function post(c, body){ return JSON.parse(c.doPost({ postData:{ contents: JSON.stringify(body) }, parameter:{} }).texto); }
function get(c, params){ return JSON.parse(c.doGet({ parameter: Object.assign({}, params) }).texto); }
function ordenar(a){ return (a||[]).slice().sort(); }

console.log('\n=== D145 — `albert` vuelve de UF3 a tierras y recupera su login ===');

/* ================================================================ 1
 * OBRA — la fila de `USUARIOS` lo deja entrar con su rol de siempre.
 * La clave va EN CLARO en una fila y en HASH en la otra a propósito: el login admite las dos formas
 * (D108) y la hoja viva puede tener cualquiera de ellas según si ya se corrió `endurecerClaves()`. */
const CLAVE = 'uf1-2-2026';
function usuariosObra(estadoAlbert, claveEnHash){
  const ctxHash = cargar('Codigo.gs', {});      // solo para calcular el hash con el código real
  const clave = claveEnHash ? ctxHash.hashClave_('albert', CLAVE) : CLAVE;
  return { USUARIOS:[
    { usuario:'angel',    clave:CLAVE, rol:'capataz', areas:'', redirige:'seleccion-reporte.html', estado:'activo' },
    { usuario:'albert',   clave:clave, rol:'capataz', areas:'', redirige:'reporte-capataz.html',   estado:estadoAlbert },
    { usuario:'maleja',   clave:CLAVE, rol:'chequeadora', areas:'', redirige:'seleccion-reporte.html', estado:'activo' }
  ] };
}

console.log('\n1) OBRA — login de `albert` (hoja USUARIOS, D108)');
{
  const c = cargar('Codigo.gs', usuariosObra('activo', false));
  const r = post(c, { action:'login', usuario:'albert', clave:CLAVE });
  ok(r.ok === true, 'entra con su fila en `activo`');
  ok(r.rol === 'capataz', 'con el rol `capataz` — el mismo que tenía antes de UF3');
  ok(r.redirige === 'reporte-capataz.html', 'y aterriza DIRECTO en su reporte de obra');
  ok(JSON.stringify(r.areas) === JSON.stringify([]), 'sin áreas forzadas (tierras es el caso por defecto)');
  const t = c.verificarToken_(r.token);
  ok(t.ok === true && t.usuario === 'albert' && t.rol === 'capataz',
    'el token firmado (D109) lo acredita como `albert`/`capataz`');
  ok(post(c, { action:'login', usuario:'albert', clave:'otra' }).ok === false, 'con clave mala no entra');
}
{
  const c = cargar('Codigo.gs', usuariosObra('activo', true));
  ok(post(c, { action:'login', usuario:'albert', clave:CLAVE }).ok === true,
    'entra igual con la clave ya endurecida a hash SHA-256 (endurecerClaves)');
  ok(post(c, { action:'login', usuario:'  ALBERT ', clave:CLAVE }).ok === true,
    'y el usuario se normaliza (mayúsculas/espacios al teclearlo en el móvil)');
}
{
  // El interruptor por el que salió en D84 sigue funcionando: es reversible sin borrar la fila.
  const c = cargar('Codigo.gs', usuariosObra('inactivo', false));
  const r = post(c, { action:'login', usuario:'albert', clave:CLAVE });
  ok(r.ok === false, 'con `estado=inactivo` NO entra (el interruptor de D108 sigue vivo)');
  ok(/Usuario o contraseña incorrectos/.test(String(r.error||'')),
    'y el mensaje es el genérico: la pantalla no delata qué usuarios existen');
}

/* ================================================================ 2
 * ASISTENCIAS — lo que NO vuelve. */
const CUADRILLAS = [
  { cuadrilla:'ANGEL',       responsables:'angel',          area:'',    estado:'' },
  { cuadrilla:'ROBINSON',    responsables:'robinson',       area:'',    estado:'activa' },
  { cuadrilla:'ALBERT',      responsables:'maleja, maria',  area:'',    estado:'' },
  { cuadrilla:'ARIEL',       responsables:'',               area:'',    estado:'inactiva' },
  { cuadrilla:'ALEJANDRO',   responsables:'alejandro',      area:'',    estado:'' },
  { cuadrilla:'OPERADORES',  responsables:'jeisson',        area:'',    estado:'' },
  { cuadrilla:'VOLQUETEROS', responsables:'mairy',          area:'',    estado:'' },
  { cuadrilla:'JAIRO',       responsables:'jairo',          area:'odl', estado:'activa' }
];
const PERSONAL = [
  { _row:2, codigo:'70001', cedula:'1001', nombre:'JUAN ALBERT', cargo:'AYUDANTE', cuadrilla:'ALBERT',
    responsable:'maleja', estado:'activo', fecha_ingreso:'2026-01-15', fecha_retiro:'' }
];
const HOJAS_ASIS = {
  CUADRILLAS, PERSONAL, ASISTENCIA:[],
  CONFIG:[ { clave:'max_extras_dia', valor:'2' }, { clave:'domfest_tope', valor:'7' } ],
  FESTIVOS:[], TURNOS:[], CAT_CC:[], CAT_MOTIVOS:[], MOTIVOS_USADOS:[], NOTAS_CUADRILLA:[],
  EXTRAS_ADMIN:[], CC_USADOS:[]
};

console.log('\n2) ASISTENCIAS — la cuadrilla ALBERT NO vuelve con él (D84(3)/D134 intactos)');
{
  const a = cargar('CodigoAsistencias.gs', HOJAS_ASIS);
  ok(JSON.stringify(a.cuadrillasDeUsuario('albert')) === JSON.stringify([]),
    "cuadrillasDeUsuario('albert') = [] — no se le entrega ninguna cuadrilla");
  ok(a.cuadrillasDeUsuario('albert').indexOf('ALBERT') < 0,
    'ni siquiera la que lleva su nombre: la columna `responsables` manda, no el nombre de la cuadrilla');
  ok(ordenar(a.cuadrillasDeUsuario('maleja')).indexOf('ALBERT') >= 0, '`maleja` conserva su canal (D84(3))');
  ok(ordenar(a.cuadrillasDeUsuario('maria')).indexOf('ALBERT') >= 0, '`maria` conserva el relevo temporal (D134)');
  const r = get(a, { action:'roster', token:a.emitirToken_('albert','capataz',[]), fecha:HOY });
  ok(JSON.stringify(r.cuadrillas || []) === JSON.stringify([]),
    'y el roster con su token no le devuelve ninguna cuadrilla (formulario vacío, por eso no ve el tile)');
}

/* ================================================================ 3
 * El repo — las tres piezas de frontend/semilla que acompañan al dato. */
console.log('\n3) Repo — tiles, exclusión del tile de asistencia y capataces esperados');
{
  const sel = fs.readFileSync(path.join(RAIZ, 'seleccion-reporte.html'), 'utf8');
  ok(/'albert':\s*\[\{href:'reporte-capataz\.html'/.test(sel),
    "seleccion-reporte.html tiene el tile de `albert` → reporte-capataz.html");
  ok(/usuario!=='albert'/.test(sel),
    'y lo EXCLUYE del tile automático de asistencia (su cuadrilla la reportan maleja/maria)');
  ok(!/'ariel':/.test(sel), '`ariel` sigue sin tile: D145 solo devuelve a `albert`');

  const enc = fs.readFileSync(path.join(RAIZ, 'encargado.html'), 'utf8');
  const m = enc.match(/const CAPATACES_ESPERADOS = \[([^\]]*)\]/);
  ok(!!m && /'albert'/.test(m[1]), 'encargado.html vuelve a esperar su reporte en la bandeja');
  ok(!!m && !/'ariel'/.test(m[1]), 'y `ariel` sigue fuera de los esperados');

  const gs = fs.readFileSync(path.join(RAIZ, 'backend', 'Codigo.gs'), 'utf8');
  ok(/\['albert','','capataz','','reporte-capataz\.html','activo'\]/.test(gs),
    "la semilla setupUsuarios() de Codigo.gs lleva su fila (instalación nueva)");
}

console.log(fallos ? '\n=== ' + fallos + ' COMPROBACIÓN(ES) FALLIDA(S) ===\n'
                   : '\n=== TODO OK ===\n');
process.exit(fallos ? 1 : 0);

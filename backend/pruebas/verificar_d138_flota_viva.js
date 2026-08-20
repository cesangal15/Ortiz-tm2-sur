#!/usr/bin/env node
/**
 * Verificación D138 — catálogo de máquinas VIVO (hoja MAQUINAS).
 *
 * Se ejecuta contra el código REAL: carga `Codigo.gs` como módulo con un Sheet falso en memoria y
 * extrae los <script> de los HTML. No abre el Sheet real ni la red.
 *
 * Lo que puede romperse en silencio y por eso se comprueba:
 *   · la ventana de vigencia — si fuera cerrada-cerrada en vez de semiabierta, el día del retiro la
 *     máquina seguiría "en obra" y saldría como faltante el día en que ya no estaba;
 *   · las estancias múltiples (el caso FNG02/CR08) — con una sola fila por máquina no se distingue
 *     "estuvo en agosto pero no en julio" de "está desde julio";
 *   · el respaldo — si la hoja vacía devolviera flota VACÍA, el capataz no podría reportar NINGUNA
 *     máquina y todo saldría como faltante;
 *   · la recepción de reportes — `guardarReporte` NO puede validar contra el catálogo: un reporte de
 *     la cola sin señal (D82) con una máquina ya devuelta se perdería;
 *   · el respaldo del cliente — `TM2Flota.cargar` nunca puede resolver vacío ni lanzar.
 *
 *   node backend/pruebas/verificar_d138_flota_viva.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

/* ---------- Sheet falso: solo lo que toca flotaEnFecha_ / getFlotaRows_ ---------- */
function hojaFalsa(filas){
  // filas = matriz cruda incluyendo la fila de encabezados
  return {
    getLastRow: ()=>filas.length,
    getLastColumn: ()=>filas.reduce((m,r)=>Math.max(m,r.length),0),
    getRange: (f,c,nf,nc)=>({ getValues: ()=>{
      const out=[];
      for(let i=f-1;i<f-1+nf;i++){ const r=filas[i]||[], fila=[];
        for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]);
        out.push(fila); }
      return out;
    }})
  };
}

function cargarBackend(filasMaquinas){
  const src=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8');
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({
      getSheetByName: n => (n==='MAQUINAS' && filasMaquinas) ? hojaFalsa(filasMaquinas) : null,
      getSpreadsheetTimeZone: ()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:t=>({ setMimeType:()=>t }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put:()=>{} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:()=>null, setProperty:()=>{} }) },
    Utilities:{ computeHmacSha256Signature:()=>[], base64Encode:()=>'' },
    Session:{ getScriptTimeZone:()=>'America/Bogota' }
  };
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

const H=['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas'];

console.log('\n1 · Ventana de vigencia semiabierta [ingreso, retiro)');
{
  const ctx=cargarBackend([H,
    ['BL005','BULLDOZER',6.4,'propia','2026-01-01','',''],
    ['FNG02','FINISHER',6.4,'propia','2026-08-03','2026-08-20','BTC agosto']
  ]);
  const f=d=>ctx.flotaEnFecha_(d);
  ok('el día del ingreso YA está en obra',            !!f('2026-08-03').catalogo.FNG02);
  ok('un día antes del ingreso NO está',              !f('2026-08-02').catalogo.FNG02);
  ok('la víspera del retiro sigue en obra',           !!f('2026-08-19').catalogo.FNG02);
  ok('el día del retiro YA NO está (semiabierta)',    !f('2026-08-20').catalogo.FNG02,
     'fecha_retiro es el primer día que ya no estuvo (D85)');
  ok('después del retiro tampoco',                    !f('2026-09-01').catalogo.FNG02);
  ok('la de fecha_retiro vacía sigue vigente',        !!f('2027-05-05').catalogo.BL005);
  ok('la fuente es la hoja',                          f('2026-08-10').fuente==='hoja');
}

console.log('\n2 · Estancias MÚLTIPLES: el caso FNG02 / CR08 (entra y sale varias veces)');
{
  const ctx=cargarBackend([H,
    ['BL005','BULLDOZER',6.4,'propia','2026-01-01','',''],
    ['FNG02','FINISHER',6.4,'propia','2026-06-01','2026-06-15',''],
    ['FNG02','FINISHER',6.4,'propia','2026-08-03','2026-08-20',''],
    ['CR08','VIBROCOMPACTADOR',6.4,'propia','2026-08-03','2026-08-20','pareja del finisher']
  ]);
  const f=d=>ctx.flotaEnFecha_(d);
  ok('estuvo en la 1ª estancia (junio)',        !!f('2026-06-10').catalogo.FNG02);
  ok('NO estuvo en el hueco (julio)',           !f('2026-07-10').catalogo.FNG02,
     'con una sola fila por máquina este día saldría como presente');
  ok('estuvo en la 2ª estancia (agosto)',       !!f('2026-08-10').catalogo.FNG02);
  ok('el vibro de pareja acompaña al finisher', !!f('2026-08-10').catalogo.CR08 && !f('2026-07-10').catalogo.CR08);
  ok('en el hueco la flota es solo el bulldozer', Object.keys(f('2026-07-10').catalogo).join(',')==='BL005');
}

console.log('\n3 · Respaldo cuando la hoja no sirve (nunca una flota VACÍA)');
{
  const sinHoja=cargarBackend(null);
  const r1=sinHoja.flotaEnFecha_('2026-08-10');
  ok('sin hoja cae al catálogo en código',      r1.fuente==='codigo');
  ok('y devuelve una flota NO vacía',           Object.keys(r1.catalogo).length>0,
     'una flota vacía dejaría al capataz sin poder reportar máquinas');
  ok('las intermitentes NO se esperan',         r1.esperadas.indexOf('FNG02')<0 && r1.esperadas.indexOf('CR08')<0);
  ok('pero SÍ están en el catálogo (reportables)', !!r1.catalogo.FNG02 && !!r1.catalogo.CR08);
  ok('el resto sí se espera',                   r1.esperadas.indexOf('BL005')>=0);

  const soloEncabezado=cargarBackend([H]);
  ok('hoja solo con encabezado también cae al respaldo', soloEncabezado.flotaEnFecha_('2026-08-10').fuente==='codigo');

  const basura=cargarBackend([H, ['','','','','',''], ['XX','',null,'','no-es-fecha','']]);
  const r2=basura.flotaEnFecha_('2026-08-10');
  ok('filas sin fecha_ingreso válida caen al respaldo', r2.fuente==='codigo');
  ok('y lo avisan en vez de tragárselo',        r2.avisos.some(a=>/fecha_ingreso/.test(a)), JSON.stringify(r2.avisos));
}

console.log('\n4 · Horas programadas y tipos');
{
  const ctx=cargarBackend([H,
    ['NH403','VIBROCOMPACTADOR','', 'alquilada','2026-01-01','',''],
    ['MO03','MOTONIVELADORA','',    'propia',   '2026-01-01','',''],
    ['ZZ9','COSA RARA',6.4,         'propia',   '2026-01-01','','']
  ]);
  const c=ctx.flotaEnFecha_('2026-08-10');
  ok('sin horas_prog, alquilada = 5 h',   c.catalogo.NH403.prog===5);
  ok('sin horas_prog, propia = 6.4 h',    c.catalogo.MO03.prog===6.4);
  ok('un tipo desconocido no tumba nada', !!c.catalogo.ZZ9);
  ok('pero se avisa',                     c.avisos.some(a=>/COSA RARA/.test(a)), JSON.stringify(c.avisos));
  ok('vibro = sin producción',            ctx.esTipoSinProduccion(c.catalogo.NH403.tipo)===true);
  ok('motoniveladora = con producción',   ctx.esTipoSinProduccion(c.catalogo.MO03.tipo)===false);
}

console.log('\n5 · La recepción de reportes NO valida contra el catálogo (cola offline, D82)');
{
  const src=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8');
  const cuerpo=src.slice(src.indexOf('function guardarReporte('),
                         src.indexOf('function ', src.indexOf('function guardarReporte(')+30));
  ok('guardarReporte no consulta MAQ_CATALOGO',  cuerpo.indexOf('MAQ_CATALOGO')<0);
  ok('guardarReporte no consulta flotaEnFecha_', cuerpo.indexOf('flotaEnFecha_')<0,
     'validar ahí perdería un reporte que esperó en el teléfono a que volviera la señal');
}

console.log('\n6 · Cliente: TM2Flota nunca deja a la pantalla sin lista');
{
  const js=fs.readFileSync(path.join(REPO,'flota.js'),'utf8');
  const ctx={ console, window:{}, fetch:()=>Promise.reject(new Error('sin red')),
              localStorage:{getItem:()=>null,setItem:()=>{}}, Promise };
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
  const F=ctx.window.TM2Flota;
  ok('expone TM2Flota', !!F);
  ok('sinProduccion decide por TIPO', F.sinProduccion('VIBROCOMPACTADOR')===true && F.sinProduccion('EXCAVADORA')===false);
  return F.cargar('http://x', '2026-08-10', {ids:['BL005'], tipos:{BL005:'BULLDOZER'}, prog:{}})
    .then(function(fl){
      ok('sin red y sin caché cae al respaldo de la pantalla', fl.fuente==='respaldo');
      ok('y NO devuelve lista vacía',                          fl.maquinas.length===1 && fl.maquinas[0].id_maquina==='BL005');
      cerrar();
    });
}

function cerrar(){
  console.log('\n'+(fallos===0 ? '✅ '+casos+' comprobaciones, todas OK' : '❌ '+fallos+' de '+casos+' fallaron'));
  process.exit(fallos===0?0:1);
}

/**
 * Verificación — conciliador de actas, Paso 3: IGNORAR una hoja ya cargada.
 *
 * Bug corregido (ago-2026): el modal "Cambiar ámbito" del botón «cambiar» solo
 * ofrecía GRANULARES / TERRAPLEN / TERRAPLEN (interno) / AMBAS. La opción
 * IGNORAR existía únicamente en el selector de una hoja NO reconocida
 * (`sin_ambito`), así que una hoja que el patrón enrutó a una base —el caso
 * real: FRESADO → GRANULARES— no se podía sacar del corte: no había forma de
 * decir "esta hoja no va". Además `aplicarAmbito` no contemplaba IGNORAR (habría
 * re-conciliado las filas contra un ámbito inexistente) y una hoja ignorada no
 * tenía botón de vuelta.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_ignorar_hoja.js
 */
'use strict';
const path=require('path');

// El script es de navegador: stubs mínimos para que autosave/render/toast no revienten.
global.document={getElementById:()=>null};
global.localStorage={_d:{},getItem(k){return this._d[k]||null;},setItem(k,v){this._d[k]=String(v);},removeItem(k){delete this._d[k];}};
let RESPUESTA_CONFIRM=true, CONFIRMS=0;
global.confirm=()=>{ CONFIRMS++; return RESPUESTA_CONFIRM; };

const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,Paso3,configSeed,getContratista,resolverAmbitoHoja,mkReclamo}=C;

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};

// Hoja de proforma mínima: encabezado en la fila 1 y dos remisiones.
function wsFresado(){
  return {'!ref':'A1:B3',
    A1:{t:'s',v:'REMISION'}, B1:{t:'s',v:'MATERIAL'},
    A2:{t:'s',v:'9001'},     B2:{t:'s',v:'BASE'},
    A3:{t:'s',v:'9002'},     B3:{t:'s',v:'BASE'}};
}

function montarCorte(){
  S.config=configSeed();
  S.bases={GRANULARES:null,TERRAPLEN:null};
  const c=S.config.contratistas[0];
  const meta={nombre:'FRESADO',estado:'ok',ambito:'GRANULARES',modo:null,enc:{fila:1,col:0},n:2,notas:[],_ws:wsFresado()};
  const pf={idx:0,archivo:'proforma.xlsx',hojas:[meta]};
  S.corte={contratistaId:c.id,quincena:{inicio:'2026-07-22',fin:'2026-08-10'},abiertoEn:'2026-08-14T00:00:00.000Z',
    proformas:[pf],reclamos:[],yaNoReclamadas:[],secuencia:0};
  const mk=(rem,hoja)=>mkReclamo({remision:rem,archivo:'proforma.xlsx',hoja,fila:2,ambito:'GRANULARES',secundarios:{}});
  S.corte.reclamos.push(mk('9001','FRESADO'), mk('9002','FRESADO'), mk('7001','PUTANA'));
  S.corte.reclamos[1].decisionManual=true;   // decidida a mano: también sale del corte
  return {c,pf,meta};
}

console.log('\n1) Ignorar una hoja ya enrutada (el caso del usuario: FRESADO → GRANULARES)');
let {c,meta}=montarCorte();
RESPUESTA_CONFIRM=true;
Paso3.aplicarAmbito(0,0,'IGNORAR',null,true);
chk('la hoja queda ignorada', meta.estado, 'ignorada');
chk('sin ámbito colgando', [meta.ambito,meta.modo,meta.n], [null,null,null]);
chk('sus reclamaciones salen del corte', S.corte.reclamos.map(r=>r.remision), ['7001']);
chk('pidió confirmación (había filas)', CONFIRMS, 1);
chk('regla guardada en el contratista', (getContratista(c.id).hojas[0]||{}).ambito, 'IGNORAR');
chk('la regla enruta la hoja a IGNORAR', resolverAmbitoHoja('FRESADO',getContratista(c.id)).ambito, 'IGNORAR');

console.log('\n2) Cancelar en la confirmación no toca nada');
({c,meta}=montarCorte());
CONFIRMS=0; RESPUESTA_CONFIRM=false;
Paso3.aplicarAmbito(0,0,'IGNORAR',null,true);
chk('la hoja sigue en GRANULARES', [meta.estado,meta.ambito], ['ok','GRANULARES']);
chk('las reclamaciones siguen', S.corte.reclamos.length, 3);
chk('no guardó la regla', getContratista(c.id).hojas.some(h=>h.patron==='^FRESADO$'), false);

console.log('\n3) Hoja ignorada → se puede devolver al corte (re-extrae del archivo)');
({c,meta}=montarCorte());
RESPUESTA_CONFIRM=true;
Paso3.aplicarAmbito(0,0,'IGNORAR',null,false);
chk('quedó ignorada', meta.estado, 'ignorada');
Paso3.aplicarAmbito(0,0,'TERRAPLEN',null,true);
chk('vuelve como ok/TERRAPLEN', [meta.estado,meta.ambito], ['ok','TERRAPLEN']);
chk('re-extrajo sus dos remisiones', S.corte.reclamos.filter(r=>r.hoja==='FRESADO').map(r=>r.remision), ['9001','9002']);
chk('con el ámbito nuevo', S.corte.reclamos.filter(r=>r.hoja==='FRESADO').every(r=>r.ambito==='TERRAPLEN'), true);
chk('la regla nueva reemplaza la de IGNORAR', getContratista(c.id).hojas.filter(h=>h.patron==='^FRESADO$').map(h=>h.ambito), ['TERRAPLEN']);

console.log('\n4) Ignorar una hoja sin reclamaciones no pregunta');
({c,meta}=montarCorte());
S.corte.reclamos=S.corte.reclamos.filter(r=>r.hoja!=='FRESADO');
CONFIRMS=0;
Paso3.aplicarAmbito(0,0,'IGNORAR',null,false);
chk('sin confirmación', CONFIRMS, 0);
chk('igual queda ignorada', meta.estado, 'ignorada');

console.log('\n5) Cambio de ámbito normal (sin IGNORAR): no cambia el comportamiento previo');
({c,meta}=montarCorte());
Paso3.aplicarAmbito(0,0,'TERRAPLEN','interno',false);
chk('ámbito y modo aplicados', [meta.ambito,meta.modo], ['TERRAPLEN','interno']);
chk('la decidida a mano conserva su ámbito', S.corte.reclamos.find(r=>r.decisionManual).ambito, 'GRANULARES');
chk('la no decidida se re-concilió', S.corte.reclamos.find(r=>r.remision==='9001').ambito, 'TERRAPLEN');
chk('la otra hoja no se toca', S.corte.reclamos.find(r=>r.hoja==='PUTANA').ambito, 'GRANULARES');

console.log('\n'+(fallos?('❌ '+fallos+' verificación(es) fallaron'):'✅ Todo correcto'));
process.exit(fallos?1:0);

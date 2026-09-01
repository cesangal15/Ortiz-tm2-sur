#!/usr/bin/env node
/**
 * Verificación — la configuración del reparto se guarda entre sesiones
 * (`Reparto_Produccion_Maquinaria.html`).
 *
 * Enmienda D86, que dejó esta herramienta sin `localStorage` a propósito. El coste lo pagaba el
 * dueño: las estancias de la flota —fechas que ya no cambian— había que volver a pegarlas desde
 * un bloc de notas en cada sesión.
 *
 * **La prueba que de verdad importa es la primera:** el script se ejecuta CON `localStorage`
 * presente. Al implementar esto, el arranque quedó antes de la declaración de `RE_ESTANCIA`
 * (zona muerta temporal) y la página **entera** reventaba con ReferenceError en un navegador
 * real — mientras las otras suites pasaban en verde, porque ahí no hay `localStorage` y el
 * código tomaba la rama del catch. Sin este caso, el fallo se descubre en producción.
 *
 *   node backend/pruebas/verificar_config_guardada.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

const JS=(function(){
  const s=fs.readFileSync(path.join(REPO,'Reparto_Produccion_Maquinaria.html'),'utf8');
  const m=s.match(/<script>([\s\S]*?)<\/script>/g)||[];
  return m.map(b=>b.replace(/^<script>/,'').replace(/<\/script>$/,'')).join('\n');
})();

/* `store` se comparte entre arranques: así se simula cerrar y volver a abrir la herramienta.
   `modo` permite un almacenamiento que LANZA, como el de una ventana privada. */
function arranca(store, modo){
  const els={}, listeners={};
  const el=id=>{ if(!els[id]) els[id]={ id:id, value:'', textContent:'', innerHTML:'', checked:false, disabled:false,
      style:{}, files:[], classList:{add(){},remove(){}},
      addEventListener(ev,fn){ (listeners[id]=listeners[id]||[]).push(fn); },
      _disparar(){ (listeners[id]||[]).forEach(fn=>fn()); } };
    return els[id]; };
  const localStorage = modo==='bloqueado'
    ? { getItem(){ throw new Error('denied'); }, setItem(){ throw new Error('denied'); }, removeItem(){ throw new Error('denied'); } }
    : { getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{ store[k]=String(v); }, removeItem:k=>{ delete store[k]; } };
  const ctx={ document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[]}, console,
              XLSX:{utils:{encode_cell:()=>'A1',decode_range:()=>({s:{r:0,c:0},e:{r:0,c:0}})}},
              location:{protocol:'https:'}, navigator:{}, localStorage:localStorage,
              alert:()=>{}, setTimeout:()=>0, clearTimeout:()=>{}, Intl:Intl, addEventListener:()=>{} };
  ctx.window=ctx; vm.createContext(ctx);
  let err=null;
  try{ vm.runInContext(JS,ctx); }catch(e){ err=e; }
  ctx._el=el; ctx._err=err; ctx._eval=e=>vm.runInContext(e,ctx);
  return ctx;
}

console.log('\n== El script ARRANCA con localStorage presente (el caso del navegador real) ==');
{
  const c=arranca({});
  ok('no lanza ningún error al cargar la página', c._err===null, c._err? c._err.constructor.name+': '+c._err.message : '');
  ok('la lista de máquinas queda puesta', /EXC001/.test(c._el('propias').value));
  ok('y la nota explica que se guarda', /guardada en este navegador/.test(c._el('cfgNota').innerHTML));
}

console.log('\n== Cerrar y volver a abrir: la configuración vuelve ==');
{
  const store={};
  const c1=arranca(store);
  // El dueño pega sus estancias y afina un par de parámetros.
  c1._el('propias').value='EXC013:..2026-08-20 // devuelta\nEXC015\nBL005:2026-03-01..';
  c1._el('minHorasProd').value='2.5';
  c1._el('hojaJefe').value='SEPTIEMBRE UF1 UF2';
  c1._el('separarUF').checked=true;
  c1._el('rellenarDias').checked=false;
  ['propias','minHorasProd','hojaJefe','separarUF','rellenarDias'].forEach(id=>c1._el(id)._disparar());
  ok('algo quedó escrito en el almacenamiento', Object.keys(store).length===1, JSON.stringify(Object.keys(store)));

  const c2=arranca(store);           // segunda sesión, mismo navegador
  ok('vuelve la lista de máquinas con sus fechas',
     c2._el('propias').value==='EXC013:..2026-08-20 // devuelta\nEXC015\nBL005:2026-03-01..', JSON.stringify(c2._el('propias').value));
  ok('vuelven los parámetros numéricos', c2._el('minHorasProd').value==='2.5');
  ok('vuelve el nombre de la hoja del mes', c2._el('hojaJefe').value==='SEPTIEMBRE UF1 UF2');
  ok('vuelven las casillas, encendidas y apagadas', c2._el('separarUF').checked===true && c2._el('rellenarDias').checked===false);
  ok('y las estancias guardadas se leen de verdad',
     (()=>{ const P=c2._eval('leerParams()');
            return P.propias.has('EXC013') && (P.estancias.get('EXC013')||[]).some(x=>x.ret==='2026-08-20'); })());
}

console.log('\n== El corte NO se guarda: lo detecta el parte cada mes ==');
{
  const store={};
  const c1=arranca(store);
  c1._el('desde').value='2020-01-01'; c1._el('hasta').value='2020-01-31';
  c1._el('propias')._disparar();                       // fuerza un guardado
  ok('las fechas del corte no entran en lo guardado', !/2020-01-01/.test(store['tm2_reparto_cfg_v1']||''));
  const c2=arranca(store);
  ok('al reabrir, el corte vuelve al 16→15 por defecto y no al viejo', c2._el('desde').value!=='2020-01-01',
     c2._el('desde').value);
}

console.log('\n== Volver a valores de fábrica ==');
{
  const store={};
  const c1=arranca(store);
  c1._el('propias').value='SOLO01'; c1._el('minDia').value='999'; c1._el('soloHoras').checked=false;
  ['propias','minDia','soloHoras'].forEach(id=>c1._el(id)._disparar());
  c1._el('btnCfgReset')._disparar();
  ok('la lista vuelve a la de fábrica', /EXC001/.test(c1._el('propias').value) && !/SOLO01/.test(c1._el('propias').value));
  ok('los números vuelven a su valor', c1._el('minDia').value==='50' && c1._el('minHorasProd').value==='1');
  ok('las casillas vuelven a su estado', c1._el('soloHoras').checked===true && c1._el('rellenarDias').checked===true);
  const c2=arranca(store);
  ok('y el reinicio también queda guardado', /EXC001/.test(c2._el('propias').value) && !/SOLO01/.test(c2._el('propias').value));
}

console.log('\n== Aviso cuando la lista guardada se queda vieja ==');
{
  // El catálogo de flota se actualiza en el código; el usuario tiene su lista guardada de antes.
  const store={};
  const c1=arranca(store);
  c1._el('propias').value='EXC015\nBL005';        // sin EXC001/EXC013/... ni sus fechas
  c1._el('propias')._disparar();
  ok('avisa que la lista guardada no coincide con la de fábrica',
     /no coincide con la que trae la herramienta/.test(c1._el('cfgNota').innerHTML));
  ok('y nombra las máquinas que le faltan', /EXC001/.test(c1._el('cfgNota').innerHTML));
  // Una fecha cambiada también se detecta.
  const c2=arranca({});
  c2._el('propias').value=c2._eval('MAQUINAS_PROPIAS.join("\\n")').replace('..2026-08-20','..2026-09-30');
  c2._el('propias')._disparar();
  ok('detecta una fecha de retiro distinta', /fechas distintas/.test(c2._el('cfgNota').innerHTML),
     c2._el('cfgNota').innerHTML.slice(0,160));
  // Con la lista de fábrica tal cual, no molesta.
  const c3=arranca({});
  ok('con la lista de fábrica no avisa nada', !/no coincide/.test(c3._el('cfgNota').innerHTML));
}

console.log('\n== Almacenamiento bloqueado (ventana privada): degrada, no rompe ==');
{
  const c=arranca({}, 'bloqueado');
  ok('el script arranca igual', c._err===null, c._err? c._err.message : '');
  ok('la lista de máquinas sigue estando', /EXC001/.test(c._el('propias').value));
  ok('y lo dice en vez de fallar en silencio', /no me deja guardar/.test(c._el('cfgNota').innerHTML));
}

console.log('\n== No se guarda nada de los archivos cargados ==');
{
  const store={};
  arranca(store);
  const guardado=store['tm2_reparto_cfg_v1']||'';
  const cfg=JSON.parse(guardado);
  const permitidas=['v','hojaProd','hojaClima','hojaJefe','propias','soloHorasMaq','mapaAct','pctBull','minDia',
                    'minHorasProd','repartoDiario','separarUF','soloHoras','rellenarDias'];
  ok('solo se guardan campos de configuración, nada más',
     Object.keys(cfg).every(k=>permitidas.indexOf(k)>=0), JSON.stringify(Object.keys(cfg)));
  ok('ni rastro de datos de producción, horas o máquinas leídas del parte',
     !/produccion|filas|fact_jefe/i.test(guardado));
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

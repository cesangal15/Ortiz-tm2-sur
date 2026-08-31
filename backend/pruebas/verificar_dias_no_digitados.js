#!/usr/bin/env node
/**
 * Verificación — días que el digitador NO digitó: la máquina aparece igual, en CERO
 * (`Reparto_Produccion_Maquinaria.html`).
 *
 * Es el ESPEJO de D145. Allí, una máquina que reaparece después de salir es un error de
 * digitación y su fila se borra. Aquí, una máquina que el rango del dueño dice que estaba en
 * obra y que el parte no menciona ese día es el mismo error al revés —pasa sobre todo en
 * domingos y festivos— y la fila se crea.
 *
 * Regla fijada por el dueño (ago-2026): la fila va **sin horas y sin producción**. Es una fila
 * de PRESENCIA, para que la máquina no desaparezca del informe ese día. Por eso NO puede tocar
 * el reparto: se genera cuando ya está todo repartido, y ni un m³ cambia de manos.
 * El centro de coste es el que más horas tuvo la máquina en el corte —da igual cuál, la fila va
 * en cero— pero `fact_jefe` necesita uno para derivar actividad y SUB ACTIVIDAD.
 *
 * Corre contra el código REAL del HTML con un SheetJS mínimo. No abre .xlsx ni la red.
 *
 *   node backend/pruebas/verificar_dias_no_digitados.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

function ecol(c){ let s=''; c++; while(c>0){ const r=(c-1)%26; s=String.fromCharCode(65+r)+s; c=(c-r-1)/26; } return s; }
function dcol(s){ let n=0; for(const ch of s) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
const XLSX={ utils:{ encode_cell:a=>ecol(a.c)+(a.r+1),
  decode_range:ref=>{ const p=String(ref).split(':'); const f=c=>{ const m=c.match(/^([A-Z]+)(\d+)$/); return {c:dcol(m[1]), r:+m[2]-1}; };
                      return { s:f(p[0]), e:f(p[1]||p[0]) }; } }};
function contexto(){
  const src=fs.readFileSync(path.join(REPO,'Reparto_Produccion_Maquinaria.html'),'utf8');
  const js=(src.match(/<script>([\s\S]*?)<\/script>/g)||[]).map(b=>b.replace(/^<script>/,'').replace(/<\/script>$/,'')).join('\n');
  const els={};
  const el=id=>{ if(!els[id]) els[id]={ id:id, value:'', textContent:'', innerHTML:'', checked:false, disabled:false,
                   style:{}, files:[], classList:{add(){},remove(){}}, addEventListener(){} }; return els[id]; };
  const ctx={ document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[]}, console, XLSX,
              location:{protocol:'file:'}, navigator:{}, alert:()=>{}, setTimeout:()=>0, clearTimeout:()=>{},
              Intl:Intl, addEventListener:()=>{} };
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(js,ctx);
  ctx._eval=e=>vm.runInContext(e,ctx); ctx._el=el; return ctx;
}
function serial(iso){ return Math.round(Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))/86400000)+25569; }
function hoja(cells,maxr,maxc){ const ws={}; cells.forEach(([r,c,v])=>{ ws[ecol(c)+(r+1)]=(typeof v==='number')?{t:'n',v:v}:{t:'s',v:String(v)}; });
  ws['!ref']='A1:'+ecol(maxc)+(maxr+1); return ws; }

/* Jueves 16 → miércoles 22 de julio 2026. El domingo 19 y el festivo 20 no traen producción. */
const DIAS=['2026-07-16','2026-07-17','2026-07-18','2026-07-19','2026-07-20','2026-07-21','2026-07-22'];
const CON_PROD=DIAS.filter(d=>d!=='2026-07-19' && d!=='2026-07-20');
function diaSuelto(){
  const cells=[[3,1,'UF1'],[4,1,'Excavaciones en material común APROVECHABLE']];
  CON_PROD.forEach((d,i)=>{ cells.push([5+i,0,serial(d)],[5+i,1,1000]); });
  return hoja(cells,5+CON_PROD.length,1);
}
function parteDiario(filas){
  const hdr=['FECHA','CODIGO EQUIPO','TIPO DE EQUIPO','CENTRO DE COSTE','HORAS T','HORAS IDLE'];
  const cells=hdr.map((h,c)=>[0,c,h]);
  filas.forEach((f,i)=>{ const r=i+1;
    cells.push([r,0,serial(f.fecha)],[r,1,f.cod],[r,2,f.tipo||'EXCAVADORA'],[r,3,f.cc],[r,4,f.horas],[r,5,0]); });
  return hoja(cells,filas.length,hdr.length-1);
}
function monta(ctx, filas, opts){
  opts=opts||{};
  ctx.__P={SheetNames:['dia suelto'],Sheets:{'dia suelto':diaSuelto()}};
  ctx.__J={SheetNames:['BASE MAQUINARIA'],Sheets:{'BASE MAQUINARIA':parteDiario(filas)}};
  ctx._eval('S.prod.wb=__P; S.jefe.wb=__J; S.prod.nombre="r.xlsx"; S.jefe.nombre="p.xlsx";');
  const e=ctx._el;
  e('hojaProd').value='dia suelto'; e('hojaClima').value=''; e('hojaJefe').value='BASE MAQUINARIA';
  e('propias').value=opts.propias||'EXC013:EXC\nEXC015:EXC';
  e('soloHorasMaq').value=opts.soloHorasMaq||''; e('mapaAct').value='';
  e('pctBull').value='80'; e('minDia').value='0'; e('minHorasProd').value='1';
  e('desde').value=DIAS[0]; e('hasta').value=DIAS[DIAS.length-1];
  e('repartoDiario').checked=true; e('separarUF').checked=false; e('soloHoras').checked=true;
  e('rellenarDias').checked=(opts.rellenar!==false);
  ctx._eval('__p=leerParams(); __ds=leerProduccion(__p); __j=leerJefe(__p); __o=repartir(__p,__ds,__j);');
  return ctx._eval('__o');
}
/* El digitador olvida a EXC013 el jueves 16, y a las dos el domingo 19 y el festivo 20. */
const PARTE=[];
CON_PROD.forEach(d=>{
  PARTE.push({fecha:d,cod:'EXC015',cc:'3701.02.05',horas:8});
  if(d!=='2026-07-16') PARTE.push({fecha:d,cod:'EXC013',cc:'3701.02.05',horas:9});
});
const rell=out=>out.filas.filter(f=>f.rellenada);
const prodTotal=out=>out.filas.reduce((a,f)=>a+(f.produccion||0),0);
const cuadreOK=out=>Math.abs(out.cuadre.find(c=>c.item==='02.05').dif)<0.011;

console.log('\n== La máquina aparece los días que el digitador se saltó ==');
{
  const out=monta(contexto(),PARTE);
  ok('se agregan las 5 filas que faltaban', rell(out).length===5,
     JSON.stringify(rell(out).map(f=>f.maquina+' '+f.fecha)));
  ok('EXC013 aparece el jueves que le olvidaron',
     out.filas.some(f=>f.maquina==='EXC013'&&f.fecha==='2026-07-16'&&f.rellenada));
  ok('las dos aparecen el domingo 19',
     ['EXC013','EXC015'].every(c=>out.filas.some(f=>f.maquina===c&&f.fecha==='2026-07-19'&&f.rellenada)));
  ok('las dos aparecen el festivo 20',
     ['EXC013','EXC015'].every(c=>out.filas.some(f=>f.maquina===c&&f.fecha==='2026-07-20'&&f.rellenada)));
  ok('cada máquina tiene fila TODOS los días del corte',
     ['EXC013','EXC015'].every(c=>DIAS.every(d=>out.filas.some(f=>f.maquina===c&&f.fecha===d))));
  ok('no se toca ningún día que sí estaba digitado',
     !rell(out).some(f=>f.fecha==='2026-07-17'||f.fecha==='2026-07-18'||f.fecha==='2026-07-21'||f.fecha==='2026-07-22'));
}

console.log('\n== Van en CERO: ni horas ni producción ==');
{
  const out=monta(contexto(),PARTE);
  ok('todas las filas agregadas llevan 0 horas', rell(out).every(f=>(f.horas||0)===0),
     JSON.stringify(rell(out).map(f=>f.horas)));
  ok('todas llevan 0 de idle', rell(out).every(f=>(f.idle||0)===0));
  ok('ninguna lleva producción', rell(out).every(f=>f.produccion==null),
     JSON.stringify(rell(out).map(f=>f.produccion)));
  ok('quedan marcadas como rellenadas, para poder distinguirlas', rell(out).every(f=>f.rellenada===true));
  ok('la base lo dice en el informe', rell(out).every(f=>/no digitado/.test(f.base||'')));
}

console.log('\n== No mueve ni un m³: el reparto es idéntico con y sin el parámetro ==');
{
  const conRelleno=monta(contexto(),PARTE);
  const sinRelleno=monta(contexto(),PARTE,{rellenar:false});
  ok('apagado no agrega nada (comportamiento anterior)', rell(sinRelleno).length===0);
  ok('la producción total es la misma', Math.abs(prodTotal(conRelleno)-prodTotal(sinRelleno))<0.011,
     prodTotal(conRelleno)+' vs '+prodTotal(sinRelleno));
  ok('la producción es la de `dia suelto` (5 días × 1.000)', Math.abs(prodTotal(conRelleno)-5000)<0.011, prodTotal(conRelleno)+'');
  ok('cuadre exacto en los dos casos', cuadreOK(conRelleno) && cuadreOK(sinRelleno));
  ok('cero huérfanas en los dos casos', !conRelleno.huerfanas.length && !sinRelleno.huerfanas.length);
  // Fila a fila: lo que ya existía no cambia ni en horas ni en m³.
  const clave=f=>[f.maquina,f.fecha,f.proyecto,f.item,f.sub].join('|');
  const antes=new Map(sinRelleno.filas.map(f=>[clave(f),f]));
  ok('ninguna fila preexistente cambia de horas ni de producción',
     conRelleno.filas.filter(f=>!f.rellenada).every(f=>{ const a=antes.get(clave(f));
       return a && Math.abs((a.horas||0)-(f.horas||0))<0.011 && (a.produccion||0)===(f.produccion||0); }));
  ok('las filas nuevas son exactamente las agregadas', conRelleno.filas.length===sinRelleno.filas.length+rell(conRelleno).length);
}

console.log('\n== El centro de coste es el que más horas tuvo en el corte ==');
{
  // EXC013: 4 h/día en 02.05 pero 9 h/día en 02.06 → su CC principal es 02.06.
  const parte=[];
  CON_PROD.forEach(d=>{
    parte.push({fecha:d,cod:'EXC015',cc:'3701.02.05',horas:8});
    if(d!=='2026-07-16'){ parte.push({fecha:d,cod:'EXC013',cc:'3701.02.05',horas:4});
                          parte.push({fecha:d,cod:'EXC013',cc:'3701.02.06',horas:9}); }
  });
  const out=monta(contexto(),parte);
  const f=out.filas.find(x=>x.maquina==='EXC013'&&x.fecha==='2026-07-19'&&x.rellenada);
  ok('la fila agregada de EXC013 va al 02.06, su CC con más horas', !!f && f.item==='02.06', f?f.cc:'(sin fila)');
  ok('y con el vocabulario correcto de ese CC', !!f && f.actividad==='EXCAVACION PRESTAMO', f?f.actividad:'');
  ok('EXC015, con un solo CC, va al suyo',
     (out.filas.find(x=>x.maquina==='EXC015'&&x.rellenada)||{}).item==='02.05');
}

console.log('\n== Manda la estancia: no se rellena fuera del rango (espejo de D145) ==');
{
  const out=monta(contexto(),PARTE,{propias:'EXC013:..2026-07-19\nEXC015:EXC'});
  ok('EXC013 se rellena el jueves 16, dentro de su rango',
     out.filas.some(f=>f.maquina==='EXC013'&&f.fecha==='2026-07-16'&&f.rellenada));
  ok('NO se rellena el domingo 19, el día en que salió (ventana semiabierta)',
     !out.filas.some(f=>f.maquina==='EXC013'&&f.fecha==='2026-07-19'));
  ok('ni ningún día posterior', !out.filas.some(f=>f.maquina==='EXC013'&&f.fecha>='2026-07-19'),
     JSON.stringify(out.filas.filter(f=>f.maquina==='EXC013').map(f=>f.fecha)));
  ok('EXC015, sin fecha de salida, sí se rellena hasta el final',
     out.filas.some(f=>f.maquina==='EXC015'&&f.fecha==='2026-07-22'));
  ok('cuadre exacto', cuadreOK(out));
}

console.log('\n== Casos que no debe tocar ==');
{
  // Una máquina que el parte NUNCA menciona no está en la flota leída: no hay CC que ponerle.
  const out=monta(contexto(),PARTE,{propias:'EXC013:EXC\nEXC015:EXC\nEXC999:EXC'});
  ok('una máquina que el parte no menciona nunca no se inventa', !out.filas.some(f=>f.maquina==='EXC999'));
  // Máquina marcada «solo horas» (D91c): sigue emitiendo filas, pero nunca producción.
  const out2=monta(contexto(),PARTE,{soloHorasMaq:'EXC013'});
  ok('una máquina en «solo horas» también se rellena (es presencia, no producción)',
     out2.filas.some(f=>f.maquina==='EXC013'&&f.rellenada));
  ok('y sigue sin recibir producción en ninguna fila',
     !out2.filas.some(f=>f.maquina==='EXC013'&&f.produccion>0),
     JSON.stringify(out2.filas.filter(f=>f.maquina==='EXC013'&&f.produccion>0).map(f=>f.fecha+':'+f.produccion)));
  ok('y la producción sigue cuadrando (la reparte EXC015)', cuadreOK(out2) && Math.abs(prodTotal(out2)-5000)<0.011);
}

console.log('\n== La salida A:AC: la fila en cero se escribe bien ==');
{
  const ctx=contexto();
  const out=monta(ctx,PARTE);
  ctx._eval('S.out={ P:__p, dsProd:__ds, clima:{porDia:new Map()}, jefe:__j, rep:__o };');
  ctx._eval('S.out.rep.filas.forEach(f=>{ f.clima=""; });');
  const aoa=ctx._eval('aoaFactJefe(true)');
  const CAB=ctx._eval('CAB_FACT');
  const idx=aoa.findIndex((r,i)=>i>0 && r[4]==='EXC013' && r[2]==='domingo');
  ok('la fila del domingo existe en el .xlsx', idx>0, 'idx='+idx);
  ok('sale con 29 columnas como las demás', idx>0 && aoa[idx].length===29);
  ok('Horas Operación = 0 (no vacío, para que el SUMIFS del informe la vea)',
     idx>0 && aoa[idx][CAB.indexOf('Horas Operación')]===0, idx>0?JSON.stringify(aoa[idx][11]):'');
  ok('Producción vacía (no 0: el informe no debe contarla como m³)',
     idx>0 && aoa[idx][CAB.indexOf('Producción')]==='', idx>0?JSON.stringify(aoa[idx][19]):'');
  ok('lleva su centro de coste y su ítem', idx>0 && aoa[idx][27]==='3701.02.05' && aoa[idx][28]==='02.05');
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

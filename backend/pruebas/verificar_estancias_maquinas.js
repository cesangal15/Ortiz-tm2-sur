#!/usr/bin/env node
/**
 * Verificación — ESTANCIAS de las máquinas en el reparto mensual (`Reparto_Produccion_Maquinaria.html`).
 *
 * El problema, reportado por el usuario (ago-2026): la lista de máquinas era plana y sin fechas, así
 * que una máquina entregada a mitad del corte «se tomaba en cuenta todo el tiempo». Medido sobre el
 * `dia suelto` real: una excavadora entregada el 21-jul recibía **3.468 m³ repartidos en 19 días en
 * los que ya no estaba**, con CERO horas en el parte, por el fallback mensual de la cascada de pesos.
 *
 * Ahora hay dos redes:
 *   (1) REGLA DE DATOS — con parte diario, quien no trabajó ese día no recibe producción ese día…
 *       …salvo que NADIE de su tipo trabajara: entonces no se inventa una ausencia y decide la
 *       cascada de siempre, que es lo que evita la producción huérfana (D86).
 *   (2) ESTANCIAS DECLARADAS — `COD:ingreso..retiro` en la lista, ventana semiabierta
 *       `[ingreso, retiro)` como la hoja `MAQUINAS` (D138) y el personal (D85). Fuera de su
 *       estancia la fila del parte se descarta ENTERA: ni horas ni producción.
 *
 * Se ejecuta contra el código REAL del HTML, con un SheetJS mínimo. No abre .xlsx ni la red.
 *
 *   node backend/pruebas/verificar_estancias_maquinas.js
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
                   style:{}, files:[], classList:{add(){},remove(){}}, addEventListener(){} };
                 return els[id]; };
  const ctx={ document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[]}, console, XLSX,
              location:{protocol:'file:'}, navigator:{clipboard:{writeText:async()=>{}}}, alert:()=>{},
              setTimeout:()=>0, clearTimeout:()=>{}, Intl:Intl, addEventListener:()=>{} };
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(js,ctx);
  ctx._eval=e=>vm.runInContext(e,ctx); ctx._el=el;
  return ctx;
}
function serial(iso){ return Math.round(Date.UTC(+iso.slice(0,4),+iso.slice(5,7)-1,+iso.slice(8,10))/86400000)+25569; }
function hoja(cells,maxr,maxc){ const ws={}; cells.forEach(([r,c,v])=>{ ws[ecol(c)+(r+1)]=(typeof v==='number')?{t:'n',v:v}:{t:'s',v:String(v)}; });
  ws['!ref']='A1:'+ecol(maxc)+(maxr+1); return ws; }

/* `dia suelto`: fila 4 = UF, fila 5 = actividad, datos desde la 6, col A = fecha (base 0: 3/4/5). */
function diaSuelto(dias, prodPorDia){
  const cells=[[3,1,'UF1'],[4,1,'Excavaciones en material común APROVECHABLE']];
  dias.forEach((d,i)=>{ cells.push([5+i,0,serial(d)]); cells.push([5+i,1,prodPorDia[i]]); });
  return hoja(cells,5+dias.length,1);
}
/* Parte DÍA A DÍA (formato `BASE MAQUINARIA`). filas: {fecha,cod,tipo,cc,horas,idle} */
function parteDiario(filas){
  const hdr=['FECHA','CODIGO EQUIPO','TIPO DE EQUIPO','CENTRO DE COSTE','HORAS T','HORAS IDLE'];
  const cells=hdr.map((h,c)=>[0,c,h]);
  filas.forEach((f,i)=>{ const r=i+1;
    cells.push([r,0,serial(f.fecha)],[r,1,f.cod],[r,2,f.tipo||'EXCAVADORA'],[r,3,f.cc],[r,4,f.horas],[r,5,f.idle||0]); });
  return hoja(cells,filas.length,hdr.length-1);
}
/* Parte de BLOQUES con el total del mes: código en col 2, CC en col 4, horas en col 18, datos desde fila 6. */
function parteMensual(bloques){
  const cells=[]; let r=5;
  bloques.forEach(b=>{ cells.push([r,2,b.cod],[r,4,b.tipo||'EXCAVADORA']); r++;
    b.ccs.forEach(c=>{ cells.push([r,4,c.cc],[r,18,c.horas]); r++; }); });
  return hoja(cells,r,18);
}

const DIAS=['2026-07-16','2026-07-17','2026-07-18','2026-07-20','2026-07-21','2026-07-22','2026-07-23'];
const PROD=[1000,1000,1000,1000,1000,1000,1000];
const CORTE={desde:'2026-07-16',hasta:'2026-07-23'};

function monta(ctx,lista,filasParte,opts){
  opts=opts||{};
  ctx.__wbP={SheetNames:['dia suelto'],Sheets:{'dia suelto':diaSuelto(DIAS,PROD)}};
  ctx.__wbJ=opts.mensual
    ? {SheetNames:['MES'],Sheets:{'MES':parteMensual(filasParte)}}
    : {SheetNames:['BASE MAQUINARIA'],Sheets:{'BASE MAQUINARIA':parteDiario(filasParte)}};
  ctx._eval('S.prod.wb=__wbP; S.prod.nombre="reporte.xlsx"; S.jefe.wb=__wbJ; S.jefe.nombre="parte.xlsx";');
  ctx._el('hojaProd').value='dia suelto';
  ctx._el('hojaClima').value='';
  ctx._el('hojaJefe').value=opts.mensual?'MES':'BASE MAQUINARIA';
  ctx._el('propias').value=lista;
  ctx._el('soloHorasMaq').value=''; ctx._el('mapaAct').value='';
  ctx._el('pctBull').value='80'; ctx._el('minDia').value='0';
  ctx._el('desde').value=CORTE.desde; ctx._el('hasta').value=CORTE.hasta;
  ctx._el('repartoDiario').checked=(opts.diario!==false);
  ctx._el('separarUF').checked=false; ctx._el('soloHoras').checked=true;
  ctx._eval('__P=leerParams(); __ds=leerProduccion(__P); __jefe=leerJefe(__P); __out=repartir(__P,__ds,__jefe);');
  return { P:ctx._eval('__P'), jefe:ctx._eval('__jefe'), out:ctx._eval('__out') };
}
const prodDe=(out,cod,desde)=>out.filas.filter(f=>f.maquina===cod&&f.produccion!=null&&(!desde||f.fecha>=desde))
                                       .reduce((a,f)=>a+f.produccion,0);

console.log('\n== Parseo de la lista: estancias, tipos y comentarios ==');
{
  const ctx=contexto();
  ctx._el('propias').value=[
    'EXC013:..2026-08-20    // devuelta (D136)',
    'RT02:EXC:2026-07-01..  # entró en julio',
    'EXC026:2026-07-05..2026-07-20',
    'FNG002:FIN:2026-07-01..2026-07-10',
    'FNG002:2026-08-01..',                       // segunda estancia de la MISMA máquina
    'BL005, MO03',                               // la lista de siempre, separada por comas
    'MAL01:2026-08-20..2026-08-01',              // retiro antes del ingreso
    'MAL02:2026-8-1..'                           // fecha sin formato yyyy-mm-dd
  ].join('\n');
  const P=ctx._eval('leerParams()');
  const est=P.estancias;
  ok('reconoce los códigos de todas las líneas y de la separada por comas',
     ['EXC013','RT02','EXC026','FNG002','BL005','MO03'].every(c=>P.propias.has(c)), [...P.propias].join(','));
  ok('solo retiro: `..2026-08-20`', JSON.stringify(est.get('EXC013'))==='[{"ing":"","ret":"2026-08-20"}]', JSON.stringify(est.get('EXC013')));
  ok('solo ingreso + tipo: `RT02:EXC:2026-07-01..`',
     JSON.stringify(est.get('RT02'))==='[{"ing":"2026-07-01","ret":""}]' && P.tiposManual.RT02==='EXC');
  ok('rango completo sin tipo', JSON.stringify(est.get('EXC026'))==='[{"ing":"2026-07-05","ret":"2026-07-20"}]');
  ok('dos estancias de la misma máquina (dos líneas)', (est.get('FNG002')||[]).length===2, JSON.stringify(est.get('FNG002')));
  ok('una máquina sin fechas no tiene estancia declarada', !est.has('BL005') && !est.has('MO03'));
  ok('los comentarios // y # no ensucian el código', !P.propias.has('EXC013DEVUELTAD136') && !P.propias.has('RT02ENTROENJULIO'));
  ok('retiro anterior al ingreso se rechaza y se avisa', !est.has('MAL01') && P.estanciasMalas.some(x=>x.indexOf('MAL01')===0), JSON.stringify(P.estanciasMalas));
  ok('fecha mal escrita se rechaza y se avisa', !est.has('MAL02') && P.estanciasMalas.some(x=>x.indexOf('MAL02')===0));
}

console.log('\n== Ventana SEMIABIERTA [ingreso, retiro) — igual que D138/D85 ==');
{
  const ctx=contexto();
  ctx._el('propias').value='EXC013:..2026-08-20\nRT02:2026-07-01..\nFNG002:2026-07-01..2026-07-10\nFNG002:2026-08-01..\nBL005';
  const P=ctx._eval('leerParams()');
  ctx.__est=P.estancias;
  const act=(c,f)=>ctx._eval('estanciaActiva(__est,'+JSON.stringify(c)+','+JSON.stringify(f)+')');
  ok('el día ANTERIOR al retiro sí cuenta (19-ago)', act('EXC013','2026-08-19')===true);
  ok('el día DEL retiro ya NO cuenta (20-ago)', act('EXC013','2026-08-20')===false);
  ok('después del retiro tampoco', act('EXC013','2026-09-01')===false);
  ok('el día del ingreso sí cuenta', act('RT02','2026-07-01')===true);
  ok('el día anterior al ingreso no', act('RT02','2026-06-30')===false);
  ok('dos estancias: dentro de la primera', act('FNG002','2026-07-05')===true);
  ok('dos estancias: en el hueco entre ambas, fuera', act('FNG002','2026-07-20')===false);
  ok('dos estancias: dentro de la segunda', act('FNG002','2026-09-09')===true);
  ok('sin estancia declarada, siempre presente', act('BL005','2020-01-01')===true && act('BL005','2030-01-01')===true);
  const sol=(c,a,b)=>ctx._eval('estanciaSolapa(__est,'+JSON.stringify(c)+','+JSON.stringify(a)+','+JSON.stringify(b)+')');
  ok('solape con el corte: sí lo pisa', sol('EXC013','2026-08-16','2026-09-15')===true);
  ok('solape con el corte: ya no lo pisa', sol('EXC013','2026-08-20','2026-09-15')===false);
  ok('solape: entra justo el último día del corte', sol('RT02','2026-06-01','2026-07-01')===true);
}

console.log('\n== La fuga original: máquina entregada a mitad del corte ==');
{
  // EXC001 trabaja 16→18 y la entregan; EXC015 se queda, pero el 20 y el 21 reporta OTRO CC,
  // así que esos días nadie tiene horas en 02.05 y la cascada se caía al total del mes.
  const filas=[];
  ['2026-07-16','2026-07-17','2026-07-18'].forEach(f=>filas.push({fecha:f,cod:'EXC001',cc:'3701.02.05',horas:9}));
  DIAS.forEach(f=>filas.push({fecha:f,cod:'EXC015',cc:(f==='2026-07-20'||f==='2026-07-21')?'3701.02.06':'3701.02.05',horas:10}));

  const ctxA=contexto();
  const A=monta(ctxA,'EXC001\nEXC015',filas);          // sin fechas: solo actúa la regla de datos
  ok('sin estancia: la regla de datos ya le quita los días en que no trabajó',
     (ctxA._eval('__out').sinHoras.get('EXC001')||0)>0, 'sinHoras='+JSON.stringify([...A.out.sinHoras.entries()]));
  const fugaA=prodDe(A.out,'EXC001','2026-07-20');
  ok('sin estancia: NO recibe nada los días en que EXC015 sí trabajó el CC', prodDe(A.out,'EXC001','2026-07-22')===0, fugaA+'');

  const ctxB=contexto();
  const B=monta(ctxB,'EXC001:..2026-07-20 // entregada\nEXC015',filas);
  ok('con estancia: cero producción a partir del día del retiro', prodDe(B.out,'EXC001','2026-07-20')===0, prodDe(B.out,'EXC001','2026-07-20')+'');
  ok('con estancia: sí conserva la producción de los días en que estuvo', prodDe(B.out,'EXC001')>0);
  ok('con estancia: ni una sola fila suya después del retiro',
     B.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20').length===0);
  /* Las dos redes NO son intercambiables, y este fixture lo enseña. El 20 y el 21 nadie reportó
     horas de 02.05 (EXC015 estuvo en 02.06), así que el listón baja al escalón 1 —«esta actividad
     es suya, la hace otros días»— y EXC001, que sí hace 02.05, vuelve a ser candidata. La regla de
     DATOS no puede saber que ya la habían entregado; eso solo lo dice la ESTANCIA. */
  ok('sin estancia queda fuga en los días que nadie reportó el CC (los datos no bastan)',
     prodDe(A.out,'EXC001')>prodDe(B.out,'EXC001')+0.011,
     'sin fecha '+prodDe(A.out,'EXC001').toFixed(2)+' vs con fecha '+prodDe(B.out,'EXC001').toFixed(2));
  ok('la estancia cierra esa fuga y EXC015 recibe lo que EXC001 ya no',
     prodDe(B.out,'EXC015')>prodDe(A.out,'EXC015')+0.011,
     prodDe(A.out,'EXC015').toFixed(2)+' → '+prodDe(B.out,'EXC015').toFixed(2));
  ok('EXC001 se queda solo con los 3 días que trabajó',
     B.out.filas.filter(f=>f.maquina==='EXC001'&&f.produccion!=null).every(f=>f.fecha<='2026-07-18'));
  ok('el resto se lo lleva EXC015', Math.abs(prodDe(B.out,'EXC015')+prodDe(B.out,'EXC001')-7000)<0.011);
  const cua=B.out.cuadre.find(c=>c.item==='02.05');
  ok('el cuadre por CC sigue exacto (no se pierde ni un m³)', Math.abs(cua.dif)<0.011, JSON.stringify(cua));
  ok('cero producción huérfana', B.out.huerfanas.length===0, JSON.stringify(B.out.huerfanas));
  const totalProd=B.out.filas.reduce((a,f)=>a+(f.produccion||0),0);
  ok('la producción total repartida sigue siendo la de `dia suelto`', Math.abs(totalProd-7000)<0.011, totalProd+'');
}

console.log('\n== Filas del parte fuera de la estancia: se descartan ENTERAS ==');
{
  // El jefe le sigue reportando horas a EXC001 después de entregada (pasó con CAT320, D91b).
  const filas=[];
  DIAS.forEach(f=>filas.push({fecha:f,cod:'EXC001',cc:'3701.02.05',horas:9}));
  DIAS.forEach(f=>filas.push({fecha:f,cod:'EXC015',cc:'3701.02.05',horas:10}));
  const ctx=contexto();
  const R=monta(ctx,'EXC001:..2026-07-20\nEXC015',filas);
  const fe=R.jefe.fueraEstancia;
  ok('se descartan las 4 filas posteriores al retiro', fe.length===4, JSON.stringify(fe.map(x=>x.cod+' '+x.fecha)));
  ok('el aviso lleva las horas descartadas (4 × 9 h)', Math.abs(fe.reduce((a,x)=>a+x.horas,0)-36)<0.001);
  ok('esas horas NO llegan a fact_jefe',
     R.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20').length===0);
  ok('las horas de los días en que sí estuvo se conservan',
     Math.abs(R.out.filas.filter(f=>f.maquina==='EXC001').reduce((a,f)=>a+(f.horas||0),0)-27)<0.011,
     R.out.filas.filter(f=>f.maquina==='EXC001').reduce((a,f)=>a+(f.horas||0),0)+'');
  ok('el total de horas del parte para esa máquina ya no incluye lo descartado',
     Math.abs(R.jefe.maquinas.get('EXC001').horasTotal-27)<0.011);
}

console.log('\n== Cuando NADIE trabajó ese día no se inventa una ausencia (D86: nada huérfano) ==');
{
  // Ninguna excavadora reporta el 22 ni el 23, pero `dia suelto` sí trae producción esos días.
  const filas=[];
  ['2026-07-16','2026-07-17','2026-07-18','2026-07-20','2026-07-21'].forEach(f=>{
    filas.push({fecha:f,cod:'EXC015',cc:'3701.02.05',horas:10}); });
  const ctx=contexto();
  const R=monta(ctx,'EXC015',filas);
  ok('la producción de los días sin parte igual se reparte', prodDe(R.out,'EXC015','2026-07-22')>0,
     prodDe(R.out,'EXC015','2026-07-22')+'');
  ok('cero huérfanas', R.out.huerfanas.length===0, JSON.stringify(R.out.huerfanas));
  const cua=R.out.cuadre.find(c=>c.item==='02.05');
  ok('cuadre exacto', Math.abs(cua.dif)<0.011, JSON.stringify(cua));
}

console.log('\n== Parte de BLOQUES mensuales (sin fecha por fila) ==');
{
  const bloques=[{cod:'EXC001',ccs:[{cc:'3701.02.05',horas:30}]},
                 {cod:'EXC015',ccs:[{cc:'3701.02.05',horas:70}]}];
  const ctx=contexto();
  const R=monta(ctx,'EXC001:..2026-07-20\nEXC015',bloques,{mensual:true});
  ok('el parte se lee como mensual', R.jefe.formato==='mensual');
  ok('EXC001 no recibe producción en días posteriores a su retiro',
     R.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20'&&f.produccion).length===0,
     JSON.stringify(R.out.filas.filter(f=>f.maquina==='EXC001').map(f=>f.fecha+':'+f.produccion)));
  ok('sí recibe en los días en que estuvo', prodDe(R.out,'EXC001')>0);
  // Con reparto DIARIO no hay derrame: la unidad ya es el día y a la máquina la filtra su estancia.
  // El derrame (y su recorte por estancia) es el camino del switch apagado.
  const ctxD=contexto();
  const D=monta(ctxD,'EXC001:..2026-07-20\nEXC015',bloques,{mensual:true,diario:false});
  ok('con el switch apagado, el derrame dice que se acotó a su estancia',
     D.out.filas.some(f=>f.maquina==='EXC001'&&/solo sus días en obra/.test(f.base||'')),
     JSON.stringify([...new Set(D.out.filas.map(f=>f.base))]));
  ok('y tampoco cae producción suya después del retiro',
     D.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20'&&f.produccion).length===0);
  const cuaD=D.out.cuadre.find(c=>c.item==='02.05');
  ok('cuadre exacto con el switch apagado', Math.abs(cuaD.dif)<0.011, JSON.stringify(cuaD));
  const cua=R.out.cuadre.find(c=>c.item==='02.05');
  ok('cuadre exacto también en formato mensual', Math.abs(cua.dif)<0.011, JSON.stringify(cua));

  // Una máquina cuya estancia no toca el corte: su bloque entero se descarta.
  const ctx2=contexto();
  const R2=monta(ctx2,'EXC001:..2026-06-01\nEXC015',bloques,{mensual:true});
  ok('bloque de una máquina que ya no pisa el corte: descartado', !R2.jefe.maquinas.has('EXC001'), [...R2.jefe.maquinas.keys()].join(','));
  ok('y su producción la reparte la que sí estaba', Math.abs(prodDe(R2.out,'EXC015')-7000)<0.011, prodDe(R2.out,'EXC015')+'');
}

console.log('\n== El copia-pega del digitador: la fecha de la lista le gana al parte ==');
{
  /* Patrón reportado por el dueño (ago-2026): el digitador copia y pega filas los fines de semana
     y se le cuela una máquina YA ENTREGADA. La estancia manda; esa fila es un error de digitación. */
  const filas=[];
  DIAS.forEach(f=>{ filas.push({fecha:f,cod:'EXC015',cc:'3701.02.05',horas:10});
                    if(f<'2026-07-20') filas.push({fecha:f,cod:'EXC001',cc:'3701.02.05',horas:9}); });
  filas.push({fecha:'2026-07-21',cod:'EXC001',cc:'3701.02.05',horas:9});   // fantasma tras la salida
  filas.push({fecha:'2026-07-22',cod:'EXC001',cc:'3701.02.05',horas:9});   // fantasma tras la salida
  const ctx=contexto();
  const R=monta(ctx,'EXC001:..2026-07-20\nEXC015',filas);
  ok('las dos filas fantasma se descartan', (R.jefe.fueraEstancia||[]).length===2,
     JSON.stringify((R.jefe.fueraEstancia||[]).map(x=>x.cod+' '+x.fecha)));
  ok('ni una fila de EXC001 después de su salida', R.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20').length===0);
  ok('las 18 h fantasma no cuentan en el total del parte',
     Math.abs(R.jefe.maquinas.get('EXC001').horasTotal-27)<0.011, R.jefe.maquinas.get('EXC001').horasTotal+'');
  ok('el aviso conserva la fecha de cada fila descartada (para ver el patrón del fin de semana)',
     (R.jefe.fueraEstancia||[]).every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.fecha)));
  // Del día de la salida en adelante, EXC015 es la única: se lleva esos días enteros.
  const diasTrasSalida=DIAS.filter(d=>d>='2026-07-20');
  ok('desde la salida, EXC015 se lleva la producción completa de cada día',
     Math.abs(R.out.filas.filter(f=>f.maquina==='EXC015'&&f.fecha>='2026-07-20').reduce((a,f)=>a+(f.produccion||0),0)
              - diasTrasSalida.length*1000)<0.011,
     R.out.filas.filter(f=>f.maquina==='EXC015'&&f.fecha>='2026-07-20').reduce((a,f)=>a+(f.produccion||0),0)+
     ' de '+diasTrasSalida.length*1000);
  ok('entre las dos suman toda la producción del corte',
     Math.abs(prodDe(R.out,'EXC001')+prodDe(R.out,'EXC015')-7000)<0.011);
  ok('cuadre exacto y cero huérfanas', Math.abs(R.out.cuadre.find(c=>c.item==='02.05').dif)<0.011 && R.out.huerfanas.length===0);

  // Sin la fecha escrita, el sistema no tiene cómo saberlo: el fantasma pasa. Es el argumento
  // para mantener la lista al día, y conviene que la prueba lo deje dicho.
  const ctx2=contexto();
  const R2=monta(ctx2,'EXC001\nEXC015',filas);
  ok('sin la fecha en la lista el fantasma SÍ se cuela (por eso hay que escribirla)',
     R2.out.filas.some(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-21'&&f.produccion>0));
}

console.log('\n== Parte de bloques mensuales: la producción se acota, las horas no se pueden ==');
{
  const bloques=[{cod:'EXC001',ccs:[{cc:'3701.02.05',horas:54}]},   // incluye 18 h fantasma
                 {cod:'EXC015',ccs:[{cc:'3701.02.05',horas:70}]}];
  const ctx=contexto();
  const R=monta(ctx,'EXC001:..2026-07-20\nEXC015',bloques,{mensual:true});
  ok('la PRODUCCIÓN sí queda acotada a los días de la estancia',
     R.out.filas.filter(f=>f.maquina==='EXC001'&&f.fecha>='2026-07-20'&&f.produccion).length===0);
  ok('las HORAS del bloque no se pueden recortar (el parte no trae fecha por fila)',
     Math.abs(R.jefe.maquinas.get('EXC001').horasTotal-54)<0.011, R.jefe.maquinas.get('EXC001').horasTotal+'');
  ok('la máquina queda detectable como estancia parcial, para poder avisarlo',
     R.jefe.formato==='mensual' && R.out.filas.some(f=>f.maquina==='EXC001'));
  ok('cuadre exacto igualmente', Math.abs(R.out.cuadre.find(c=>c.item==='02.05').dif)<0.011);
}

console.log('\n== Retrocompatible: una lista sin fechas se comporta como antes ==');
{
  const filas=[];
  DIAS.forEach(f=>{ filas.push({fecha:f,cod:'EXC001',cc:'3701.02.05',horas:9});
                    filas.push({fecha:f,cod:'EXC015',cc:'3701.02.05',horas:10}); });
  const ctx=contexto();
  const R=monta(ctx,'EXC001, EXC015',filas);      // la lista de siempre, con comas y sin fechas
  ok('ninguna fila se descarta', (R.jefe.fueraEstancia||[]).length===0);
  ok('ninguna pierde candidatura (todas trabajaron todos los días)', R.out.sinHoras.size===0);
  ok('reparto proporcional a horas: 9/19 y 10/19 de 7.000',
     Math.abs(prodDe(R.out,'EXC001')-7000*9/19)<1 && Math.abs(prodDe(R.out,'EXC015')-7000*10/19)<1,
     prodDe(R.out,'EXC001').toFixed(0)+' / '+prodDe(R.out,'EXC015').toFixed(0));
}

console.log('\n== La lista por defecto coincide con el catálogo de flota (MAQUINAS.tsv) ==');
{
  const ctx=contexto();
  const seed=fs.readFileSync(path.join(REPO,'backend/seeds/MAQUINAS.tsv'),'utf8').trim().split('\n').slice(1)
    .map(l=>l.split('\t')).reduce((m,c)=>{ m[c[0]]=c[5]||''; return m; },{});
  ctx._el('propias').value=ctx._eval('MAQUINAS_PROPIAS.join("\\n")');
  const P=ctx._eval('leerParams()');
  const alias={FNG002:'FNG02'};                    // el mismo equipo con otro código (D90b)
  let malas=[];
  [...P.propias].forEach(cod=>{
    const ret=(P.estancias.get(cod)||[]).map(x=>x.ret).filter(Boolean)[0]||'';
    const esperado=seed[cod]!==undefined?seed[cod]:(seed[alias[cod]]||'');
    if(ret!==esperado) malas.push(cod+': lista='+(ret||'sin retiro')+' seed='+(esperado||'sin retiro'));
  });
  ok('todas las fechas de retiro de la lista salen del seed', malas.length===0, malas.join(' | '));
  ok('las diez devoluciones de D136 que reparten producción están fechadas',
     ['EXC001','EXC013','EXC014','BL009','NH69'].every(c=>(P.estancias.get(c)||[]).some(x=>x.ret==='2026-08-20')));
  ok('MC705 lleva su retiro de jun-2026 (D61)', (P.estancias.get('MC705')||[]).some(x=>x.ret==='2026-06-16'));
  ok('las que siguen en obra no llevan fecha', ['EXC015','BL005','MO03','MO04','MO09'].every(c=>!P.estancias.has(c)));
  ok('CAT320 sigue fuera de la lista (D91b)', !P.propias.has('CAT320'));
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

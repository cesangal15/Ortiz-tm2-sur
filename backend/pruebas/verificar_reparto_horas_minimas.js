#!/usr/bin/env node
/**
 * Verificación — horas mínimas del día y renormalización del 80/20 por POOL
 * (`Reparto_Produccion_Maquinaria.html`).
 *
 * Los dos casos, marcados por el dueño sobre el Informe_Mensual real de agosto (terraplén):
 *   1) NH69 con 0,2 h se llevaba 526 m³ (2.632 m³/h) y con 0,1 h, 1.559 m³ (15.593 m³/h):
 *      el 80% del bulldozer era suyo por ser el único de su tipo, sin mirar cuánto trabajó.
 *   2) Un día sin bulldozer, la motoniveladora recibía solo su 20% (270 de 1.349) y el 80%
 *      caía en un bulldozer PARADO: producción con cero horas, rendimiento infinito.
 *
 *   3) BL005 estaba cargado SOLO a ZODME (02.08) en el parte y aun así salía con 290 y 350 m³ de
 *      TERRAPLEN (02.07) y 0,0 horas, con base «horas totales»: el listón miraba el TOTAL de horas
 *      del día, así que 7 h de ZODME lo daban por «trabajó» y, de único bulldozer, se llevaba el
 *      80% del terraplén. El listón pasa a mirar las horas EN ESA ACTIVIDAD.
 *
 * Reglas nuevas:
 *   · listón por POOL: quien no llegó a las «horas mínimas» del día no recibe producción ese
 *     día, y un grupo entero que no trabajó se CAE — su cuota (el 80/20) se renormaliza hacia
 *     quien sí trabajó. Escalones ≥mínimo → algo de horas → presentes, para no dejar nunca
 *     producción huérfana (D86).
 *   · parámetro `minHorasProd` (h/día), editable en pantalla; 0 = exigir solo «reportó algo».
 *
 * Corre contra el código REAL del HTML con un SheetJS mínimo. No abre .xlsx ni la red.
 *
 *   node backend/pruebas/verificar_reparto_horas_minimas.js
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

const DIAS=['2026-07-16','2026-07-17','2026-07-18'];
function diaSuelto(prod){   // solo TERRAPLEN UF1 (02.07: BULL 80% + MOTO 20%)
  const cells=[[3,1,'UF1'],[4,1,'Terraplenes (solo conformación)']];
  DIAS.forEach((d,i)=>{ cells.push([5+i,0,serial(d)],[5+i,1,prod[i]]); });
  return hoja(cells,5+DIAS.length,1);
}
function parteDiario(filas){
  const hdr=['FECHA','CODIGO EQUIPO','TIPO DE EQUIPO','CENTRO DE COSTE','HORAS T','HORAS IDLE'];
  const cells=hdr.map((h,c)=>[0,c,h]);
  filas.forEach((f,i)=>{ const r=i+1;
    cells.push([r,0,serial(f.fecha)],[r,1,f.cod],[r,2,f.tipo],[r,3,f.cc||'3701.02.07'],[r,4,f.horas],[r,5,0]); });
  return hoja(cells,filas.length,hdr.length-1);
}
function parteMensual(bloques){
  const cells=[]; let r=5;
  bloques.forEach(b=>{ cells.push([r,2,b.cod],[r,4,b.tipo]); r++;
    b.ccs.forEach(c=>{ cells.push([r,4,c.cc],[r,18,c.horas]); r++; }); });
  return hoja(cells,r,18);
}
function monta(ctx, prod, filas, opts){
  opts=opts||{};
  ctx.__P={SheetNames:['dia suelto'],Sheets:{'dia suelto':diaSuelto(prod)}};
  ctx.__J=opts.mensual?{SheetNames:['MES'],Sheets:{'MES':parteMensual(filas)}}
                      :{SheetNames:['BASE MAQUINARIA'],Sheets:{'BASE MAQUINARIA':parteDiario(filas)}};
  ctx._eval('S.prod.wb=__P; S.jefe.wb=__J; S.prod.nombre="r.xlsx"; S.jefe.nombre="p.xlsx";');
  const e=ctx._el;
  e('hojaProd').value='dia suelto'; e('hojaClima').value=''; e('hojaJefe').value=opts.mensual?'MES':'BASE MAQUINARIA';
  e('propias').value=opts.propias||'NH69:BULL\nMO04:MOTO';
  e('soloHorasMaq').value=''; e('mapaAct').value='';
  e('pctBull').value='80'; e('minDia').value='0';
  e('minHorasProd').value=(opts.minHoras===undefined?'1':String(opts.minHoras));
  e('desde').value=DIAS[0]; e('hasta').value=DIAS[DIAS.length-1];
  e('repartoDiario').checked=(opts.diario!==false); e('separarUF').checked=false; e('soloHoras').checked=true;
  ctx._eval('__p=leerParams(); __ds=leerProduccion(__p); __j=leerJefe(__p); __o=repartir(__p,__ds,__j);');
  return ctx._eval('__o');
}
const fila=(out,cod,fecha)=>out.filas.find(f=>f.maquina===cod&&f.fecha===fecha);
const prodDe=(out,cod,fecha)=>out.filas.filter(f=>f.maquina===cod&&(!fecha||f.fecha===fecha))
                                       .reduce((a,f)=>a+(f.produccion||0),0);
const cuadreOK=out=>Math.abs(out.cuadre.find(c=>c.item==='02.07').dif)<0.011;

/* El parte de los dos casos del pantallazo: día 16 el bulldozer prende 0,2 h; día 17, 0,1 h;
   día 18, jornada normal de los dos. */
const PARTE_CASO1=[
  {fecha:'2026-07-16',cod:'NH69',tipo:'BULLDOZER',horas:0.2},{fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',horas:7},
  {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:0.1},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
  {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},  {fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}];

console.log('\n== Caso 1 del pantallazo — 0,2 h no pueden llevarse 526 m³ ==');
{
  const out=monta(contexto(),[658,1949,1000],PARTE_CASO1);
  ok('NH69 con 0,2 h no recibe producción ese día', prodDe(out,'NH69','2026-07-16')===0, prodDe(out,'NH69','2026-07-16')+'');
  ok('MO04 se lleva los 658 m³ (rend 94, no 2.632)', prodDe(out,'MO04','2026-07-16')===658);
  ok('NH69 con 0,1 h tampoco; MO04 se lleva los 1.949', prodDe(out,'NH69','2026-07-17')===0 && prodDe(out,'MO04','2026-07-17')===1949);
  const f=fila(out,'NH69','2026-07-16');
  ok('las 0,2 h de NH69 igual salen en fact_jefe (fila sin producción)', !!f && Math.abs(f.horas-0.2)<0.001 && f.produccion==null,
     JSON.stringify(f&&{h:f.horas,p:f.produccion}));
  ok('el día normal el 80/20 queda intacto (800/200)', prodDe(out,'NH69','2026-07-18')===800 && prodDe(out,'MO04','2026-07-18')===200);
  ok('cuadre exacto y cero huérfanas', cuadreOK(out) && out.huerfanas.length===0);
  ok('el aviso cuenta las exclusiones de NH69', (out.sinHoras.get('NH69')||0)===2, JSON.stringify([...out.sinHoras]));
}

console.log('\n== Caso 2 del pantallazo — día sin bulldozer: el 80% no se queda en uno parado ==');
{
  const parte=[
    {fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',horas:9},
    {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}];
  const out=monta(contexto(),[1349,1000,1000],parte);
  ok('MO04 recibe los 1.349 completos (100%, no el 20%)', prodDe(out,'MO04','2026-07-16')===1349, prodDe(out,'MO04','2026-07-16')+'');
  ok('NH69 no tiene NINGUNA fila con producción ese día (antes: 1.079 m³ con 0 horas)',
     prodDe(out,'NH69','2026-07-16')===0 && !out.filas.some(f=>f.maquina==='NH69'&&f.fecha==='2026-07-16'&&f.produccion!=null));
  ok('la caída del grupo queda registrada para el aviso', (out.caidas.get('02.07|BULLDOZER')||0)===1, JSON.stringify([...out.caidas]));
  ok('cuadre exacto y cero huérfanas', cuadreOK(out) && out.huerfanas.length===0);
}

console.log('\n== El parámetro manda ==');
{
  const out0=monta(contexto(),[658,1949,1000],PARTE_CASO1,{minHoras:0});
  ok('con 0: basta reportar algo — las 0,2 h vuelven a recibir (comportamiento anterior)',
     prodDe(out0,'NH69','2026-07-16')>0, prodDe(out0,'NH69','2026-07-16')+'');
  const parteSinBull=[{fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',horas:9},
    {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}];
  const out0b=monta(contexto(),[1349,1000,1000],parteSinBull,{minHoras:0});
  ok('con 0 el caso 2 SIGUE arreglado (la regla de pool no depende del umbral)',
     prodDe(out0b,'MO04','2026-07-16')===1349);
  const out3=monta(contexto(),[658,1949,1000],PARTE_CASO1,{minHoras:8});
  ok('umbral 8 h: MO04 con 7 h tampoco llega — pero alguien reportó algo, así que reciben los que reportaron (escalón 1, nada huérfano)',
     cuadreOK(out3) && out3.huerfanas.length===0 && prodDe(out3,'MO04','2026-07-16')+prodDe(out3,'NH69','2026-07-16')===658);
  const outB=monta(contexto(),[1000,1000,1000],[
    {fecha:'2026-07-16',cod:'NH69',tipo:'BULLDOZER',horas:1},{fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}]);
  ok('borde: exactamente 1,0 h con umbral 1,0 SÍ pasa', prodDe(outB,'NH69','2026-07-16')===800, prodDe(outB,'NH69','2026-07-16')+'');
}

console.log('\n== Los escalones nunca dejan producción huérfana ==');
{
  // Día 16: NADIE del pool trabajó (parte sin filas ese día) → reciben los presentes, 80/20 normal.
  const parte=[
    {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}];
  const out=monta(contexto(),[1000,1000,1000],parte);
  ok('día en que nadie trabajó: la producción igual se reparte (escalón 0)',
     prodDe(out,'NH69','2026-07-16')+prodDe(out,'MO04','2026-07-16')===1000);
  ok('y no se registra caída de grupo (no había con quién renormalizar)', !out.caidas.size, JSON.stringify([...out.caidas]));
  ok('cuadre exacto', cuadreOK(out) && out.huerfanas.length===0);
  // Día 16: solo 0,5 h de la moto — nadie llega al mínimo, pero ella reportó algo → todo suyo (escalón 1).
  const out1=monta(contexto(),[1000,1000,1000],[
    {fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',horas:0.5},
    {fecha:'2026-07-17',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',horas:8},
    {fecha:'2026-07-18',cod:'NH69',tipo:'BULLDOZER',horas:7},{fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',horas:8}]);
  ok('nadie llega al mínimo pero una reportó 0,5 h: esa recibe todo (escalón 1)',
     prodDe(out1,'MO04','2026-07-16')===1000, prodDe(out1,'MO04','2026-07-16')+'');
}

console.log('\n== El parte de BLOQUES mensuales no cambia (no hay día que mirar) ==');
{
  const bloques=[{cod:'NH69',tipo:'BULLDOZER',ccs:[{cc:'3701.02.07',horas:1}]},
                 {cod:'MO04',tipo:'MOTONIVELADORA',ccs:[{cc:'3701.02.07',horas:24}]}];
  const out=monta(contexto(),[1000,1000,1000],bloques,{mensual:true,minHoras:5});
  ok('sin detalle diario el listón no aplica: los dos reparten por el 80/20 del mes',
     prodDe(out,'NH69')>0 && prodDe(out,'MO04')>0, prodDe(out,'NH69')+' / '+prodDe(out,'MO04'));
  ok('cuadre exacto en mensual', cuadreOK(out) && out.huerfanas.length===0);
}

console.log('\n== Caso 3 — el listón mira la ACTIVIDAD, no el total de horas del día ==');
{
  /* Caso real del 13-ago: BL005 (único bulldozer) está cargado SOLO a ZODME; MO04 hace el
     terraplén. El bulldozer NO puede recibir terraplén por haber estado en obra ese día. */
  const parte=[
    {fecha:'2026-07-16',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:8},
    {fecha:'2026-07-16',cod:'MO04',tipo:'MOTONIVELADORA',cc:'3701.02.07',horas:9},
    {fecha:'2026-07-17',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:7},
    {fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',cc:'3701.02.07',horas:9},
    {fecha:'2026-07-18',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:7},
    {fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',cc:'3701.02.07',horas:9}];
  const out=monta(contexto(),[1000,1000,1000],parte,{propias:'BL005:BULL\nMO04:MOTO'});
  const bull=out.filas.filter(f=>f.maquina==='BL005'&&f.item==='02.07');
  ok('BL005 no recibe NADA de terraplén (solo está cargado a ZODME)',
     bull.reduce((a,f)=>a+(f.produccion||0),0)===0, JSON.stringify(bull.map(f=>f.fecha+':'+f.produccion)));
  ok('BL005 no tiene ninguna fila de 02.07', bull.length===0);
  ok('MO04 se lleva los 3.000 m³ del terraplén', prodDe(out,'MO04')===3000, prodDe(out,'MO04')+'');
  ok('ninguna fila lleva producción con cero horas',
     !out.filas.some(f=>f.produccion>0 && (f.horas||0)===0),
     JSON.stringify(out.filas.filter(f=>f.produccion>0&&(f.horas||0)===0).map(f=>f.maquina+' '+f.fecha+' '+f.cc)));
  ok('ninguna fila sale con la base «horas totales» (el síntoma del bug)',
     !out.filas.some(f=>/horas totales/.test(f.base||'')), JSON.stringify([...new Set(out.filas.map(f=>f.base))]));
  ok('el grupo del bulldozer consta como caído', (out.caidas.get('02.07|BULLDOZER')||0)===3, JSON.stringify([...out.caidas]));
  ok('cuadre exacto y cero huérfanas', cuadreOK(out) && out.huerfanas.length===0, JSON.stringify(out.cuadre));

  // Escalón 1: el día que nadie reportó terraplén, lo recibe quien SÍ hace esa actividad en el corte…
  const parte2=[
    {fecha:'2026-07-16',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:8},
    {fecha:'2026-07-17',cod:'BL005',tipo:'BULLDOZER',cc:'3701.02.07',horas:7},
    {fecha:'2026-07-17',cod:'MO04',tipo:'MOTONIVELADORA',cc:'3701.02.07',horas:9},
    {fecha:'2026-07-18',cod:'BL005',tipo:'BULLDOZER',cc:'3701.02.07',horas:7},
    {fecha:'2026-07-18',cod:'MO04',tipo:'MOTONIVELADORA',cc:'3701.02.07',horas:9}];
  const out2=monta(contexto(),[1000,1000,1000],parte2,{propias:'BL005:BULL\nMO04:MOTO'});
  ok('escalón 1: el 16 nadie hizo terraplén, pero los dos lo hacen en el corte → se reparte igual',
     Math.abs(prodDe(out2,'BL005','2026-07-16')+prodDe(out2,'MO04','2026-07-16')-1000)<0.011);
  ok('escalón 1: cuadre exacto y nada huérfano', cuadreOK(out2) && out2.huerfanas.length===0);

  // …y si NADIE hace esa actividad en todo el corte, se cae al escalón 0 (presentes) sin perder m³.
  const parte3=[
    {fecha:'2026-07-16',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:8},
    {fecha:'2026-07-17',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:7},
    {fecha:'2026-07-18',cod:'BL005',tipo:'BULLDOZER',cc:'3702.02.08',horas:7}];
  const out3=monta(contexto(),[1000,1000,1000],parte3,{propias:'BL005:BULL\nMO04:MOTO'});
  ok('escalón 0: si nadie hace la actividad en todo el corte, la producción NO queda huérfana',
     out3.huerfanas.length===0 && cuadreOK(out3), JSON.stringify(out3.huerfanas));
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

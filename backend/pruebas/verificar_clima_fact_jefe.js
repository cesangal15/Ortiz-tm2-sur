#!/usr/bin/env node
/**
 * Verificación — CLIMA en `fact_jefe` (reporte de producción mensual de maquinaria).
 *
 * La columna S (CLIMA) de `fact_jefe` salía SIEMPRE en blanco (D52: «pospuesto»). Ahora
 * `Reparto_Produccion_Maquinaria.html` la llena leyendo la hoja `DATOS` del reporte diario de
 * obra (columna TIEMPO), que es donde el jefe apunta el clima del día.
 *
 * Se ejecuta contra el código REAL: extrae el <script> del HTML y lo corre con un SheetJS
 * mínimo (`encode_cell`/`decode_range`), así que si alguien mueve la columna de la salida,
 * cambia el nombre de la hoja o rompe la lectura, esto lo dice. No abre ningún .xlsx ni la red.
 *
 * Cubre lo que puede romperse en silencio:
 *   · el clima cae en otra columna de las 29 (el informe lee por posición al pegar A:AC);
 *   · la cabecera de `DATOS` se busca por texto, no por índice (hoy fila 2, mañana otra);
 *   · el mismo clima escrito de tres formas («SOLEADO»/«Soleado»/«soleado») parte una dinámica;
 *   · un archivo viejo SIN hoja `DATOS` tiene que seguir funcionando, con la columna vacía;
 *   · el clima es del DÍA: todas las filas de esa fecha llevan el mismo valor;
 *   · nada más de la salida se movió (29 columnas, producción y horas donde estaban).
 *
 *   node backend/pruebas/verificar_clima_fact_jefe.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

/* ---- SheetJS mínimo: solo lo que usan cellAt() y rangoHoja() ---- */
function encode_col(c){ let s=''; c++; while(c>0){ const r=(c-1)%26; s=String.fromCharCode(65+r)+s; c=(c-r-1)/26; } return s; }
function decode_col(s){ let n=0; for(const ch of s) n=n*26+(ch.charCodeAt(0)-64); return n-1; }
const XLSX={ utils:{
  encode_cell:a=>encode_col(a.c)+(a.r+1),
  decode_range:ref=>{ const p=String(ref).split(':'); const f=c=>{ const m=c.match(/^([A-Z]+)(\d+)$/); return {c:decode_col(m[1]), r:+m[2]-1}; };
                      return { s:f(p[0]), e:f(p[1]||p[0]) }; }
}};

function contexto(){
  const js=(function(){
    const s=fs.readFileSync(path.join(REPO,'Reparto_Produccion_Maquinaria.html'),'utf8');
    const m=s.match(/<script>([\s\S]*?)<\/script>/g)||[];
    return m.map(b=>b.replace(/^<script>/,'').replace(/<\/script>$/,'')).join('\n');
  })();
  const els={};
  const el=id=>{ if(!els[id]) els[id]={ id:id, value:'', textContent:'', innerHTML:'', checked:false, disabled:false,
                   style:{}, files:[], classList:{add(){},remove(){}}, addEventListener(){} };
                 return els[id]; };
  const doc={ getElementById:el, querySelector:()=>null, querySelectorAll:()=>[] };
  const ctx={ document:doc, console, XLSX:XLSX, location:{protocol:'file:'}, _els:els,
              navigator:{clipboard:{writeText:async()=>{}}}, alert:()=>{}, setTimeout:()=>0,
              clearTimeout:()=>{}, Intl:Intl, addEventListener:()=>{} };
  ctx.window=ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  ctx._eval=e=>vm.runInContext(e,ctx);
  ctx._el=el;
  return ctx;
}

/* Hoja `DATOS` de mentira con la MISMA forma que la real de ago-2026:
   fila 1 = totales sueltos sin encabezado · fila 2 = encabezados · datos desde la 3. */
function hojaDatos(filas, opts){
  opts=opts||{};
  const hdr=opts.hdr||['DIA','FECHA','periodo','total excavacion','MEDIA EXCAVACION',' VOLUMEN APROV. UF1',
    ' VOLUMEN PRESTAMO','NO APROV','total aprov.','MEDIA APROV.','TERRAPLEN UF1','TERRAPLEN UF2','total terraplen',
    'MEDIA TERRAPLEN','SUBBASE UF1','SUBBASE UF2','total subbase','MEDIA SUBBASE','BASE UF1','BASE UF2','total base',
    'MEDIA BASE','novedades','TIEMPO','Columna1','Columna2'];
  const iF=hdr.indexOf('DIA')>=0?hdr.indexOf('DIA'):hdr.indexOf('FECHA');
  const iT=hdr.indexOf('TIEMPO')>=0?hdr.indexOf('TIEMPO'):hdr.indexOf('CLIMA');
  const filaHdr=opts.filaHdr===undefined?1:opts.filaHdr;
  const ws={};
  const set=(r,c,cell)=>{ ws[encode_col(c)+(r+1)]=cell; };
  if(filaHdr>0) set(0,3,{t:'n',v:725967.11});                       // la fila 1 de totales
  hdr.forEach((h,c)=>{ if(h) set(filaHdr,c,{t:'s',v:h}); });
  let maxR=filaHdr;
  filas.forEach((f,i)=>{
    const r=filaHdr+1+i; maxR=r;
    if(f.fecha){
      // Serial de Excel, que es como llega la fecha cuando la celda no es de texto.
      const serial=Math.round(Date.UTC(+f.fecha.slice(0,4), +f.fecha.slice(5,7)-1, +f.fecha.slice(8,10))/86400000)+25569;
      set(r,iF,{t:'n',v:serial,w:f.fecha});
    }
    if(f.clima!==undefined && f.clima!==null) set(r,iT,{t:'s',v:f.clima});
    if(f.exc!==undefined) set(r,3,{t:'n',v:f.exc});
  });
  // Cola de la hoja real: filas sueltas con números y SIN fecha (no deben leerse).
  set(maxR+2,16,{t:'n',v:70});
  ws['!ref']='A1:'+encode_col(hdr.length-1)+(maxR+3);
  return ws;
}
function libro(hojas){ return { SheetNames:Object.keys(hojas), Sheets:hojas }; }

const DIAS=[
  { fecha:'2026-07-16', clima:'SOLEADO' },
  { fecha:'2026-07-17', clima:'lluvias' },
  { fecha:'2026-07-18', clima:'LLUVIAS PARCIALES' },
  { fecha:'2026-07-21', clima:'Soleado' },
  { fecha:'2026-07-22', clima:null },                    // día sin clima apuntado
  { fecha:'2026-08-20', clima:'lluvias parciales' },      // fuera del corte
  { fecha:'2026-06-30', clima:'SOLEADO' }                 // fuera del corte, por abajo
];
const P={ desde:'2026-07-16', hasta:'2026-08-15' };
const DSDIAS={ dias:['2026-07-16','2026-07-17','2026-07-18','2026-07-21','2026-07-22'] };

console.log('\n== canonClima — el mismo clima escrito de varias formas ==');
{
  const ctx=contexto();
  const c=t=>ctx._eval('canonClima('+JSON.stringify(t)+')');
  // Los siete valores que trae hoy la hoja DATOS real (351 días de historia).
  ok('SOLEADO / Soleado → SOLEADO', c('SOLEADO')==='SOLEADO' && c('Soleado')==='SOLEADO');
  ok('LLUVIAS / lluvias → LLUVIAS', c('LLUVIAS')==='LLUVIAS' && c('lluvias')==='LLUVIAS');
  ok('LLUVIAS PARCIALES en sus tres grafías → LLUVIAS PARCIALES',
     c('LLUVIAS PARCIALES')==='LLUVIAS PARCIALES' && c('Lluvias parciales')==='LLUVIAS PARCIALES'
     && c('lluvias parciales')==='LLUVIAS PARCIALES');
  ok('«parcial» NO convierte un nublado en lluvia', c('Parcialmente nublado')==='PARCIALMENTE NUBLADO', c('Parcialmente nublado'));
  ok('Nublado → NUBLADO', c('Nublado')==='NUBLADO');
  ok('vocabulario del app (D37): Lluvia fuerte → LLUVIAS', c('Lluvia fuerte')==='LLUVIAS');
  ok('un valor desconocido se respeta tal cual, en mayúsculas', c('granizo')==='GRANIZO');
  ok('vacío / espacios → cadena vacía', c('')==='' && c('   ')==='' && c(null)==='');
}

console.log('\n== leerClima — hoja DATOS del reporte diario de obra ==');
{
  const ctx=contexto();
  ctx.__wb=libro({ 'dia suelto':{'!ref':'A1:B2'}, 'DATOS':hojaDatos(DIAS) });
  ctx._eval('S.prod.wb=__wb; S.prod.nombre="TM2_SUR_REPORTE.xlsx";');
  ctx._el('hojaClima').value='DATOS';
  const r=ctx._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('encuentra la hoja y su cabecera', r.hay===true && r.cabecera===true && r.hoja==='DATOS');
  ok('4 días del corte con clima', r.porDia.size===4, 'size='+r.porDia.size);
  ok('16/07 SOLEADO', r.porDia.get('2026-07-16')==='SOLEADO');
  ok('17/07 lluvias → LLUVIAS', r.porDia.get('2026-07-17')==='LLUVIAS');
  ok('18/07 LLUVIAS PARCIALES', r.porDia.get('2026-07-18')==='LLUVIAS PARCIALES');
  ok('21/07 Soleado → SOLEADO (no se duplica el valor)', r.porDia.get('2026-07-21')==='SOLEADO' && r.valores.get('SOLEADO')===2);
  ok('los días fuera del corte no entran', !r.porDia.has('2026-08-20') && !r.porDia.has('2026-06-30') && r.fuera===2, 'fuera='+r.fuera);
  ok('el día con producción y sin clima queda señalado', r.sinClima.length===1 && r.sinClima[0]==='2026-07-22', JSON.stringify(r.sinClima));
  ok('las filas de cola sin fecha no se leen', r.porDia.size===4);
}

console.log('\n== leerClima — casos que NO deben tumbar la herramienta ==');
{
  const ctx=contexto();
  ctx.__wb=libro({ 'dia suelto':{'!ref':'A1:B2'} });         // archivo anterior a ago-2026
  ctx._eval('S.prod.wb=__wb; S.prod.nombre="viejo.xlsx";');
  ctx._el('hojaClima').value='DATOS';
  const r=ctx._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('sin hoja DATOS: no lanza, hay=false y el mapa vacío', r.hay===false && r.porDia.size===0 && r.hoja==='');

  ctx._el('hojaClima').value='';
  const v=ctx._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('hoja de clima vacía = clima apagado', v.hay===false && v.pedida==='' && v.porDia.size===0);

  const ctx2=contexto();
  ctx2.__wb=libro({ 'DATOS':hojaDatos(DIAS,{hdr:['DIA','FECHA','total excavacion','novedades'],filaHdr:1}) });
  ctx2._eval('S.prod.wb=__wb;');
  ctx2._el('hojaClima').value='DATOS';
  const sc=ctx2._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('hoja sin columna TIEMPO/CLIMA: cabecera=false, no lanza', sc.hay===false && sc.cabecera===false && sc.hoja==='DATOS');

  // La cabecera se resuelve por TEXTO: si mañana la fila 2 pasa a ser la 5, sigue leyendo.
  const ctx3=contexto();
  ctx3.__wb=libro({ 'DATOS':hojaDatos(DIAS,{filaHdr:4}) });
  ctx3._eval('S.prod.wb=__wb;');
  ctx3._el('hojaClima').value='datos';                        // y el nombre sin importar mayúsculas
  const mv=ctx3._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('cabecera movida de fila y nombre en minúsculas: sigue leyendo los 4 días', mv.hay===true && mv.porDia.size===4);

  // Columna CLIMA en vez de TIEMPO (por si el jefe renombra el encabezado).
  const ctx4=contexto();
  ctx4.__wb=libro({ 'DATOS':hojaDatos(DIAS,{hdr:['FECHA','total excavacion','CLIMA']}) });
  ctx4._eval('S.prod.wb=__wb;');
  ctx4._el('hojaClima').value='DATOS';
  const cl=ctx4._eval('leerClima('+JSON.stringify(P)+','+JSON.stringify(DSDIAS)+')');
  ok('encabezado «CLIMA» también vale', cl.hay===true && cl.porDia.size===4);
}

console.log('\n== aoaFactJefe — la salida A:AC ==');
{
  const ctx=contexto();
  const filas=[
    { maquina:'EXC001', tipo:'EXCAVADORA', fecha:'2026-07-16', proyecto:'3701', uf:'UF1', item:'02.05',
      cc:'3701.02.05', actividad:'EXCAVACION COMUN', sub:'EXCAVACION APROVECHABLE', unidad:'m3',
      horas:12, idle:0.5, produccion:1234.56, base:'', clima:'SOLEADO', operador:'', obs:'' },
    { maquina:'BL005', tipo:'BULLDOZER', fecha:'2026-07-16', proyecto:'3701', uf:'UF1', item:'02.07',
      cc:'3701.02.07', actividad:'TERRAPLEN', sub:'NUCLEO DE TERRAPLEN', unidad:'m3',
      horas:10, idle:0, produccion:800, base:'', clima:'SOLEADO', operador:'', obs:'' },
    { maquina:'MO03', tipo:'MOTONIVELADORA', fecha:'2026-07-17', proyecto:'3702', uf:'UF2', item:'03.01',
      cc:'3702.03.01', actividad:'SUBBASE', sub:'CONFORMACION SUBBASE', unidad:'m3',
      horas:8, idle:0, produccion:400, base:'', clima:'LLUVIAS', operador:'', obs:'' },
    { maquina:'MO09', tipo:'MOTONIVELADORA', fecha:'2026-07-22', proyecto:'3701', uf:'UF1', item:'03.01',
      cc:'3701.03.01', actividad:'SUBBASE', sub:'CONFORMACION SUBBASE', unidad:'m3',
      horas:6, idle:0, produccion:200, base:'', clima:'', operador:'', obs:'' }   // día sin clima
  ];
  ctx.__filas=filas;
  ctx._eval('S.out={ P:'+JSON.stringify(P)+', rep:{ filas:__filas } };');
  const aoa=ctx._eval('aoaFactJefe(true)');
  const CAB=ctx._eval('CAB_FACT');
  const iClima=CAB.indexOf('CLIMA');
  ok('la cabecera sigue teniendo 29 columnas (A:AC)', CAB.length===29, 'len='+CAB.length);
  ok('CLIMA es la columna S (índice 18)', iClima===18, 'idx='+iClima);
  ok('todas las filas salen con 29 celdas', aoa.every(r=>r.length===29));
  ok('EXC001 16/07 → SOLEADO en la columna S', aoa[1][iClima]==='SOLEADO', JSON.stringify(aoa[1][iClima]));
  ok('el clima es del DÍA: BL005 del 16/07 lleva el mismo', aoa[2][iClima]==='SOLEADO');
  ok('17/07 → LLUVIAS', aoa[3][iClima]==='LLUVIAS');
  ok('día sin clima → celda vacía (no «undefined»)', aoa[4][iClima]==='');
  // Nada de lo que ya funcionaba se movió de sitio.
  ok('ESTADO sigue en R (17) = OPERANDO', aoa[1][17]==='OPERANDO' && CAB[17]==='ESTADO');
  ok('Producción sigue en T (19)', aoa[1][19]===1234.56 && CAB[19]==='Producción');
  ok('Horas Operación siguen en L (11)', aoa[1][11]===12 && CAB[11]==='Horas Operación');
  ok('centro_costo e item siguen al final (AB, AC)', aoa[1][27]==='3701.02.05' && aoa[1][28]==='02.05');
  // El TSV del botón «Copiar» arrastra el clima igual que el .xlsx.
  const tsv=ctx._eval('aoaFactJefe(false).map(r=>r.map(fmtTSV).join("\\t"))');
  ok('el copiado al portapapeles lleva el clima en su sitio', tsv[0].split('\t')[iClima]==='SOLEADO');
  ok('el copiado no trae fila de encabezado', tsv.length===filas.length);
}

console.log('\n== el clima no toca el reparto ==');
{
  const ctx=contexto();
  // La producción se sigue leyendo de `dia suelto`: `DATOS` no entra en el mapa actividad → CC.
  const mapa=ctx._eval('MAPA_ACTIVIDAD.map(r=>r.txt)');
  ok('el mapa actividad → CC no cambió', mapa.join('|')==='SUBBASE|SUB BASE|BASE GRANULAR|PRESTAMO|NO APROVECHABLE|APROVECHABLE|TERRAPLENES|TERRAPLEN', mapa.join('|'));
  ok('la hoja de producción por defecto sigue siendo `dia suelto`',
     /id="hojaProd" value="dia suelto"/.test(fs.readFileSync(path.join(REPO,'Reparto_Produccion_Maquinaria.html'),'utf8')));
  ok('la hoja de clima por defecto es `DATOS`',
     /id="hojaClima" value="DATOS"/.test(fs.readFileSync(path.join(REPO,'Reparto_Produccion_Maquinaria.html'),'utf8')));
  ok('leerProduccion no lee la columna TIEMPO (el clima no es producción)',
     !/TIEMPO/.test(ctx._eval('String(leerProduccion)')));
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

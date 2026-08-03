#!/usr/bin/env node
/**
 * Verificación D113 — terraplén por MATERIAL (crudo de río · UF3).
 *
 * Se ejecuta contra el código REAL: extrae los bloques <script> de los HTML y carga `Codigo.gs` como
 * módulo, así que si alguien cambia el catálogo, el mapa de Captura o las reglas del panel, esto lo
 * dice. No abre el Sheet ni la red: solo lógica de clasificación, validación y agrupación.
 *
 * Cubre las tres cosas que podían romperse en silencio:
 *   · las máquinas de las dos actividades nuevas dejan de pasar a Captura_Diaria (sin par en
 *     CAPTURA_ACT_MAP, `derivarActividad` devuelve a_captura='NO');
 *   · la reconciliación automática del panel las apaga porque la chequeadora reportó terraplén, y se
 *     PIERDE volumen real (la chequeadora solo mide los viajes desde los bancos de corte propio);
 *   · la validación "terraplén ≤ aprovechable + préstamo" las suma y dispara la alerta roja sin error.
 * Y las dos que tenían que seguir igual: el copiado A:O del maestro (COPY_END=15) y la vista del jefe
 * con el desglose apagado.
 *
 *   node backend/pruebas/verificar_d113_terraplen_material.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

function jsDe(archivo){
  const s=fs.readFileSync(path.join(REPO,archivo),'utf8');
  const m=s.match(/<script>([\s\S]*?)<\/script>/g)||[];
  return m.map(b=>b.replace(/^<script>/,'').replace(/<\/script>$/,'')).join('\n');
}
function contexto(js, extra){
  const els={};
  const doc={ getElementById:id=>els[id]||null, querySelector:()=>null, querySelectorAll:()=>[] };
  const ctx={ document:doc, window:{}, localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},
              navigator:{}, console, fetch:()=>{}, alert:()=>{}, confirm:()=>true, _els:els,
              addEventListener:()=>{}, setTimeout:()=>{} };
  ctx.window=ctx;
  Object.assign(ctx, extra||{});
  vm.createContext(ctx);
  vm.runInContext(js.replace(/window\.onload\s*=/, 'var _onload='), ctx);
  ctx._eval=expr=>vm.runInContext(expr, ctx);
  return ctx;
}

console.log('\n== backend/Codigo.gs — CAPTURA_ACT_MAP / derivarActividad ==');
{
  const src=fs.readFileSync(path.join(REPO,'backend/Codigo.gs'),'utf8');
  const ctx={console, Logger:{log(){}}, Utilities:{}, SpreadsheetApp:{}};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const a=ctx.derivarActividad({actividad:'Terraplén con crudo de río'});
  const b=ctx.derivarActividad({actividad:'Terraplén de UF3'});
  const n=ctx.derivarActividad({actividad:'Núcleo de terraplén'});
  ok('crudo de río → TERRAPLEN/NUCLEO, a_captura=SI', a.h==='TERRAPLEN'&&a.i==='NUCLEO DE TERRAPLEN'&&a.aCaptura==='SI', JSON.stringify(a));
  ok('UF3 → TERRAPLEN/NUCLEO, a_captura=SI', b.h==='TERRAPLEN'&&b.i==='NUCLEO DE TERRAPLEN'&&b.aCaptura==='SI', JSON.stringify(b));
  ok('núcleo intacto', n.i==='NUCLEO DE TERRAPLEN');
  ok('corona intacta', ctx.derivarActividad({actividad:'Corona de terraplén'}).i==='CORONA DE TERRAPLEN');
  ok('sin par sigue devolviendo NO (pedraplén)', ctx.derivarActividad({actividad:'Pedraplén compacto'}).aCaptura==='NO');
  // consolidado: forma de la fila devuelta (append tras A–T, copiado A:O intacto)
  const DH=vm.runInContext('DATA_HEADERS', ctx);
  const AT=20, actCol=DH.indexOf('actividad');
  ok('DATA_HEADERS.actividad es columna interna (>= A–T)', actCol>=AT, 'idx='+actCol);
  const fila=new Array(DH.length).fill('');
  fila[5]='Terraplenes (solo conformación)'; fila[14]=120; fila[actCol]='Terraplén con crudo de río';
  const row=fila.slice(0,AT); row.push(String(fila[actCol]).trim());
  ok('la fila del consolidado lleva 21 celdas y la 21ª es la actividad', row.length===21&&row[20]==='Terraplén con crudo de río');
  ok('el copiado A:O (COPY_END=15) no ve la columna nueva', row.slice(0,15).length===15&&row.slice(0,15).indexOf('Terraplén con crudo de río')<0);
}

console.log('\n== reporte-capataz.html — catálogo ==');
{
  const ctx=contexto(jsDe('reporte-capataz.html'));
  const A=ctx._eval('ACT_IDX');
  ['Terraplén con crudo de río','Terraplén de UF3'].forEach(n=>{
    const x=A[n];
    ok('capataz ofrece "'+n+'" con ítem/CC/unidad de terraplén',
      !!x && x.cc==='02.07' && x.item==='Terraplenes (solo conformación)' && x.uni==='m3' && x.medida==='m3' && x.data===true, JSON.stringify(x));
    ok('  · va en el grupo Terraplén', !!x && x.g==='Terraplén');
  });
  ok('el catálogo del capataz no perdió actividades', ctx._eval('ACTIVIDADES').length===31, 'n='+ctx._eval('ACTIVIDADES').length);
  ok('grupo/capítulo de DATA sin cambios (TIERRAS/EXPLANACIONES)',
     ctx.grupoFromCc('02.07')==='TIERRAS' && ctx.capFromCc('02.07')==='EXPLANACIONES');
}

console.log('\n== encargado.html — panel del residente ==');
{
  const ctx=contexto(jsDe('encargado.html'));
  const S=ctx._eval('STATE');
  const L=(act,rol,largo,desc)=>({actividad:act, rol:rol, largo:largo, unidad:'m3',
    descripcion:desc||'Terraplenes (solo conformación)', centro_costo:'3701.02.07', pk_inicial:'20+000', uf:'UF1', _inc:true});

  ok('crudo de río cae en la categoría Terraplén', ctx.categoria(L('Terraplén con crudo de río','capataz',100))==='Terraplén');
  ok('UF3 cae en la categoría Terraplén', ctx.categoria(L('Terraplén de UF3','capataz',100))==='Terraplén');
  ok('el panel las ofrece en "agregar línea"', !!ctx._eval("ACT_IDX['Terraplén con crudo de río']") && !!ctx._eval("ACT_IDX['Terraplén de UF3']"));
  ok('reconocidas como material externo', ctx.esTerraplenExterno(L('Terraplén con crudo de río','capataz',1)) && ctx.esTerraplenExterno(L('Terraplén de UF3','capataz',1)));
  ok('núcleo/corona NO son material externo', !ctx.esTerraplenExterno(L('Núcleo de terraplén','capataz',1)) && !ctx.esTerraplenExterno(L('Corona de terraplén','capataz',1)));
  ok('sin tilde también se reconoce (robustez del nombre)', ctx.esTerraplenExterno({actividad:'Terraplen con crudo de rio'}));

  // --- reconciliación automática: la chequeadora reportó terraplén ---
  S.cantidades=[ L('Núcleo de terraplén','chequeadora',500), L('Núcleo de terraplén','capataz',480),
                         L('Terraplén con crudo de río','capataz',200), L('Terraplén de UF3','capataz',150) ];
  ctx.autoReconcile();
  const c=S.cantidades;
  ok('el núcleo del capataz SÍ se apaga solo (regla de siempre)', c[1]._control===true && c[1]._inc===false);
  ok('crudo de río NO se apaga', !c[2]._control && c[2]._inc===true);
  ok('UF3 NO se apaga', !c[3]._control && c[3]._inc===true);
  ok('la de chequeadora sigue encendida', c[0]._inc===true);

  // --- validación terraplén ≤ aprovechable + préstamo ---
  S.cantidades=[ {actividad:'Excavación aprovechable (masivo)', rol:'chequeadora', largo:600, unidad:'m3',
                          descripcion:'Excavaciones en material común APROVECHABLE', centro_costo:'3701.02.05', pk_inicial:'19+800', uf:'UF1', _inc:true},
                         L('Núcleo de terraplén','chequeadora',560),
                         L('Terraplén con crudo de río','capataz',300),
                         L('Terraplén de UF3','capataz',200) ];
  let tot=ctx.calcTotales();
  ok('el TOTAL de terraplén de la pantalla sí los incluye (1.060)', tot['Terraplén'].total===1060, String(tot['Terraplén'].total));
  ok('el total marca 500 m³ de material externo', tot['Terraplén'].ext===500, String(tot['Terraplén'].ext));
  ok('la comparación usa solo 560 (sin el externo)', ctx.terraValidable(tot)===560, String(ctx.terraValidable(tot)));
  ok('NO se dispara la alerta roja (560 ≤ 600)', ctx.avisoTerraplen(tot)==='', ctx.avisoTerraplen(tot));
  ok('el ✓ lleva la nota que explica los 500 m³ excluidos', /500/.test(ctx.renderChequeoTerraplen(tot)) && /crudo de r/.test(ctx.renderChequeoTerraplen(tot)));
  ok('el total de pantalla anota cuánto es externo', /incl\. 500/.test(ctx.notaExtTot(tot['Terraplén'])));

  // la regla sigue viva para el terraplén normal
  S.cantidades[1].largo=900;
  tot=ctx.calcTotales();
  ok('con terraplén propio 900 > 600 la alerta SÍ salta', /supera/.test(ctx.avisoTerraplen(tot)), ctx.avisoTerraplen(tot));
  ok('  · y el aviso compara 900, no 1.400', /900/.test(ctx.avisoTerraplen(tot)) && !/1\.400/.test(ctx.avisoTerraplen(tot)), ctx.avisoTerraplen(tot));

  // sin material externo, todo idéntico a antes
  S.cantidades=[ {actividad:'Excavación aprovechable (masivo)', rol:'chequeadora', largo:600, unidad:'m3',
                          descripcion:'Excavaciones en material común APROVECHABLE', centro_costo:'3701.02.05', pk_inicial:'19+800', uf:'UF1', _inc:true},
                         L('Núcleo de terraplén','chequeadora',560) ];
  tot=ctx.calcTotales();
  ok('sin crudo de río / UF3 el panel no cambia en nada', ctx.terraValidable(tot)===560 && ctx.notaExtTot(tot['Terraplén'])==='' && ctx.renderChequeoTerraplen(tot).indexOf('↳')<0);

  // marca de duplicado
  S.cantidades=[ L('Núcleo de terraplén','chequeadora',500), L('Terraplén con crudo de río','capataz',200) ];
  const dups=ctx.computeDups();
  ok('el crudo de río no se marca como posible duplicado', !dups[1]);

  // WhatsApp
  ok('etiqueta de WhatsApp: crudo de río', ctx.tagMaterial(L('Terraplén con crudo de río','capataz',1))==='crudo de río');
  ok('etiqueta de WhatsApp: UF3', ctx.tagMaterial(L('Terraplén de UF3','capataz',1))==='UF3');
  ok('terraplén normal sin etiqueta', ctx.tagMaterial(L('Núcleo de terraplén','capataz',1))==='');
}

console.log('\n== jefe.html — desglose por MATERIAL dentro de la actividad (D113d) ==');
{
  const ctx=contexto(jsDe('jefe.html'));
  const chk={checked:false};
  ctx._els['fDesglose']=chk; ctx._els['fArea']={value:''}; ctx._els['fActividad']={value:''}; ctx._els['fUf']={value:''};
  const DESC='Terraplenes (solo conformación)';
  const fila=(largo, act, pk)=>{ const r=new Array(20).fill(''); r[0]='2026-08-03'; r[3]='3701.02.07'; r[5]=DESC;
    r[6]='UF1'; r[8]='tm2 pk 20+000 - 20+800'; r[9]=pk||20000; r[10]=(pk||20000)+800; r[13]='m3'; r[14]=largo;
    r.push(act===undefined?'':act); return r; };
  // El ejemplo del dueño: 5.000 de terraplén, de los cuales 200 son de crudo de río.
  const filas=[ fila(3000,'Núcleo de terraplén'), fila(1800,'Corona de terraplén',21000),
                fila(200,'Terraplén con crudo de río',22000) ];
  const S=ctx._eval('STATE');
  S.filas=filas; S.cols={FECHA:0,GRUPO:2,CC:3,DESCRIPCION:5,UF:6,ELEMENTO:8,ABS_INI:9,ABS_FIN:10,UNIDAD:13,LARGO:14,ACTIVIDAD:20,COPY_END:15};
  const res=ctx.resumenActividades(filas);
  ok('la actividad NO se parte: sigue siendo un solo bloque', res.length===1 && res[0].actividad===DESC, JSON.stringify(res.map(r=>r.actividad)));
  ok('  · con su total de siempre: 5.000 m³', res[0].unidades['m3']===5000, String(res[0].unidades['m3']));
  const mats=res[0].materiales;
  ok('  · y el desglose por material: 3 componentes', mats.length===3, JSON.stringify(mats.map(m=>m.nombre+' '+m.total)));
  ok('  · ordenado de mayor a menor (núcleo 3.000 primero)', mats[0].nombre==='Núcleo de terraplén' && mats[0].total===3000);
  ok('  · el crudo de río va al final con 200', mats[2].nombre==='Terraplén con crudo de río' && mats[2].total===200);
  ok('  · los componentes suman exactamente el total', mats.reduce((s,m)=>s+m.total,0)===5000);
  const html=ctx.bloqueActividad(res[0]);
  ok('el bloque muestra el total y el desglose juntos', /5\.000/.test(html) && /Terraplén con crudo de río/.test(html) && /200/.test(html));
  ok('  · las ubicaciones (PK) siguen ahí', /PK 20\+000/.test(html));
  ok('  · el HTML del bloque cierra bien (no sobran ni faltan divs)',
     (html.match(/<div/g)||[]).length===(html.match(/<\/div>/g)||[]).length,
     (html.match(/<div/g)||[]).length+' abre / '+(html.match(/<\/div>/g)||[]).length+' cierra');

  // Una actividad de un solo material: la vista NO estrena línea.
  const solas=[ fila(500,'Conformación de subbase') ];
  ok('actividad con un solo material: sin línea de desglose', ctx.lineaMateriales(ctx.resumenActividades(solas)[0])==='');
  // Filas anteriores al cambio (sin `actividad` en DATA): tampoco.
  const viejas=[ fila(300, ''), fila(200, '') ];
  ok('filas anteriores al cambio: sin línea de desglose (caen bajo su actividad)',
     ctx.lineaMateriales(ctx.resumenActividades(viejas)[0])==='');
  // Mezcla de viejo y nuevo en el mismo rango: lo viejo se agrupa bajo el nombre de la actividad.
  const mixto=[ fila(400, ''), fila(100,'Terraplén de UF3') ];
  const rm=ctx.resumenActividades(mixto)[0];
  ok('rango que cruza el despliegue: lo viejo bajo su actividad, lo nuevo aparte',
     rm.materiales.length===2 && rm.materiales[0].nombre===DESC && rm.materiales[0].total===400
     && rm.materiales[1].nombre==='Terraplén de UF3' && rm.materiales[1].total===100,
     JSON.stringify(rm.materiales.map(m=>m.nombre+' '+m.total)));
  // ODT: mismo mecanismo, misma columna interna.
  const odt=(largo,act)=>{ const r=new Array(20).fill(''); r[0]='2026-08-03'; r[3]='3701.06.02';
    r[5]='Rellenos con material seleccionado'; r[6]='UF1'; r[8]='ODT1-14+300'; r[9]=14300; r[10]=14300;
    r[13]='m3'; r[14]=largo; r.push(act); return r; };
  const ro=ctx.resumenActividades([odt(70,'Rellenos con material seleccionado'), odt(30,'Relleno con crudo de río')])[0];
  ok('ODT: un solo bloque de 100 m³ con su desglose de material',
     ro.unidades['m3']===100 && ro.materiales.length===2 && ro.materiales[1].nombre==='Relleno con crudo de río' && ro.materiales[1].total===30,
     JSON.stringify(ro.materiales.map(m=>m.nombre+' '+m.total)));
  // El copiado al maestro no se entera de nada de esto.
  ok('el copiado A:O sigue sin arrastrar la actividad',
     (()=>{ const c=[]; for(let j=0;j<ctx.col('COPY_END');j++) c.push(ctx.celdaCopia(filas[2][j]));
            return c.length===15 && c.join('\t').indexOf('crudo de río')<0; })());
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

#!/usr/bin/env node
/**
 * Verificación D113c — distinción por MATERIAL en DRENAJES: relleno con crudo de río / de UF3.
 *
 * El caso: el ítem contractual de la BASE es UNO —`37xx.06.02 "Rellenos con material seleccionado"`—
 * y lo que hay que distinguir es CON QUÉ MATERIAL se hizo, igual que el terraplén de tierras (D113).
 * En drenajes el catálogo es vivo desde la BASE y hasta ahora la actividad ERA la descripción del ítem
 * (`actividad = it.desc` en los dos frontends), así que no había dónde poner la distinción: por eso
 * esto SÍ es código, a diferencia de un ítem NUEVO, que sí basta con agregarlo a la BASE.
 *
 * Lo que comprueba, sobre el código real (se carga `Codigo.gs` con una BASE simulada y se extraen los
 * <script> de los HTML):
 *   · el catálogo sirve el ítem normal Y sus dos variantes, con el MISMO CC, descripción y unidad;
 *   · la deduplicación de los dos frontends no se come las variantes (comparten CC+descripción);
 *   · la fila que llega a DATA es IDÉNTICA a la del ítem normal en A–T —DESCRIPCION verbatim de la
 *     BASE, el maestro no se entera— y la distinción viaja en la columna INTERNA `actividad`;
 *   · el panel del residente agrupa las variantes aparte del ítem normal, y lo ya reportado (donde
 *     `actividad` y `descripcion` son el mismo string) se sigue viendo exactamente igual;
 *   · el desglose del panel del jefe (D113) las separa, que es el objetivo final.
 *
 *   node backend/pruebas/verificar_material_drenajes.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){fallos++; console.log('  ✗ '+n+(x?'  → '+x:''));} else console.log('  ✓ '+n); }

function jsDe(archivo){
  const s=fs.readFileSync(path.join(REPO,archivo),'utf8');
  return (s.match(/<script>([\s\S]*?)<\/script>/g)||[])
    .map(b=>b.replace(/^<script>/,'').replace(/<\/script>$/,'')).join('\n');
}
function contexto(js){
  const els={};
  const ctx={ document:{getElementById:id=>els[id]||null, querySelector:()=>null, querySelectorAll:()=>[]},
    localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}, navigator:{}, console,
    fetch:()=>{}, alert:()=>{}, confirm:()=>true, addEventListener:()=>{}, setTimeout:()=>{}, _els:els };
  ctx.window=ctx; vm.createContext(ctx);
  vm.runInContext(js.replace(/window\.onload\s*=/,'var _onload='), ctx);
  ctx._eval=e=>vm.runInContext(e, ctx);
  return ctx;
}

// ---------------- backend con una BASE simulada ----------------
const ctx={console, Logger:{log(){}}, Utilities:{}, SpreadsheetApp:{}};
ctx.ContentService={ MimeType:{JSON:'json'},
  createTextOutput:t=>({ _t:t, setMimeType(){return this;}, getContent(){return this._t;} }) };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(REPO,'backend/Codigo.gs'),'utf8'), ctx);

const ITEM='Rellenos con material seleccionado';            // el ítem REAL de la BASE para 06.02
const BASE=[
  ['CENTRO DE COSTO','DESCRIPCION','UND','','','','','','','','',''],
  ['3701.06.01','Excavaciones varias sin clasicar','m3','','','','','','','ODT1-14+300',14300,14300],
  ['',          '',                                '',  '','','','','','','ODT3-34+500',34500,34500],
  ['3701.06.02', ITEM,                             'm3','','','','','','','',''],
  ['3701.06.04','Acero de refuerzo Fy=420 Mpa.',   'kg','','','','','','','',''],
  ['3701.07.04','Excavaciones varias sin clasicar ODL','m3','','','','','','','',''],
  ['3701.02.07','Terraplenes (solo conformación)', 'm3','','','','','','','','']
];
ctx.ss_=()=>({ getSheetByName:n=> n==='BASE' ? { getLastRow:()=>BASE.length,
  getDataRange:()=>({ getValues:()=>BASE }) } : null });

console.log('\n== Catálogo servido a los frontends (?action=drenajes) ==');
const cat=JSON.parse(vm.runInContext('drenajesCatalogo().getContent()', ctx));
const its=cat.items||[];
const de=a=>its.find(i=>i.cc==='3701.06.02' && (i.actividad||'')===a);
const CRUDO='Relleno con crudo de río', UF3='Relleno de UF3';
ok('el ítem normal 06.02 se sigue ofreciendo', !!de('') && de('').desc===ITEM);
ok('variante "'+CRUDO+'" ofrecida', !!de(CRUDO), JSON.stringify(de(CRUDO)));
ok('variante "'+UF3+'" ofrecida', !!de(UF3), JSON.stringify(de(UF3)));
ok('las variantes conservan el ítem contractual (misma DESCRIPCION)', de(CRUDO).desc===ITEM && de(UF3).desc===ITEM);
ok('  · mismo CC y mismo CC corto', de(CRUDO).cc==='3701.06.02' && de(CRUDO).corto==='06.02');
ok('  · misma unidad de la BASE', de(CRUDO).unidad==='m3' && de(UF3).unidad==='m3');
ok('  · área odt', de(CRUDO).area==='odt' && de(UF3).area==='odt');
ok('  · marcadas como variante', de(CRUDO).variante===true);
ok('los demás ítems NO ganan variantes', !its.some(i=>i.cc!=='3701.06.02' && i.actividad));
ok('el catálogo de tierras sigue fuera de drenajes', !its.some(i=>i.cc==='3701.02.07'));

console.log('\n== La fila que llega a DATA (A–T no cambia; la distinción es interna) ==');
const G={GRUPO:2,CC:3,CAPITULO:4,DESCRIPCION:5,UF:6,PROY:7,ELEM:8,ABSI:9,ABSF:10,UNI:13,LARGO:14,ACT:24,AREA:27};
function filaDe(actividad, marcador, id){
  ctx._l={ centro_costo:'3701.06.02', descripcion:ITEM, unidad:'m3', largo:35, elemento:marcador,
           pk_inicial:'', pk_final:'', area:'odt', grupo:'DRENAJES Y ESTRUCTURAS',
           capitulo:'DRENAJE TRANSVERSAL', actividad:actividad, observacion:'' };
  return vm.runInContext('buildDataRow(_l,"2026-08-03","ts","mauricio","capataz_odt",'+JSON.stringify(id)+')', ctx);
}
const fCrudo=filaDe(CRUDO,'ODT1-14+300','id1'), fNorm=filaDe(ITEM,'ODT1-14+300','id2');
ok('DESCRIPCION = el ítem contractual verbatim, NO el nombre de la variante', fCrudo[G.DESCRIPCION]===ITEM, String(fCrudo[G.DESCRIPCION]));
ok('GRUPO / CAPÍTULO de drenajes intactos', fCrudo[G.GRUPO]==='DRENAJES Y ESTRUCTURAS' && fCrudo[G.CAPITULO]==='DRENAJE TRANSVERSAL');
ok('CC 3701.06.02 · UF1 · ELEMENTO = el marcador ODT', fCrudo[G.CC]==='3701.06.02' && fCrudo[G.UF]==='UF1' && fCrudo[G.ELEM]==='ODT1-14+300');
ok('ABS = abscisa puntual del marcador', fCrudo[G.ABSI]===14300 && fCrudo[G.ABSF]===14300);
ok('columna interna actividad = "'+CRUDO+'"', fCrudo[G.ACT]===CRUDO, String(fCrudo[G.ACT]));
ok('columna interna area = odt', fCrudo[G.AREA]==='odt');
ok('A–T IDÉNTICA a la del ítem normal (el maestro no ve diferencia)',
   JSON.stringify(fCrudo.slice(0,20))===JSON.stringify(fNorm.slice(0,20)));
ok('  · y la interna `actividad` SÍ las distingue', fCrudo[G.ACT]!==fNorm[G.ACT]);
const f2=filaDe(UF3,'ODT3-34+500','id3');
ok('ODT en UF2: CC re-anclado a 3702.06.02 y DESCRIPCION verbatim', f2[G.CC]==='3702.06.02' && f2[G.UF]==='UF2' && f2[G.DESCRIPCION]===ITEM, f2[G.CC]);
ok('  · con su actividad "'+UF3+'"', f2[G.ACT]===UF3);

console.log('\n== reporte-drenajes.html (capataz) ==');
{
  const c=contexto(jsDe('reporte-drenajes.html'));
  c._eval('AREA="odt"; MULTI=false; AREAS=["odt"]; ITEMS='+JSON.stringify(its)+';');
  const n06=c._eval('itemsArea()').filter(i=>i.corto==='06.02');
  ok('el buscador ofrece las 3 opciones de 06.02 (ítem + 2 variantes)', n06.length===3, 'n='+n06.length);
  ok('la deduplicación no colapsa las variantes', new Set(n06.map(i=>i.actividad||'')).size===3);
  ok('nombreAct: variante → su nombre', c.nombreAct({desc:ITEM, actividad:CRUDO})===CRUDO);
  ok('nombreAct: ítem normal → la descripción de la BASE', c.nombreAct({desc:ITEM})===ITEM);
  const lbl=c.actLabel(n06.find(i=>i.actividad===CRUDO));
  ok('la etiqueta muestra la variante Y el ítem contractual', lbl.indexOf(CRUDO)===0 && lbl.indexOf(ITEM)>0, lbl);
  ok('se encuentra escribiendo "crudo"', lbl.toLowerCase().indexOf('crudo')>=0);
  ok('  · y escribiendo "06.02"', lbl.indexOf('06.02')>=0);
  ok('el ítem normal conserva su etiqueta de siempre', c.actLabel({desc:ITEM, corto:'06.02', unidad:'m3'})===ITEM+' — 06.02 [m3]');
}

console.log('\n== residente-drenajes.html (panel + WhatsApp) ==');
{
  const c=contexto(jsDe('residente-drenajes.html'));
  const L=(act,largo)=>({ actividad:act, descripcion:ITEM, unidad:'m3', largo:largo, _area:'odt', _inc:true,
                          elemento:'ODT1-14+300', centro_costo:'3701.06.02' });
  c._eval('AREAS=["odt"]; ITEMS='+JSON.stringify(its)+';');
  ok('itemsAddArea ofrece las 3 opciones de 06.02', c._eval('itemsAddArea()').filter(i=>i.corto==='06.02').length===3);
  ok('la etiqueta del desplegable trae variante + ítem', c.actOpt({desc:ITEM, actividad:CRUDO, unidad:'m3'})===CRUDO+' · '+ITEM+' [m3]');
  const S=c._eval('STATE');
  S.cantidades=[ L(ITEM,20), L(CRUDO,30), L(UF3,15), L(ITEM,10) ];
  const r=c.calcTotalesArea('odt');
  ok('el panel separa las variantes del ítem normal (3 grupos)', r.order.length===3, JSON.stringify(r.order));
  ok('  · el ítem normal suma 30 (20+10)', r.t[ITEM+'||m3'].total===30, String((r.t[ITEM+'||m3']||{}).total));
  ok('  · el crudo de río va aparte con 30', r.t[CRUDO+'||m3'].total===30);
  ok('  · el de UF3 aparte con 15', r.t[UF3+'||m3'].total===15);
  // Retrocompatibilidad: lo ya reportado guardaba actividad = descripcion = ítem de la BASE, y hay
  // payloads donde `actividad` pudo llegar vacía — los dos casos tienen que verse como antes.
  S.cantidades=[ {actividad:ITEM, descripcion:ITEM, unidad:'m3', largo:50, _area:'odt', _inc:true},
                 {actividad:'',   descripcion:ITEM, unidad:'m3', largo:25, _area:'odt', _inc:true} ];
  const r2=c.calcTotalesArea('odt');
  ok('lo reportado antes del cambio se sigue viendo igual (un solo grupo, 75)',
     r2.order.length===1 && r2.t[ITEM+'||m3'].total===75, JSON.stringify(r2.order));
}

console.log('\n== jefe.html — el desglose por actividad (D113) las separa ==');
{
  const c=contexto(jsDe('jefe.html'));
  const chk={checked:false}; c._els['fDesglose']=chk;
  const fila=(largo,act)=>{ const r=new Array(20).fill(''); r[0]='2026-08-03'; r[3]='3701.06.02'; r[5]=ITEM;
    r[6]='UF1'; r[8]='ODT1-14+300'; r[9]=14300; r[10]=14300; r[13]='m3'; r[14]=largo; r.push(act); return r; };
  const filas=[fila(20,ITEM), fila(30,CRUDO), fila(15,UF3)];
  const S=c._eval('STATE');
  S.filas=filas; S.cols={FECHA:0,GRUPO:2,CC:3,DESCRIPCION:5,UF:6,ELEMENTO:8,ABS_INI:9,ABS_FIN:10,UNIDAD:13,LARGO:14,ACTIVIDAD:20,COPY_END:15};
  const apagado=c.resumenActividades(filas);
  ok('APAGADO: una sola línea de 65 m³ (la vista de hoy)', apagado.length===1 && apagado[0].unidades['m3']===65);
  chk.checked=true;
  const r=c.resumenActividades(filas);
  ok('ENCENDIDO: 3 grupos', r.length===3, JSON.stringify(r.map(x=>x.actividad)));
  ok('  · "'+CRUDO+'" con 30 m³', (r.find(x=>x.actividad===CRUDO)||{unidades:{}}).unidades['m3']===30);
  ok('  · "'+UF3+'" con 15 m³', (r.find(x=>x.actividad===UF3)||{unidades:{}}).unidades['m3']===15);
  ok('  · el ítem normal con 20 m³', (r.find(x=>x.actividad===ITEM)||{unidades:{}}).unidades['m3']===20);
}

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

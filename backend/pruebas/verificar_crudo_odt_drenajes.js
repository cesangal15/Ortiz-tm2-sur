#!/usr/bin/env node
/**
 * Verificación — "crudo ODT" (CC `37xx.06.02`) en el reporte de DRENAJES (D113b).
 *
 * Pregunta que responde: ¿hace falta código para distinguir el crudo de río en las ODT? **No.** El
 * catálogo de drenajes es VIVO desde la hoja BASE (D70): `?action=drenajes` sirve TODOS los ítems
 * `.06.*` (ODT) y `.07.*` (ODL) de la tabla de ítems, con su descripción y su unidad verbatim. Una
 * fila nueva en la BASE aparece sola en `reporte-drenajes.html`, sin desplegar nada.
 *
 * Este arnés lo comprueba sobre el código real, simulando una BASE que tiene **DOS ítems bajo el mismo
 * CC 06.02** (el que ya existía y el nuevo "crudo ODT") — que es el único punto donde algo podía salir
 * mal: `lookupDescripcion` (D68) tiene que devolver el ítem REPORTADO y no el primero de la hoja, o la
 * distinción se perdería justo al escribir DATA. Recorre la cadena entera: catálogo servido →
 * `buildDataRow` → fila de DATA (GRUPO/CAPÍTULO/ELEMENTO/ABS/CC/área), incluida una ODT en UF2, donde
 * el CC se re-ancla a 3702 y la descripción tiene que resolverse por la llave corta.
 *
 *   node backend/pruebas/verificar_crudo_odt_drenajes.js
 */
const fs=require('fs'), vm=require('vm');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){fallos++; console.log('  ✗ '+n+(x?'  → '+x:''));} else console.log('  ✓ '+n); }

const path=require('path');
const src=fs.readFileSync(path.resolve(__dirname,'..','Codigo.gs'),'utf8');
const ctx={console, Logger:{log(){}}, Utilities:{}, SpreadsheetApp:{}};
// ContentService de Apps Script: aquí solo hace falta que devuelva el texto para poder leerlo.
ctx.ContentService={ MimeType:{JSON:'json'}, createTextOutput:t=>({ _t:t, setMimeType(){return this;}, getContent(){return this._t;} }) };
vm.createContext(ctx); vm.runInContext(src, ctx);

// --- BASE simulada: tabla de ítems en A–C y tabla de elementos en J/K/L ---
// OJO: 06.02 lleva DOS ítems (el que ya existía y el nuevo "crudo ODT") — es el caso interesante.
const BASE=[
  ['CENTRO DE COSTO','DESCRIPCION','UND','','','','','','','','',''],
  ['3701.06.01','Excavaciones varias sin clasicar','M3','','','','','','','ODT1-14+300',14300,14300],
  ['','','','','','','','','','ODT3-34+500',34500,34500],
  ['3701.06.02','Concreto clase D para estructuras','M3','','','','','','','',''],
  ['3701.06.02','crudo ODT','M3','','','','','','','',''],
  ['3701.07.04','Excavaciones varias sin clasicar ODL','M3','','','','','','','',''],
  ['3701.02.07','Terraplenes (solo conformación)','M3','','','','','','','','']
];
ctx.ss_=()=>({ getSheetByName:n=> n==='BASE' ? {
  getLastRow:()=>BASE.length, getDataRange:()=>({ getValues:()=>BASE }) } : null });

console.log('\n== ¿Sale "crudo ODT" en el catálogo de drenajes, sin tocar código? ==');
const cat=JSON.parse(vm.runInContext('drenajesCatalogo().getContent()', ctx));
const its=cat.items||[];
const et=(cc,d)=>its.find(i=>i.cc===cc && i.desc===d);
ok('el catálogo se sirve sin error', cat.ok===true);
ok('"crudo ODT" (3701.06.02) SE OFRECE, área odt', !!et('3701.06.02','crudo ODT') && et('3701.06.02','crudo ODT').area==='odt', JSON.stringify(et('3701.06.02','crudo ODT')));
ok('  · con su unidad verbatim de la BASE', (et('3701.06.02','crudo ODT')||{}).unidad==='M3');
ok('  · y CC corto 06.02 para el buscador', (et('3701.06.02','crudo ODT')||{}).corto==='06.02');
ok('el OTRO ítem de 06.02 sigue ofreciéndose aparte (la distinción existe)', !!et('3701.06.02','Concreto clase D para estructuras'));
ok('los ítems ODL (.07) siguen ahí', !!et('3701.07.04','Excavaciones varias sin clasicar ODL'));
ok('el terraplén de tierras (02.07) NO entra al catálogo de drenajes', !its.some(i=>i.cc==='3701.02.07'));
ok('el marcador ODT del BASE se sirve', (cat.marcadores||[]).some(m=>m.elemento==='ODT1-14+300'));

console.log('\n== Desempate de DESCRIPCION con DOS ítems bajo el mismo CC (D68) ==');
const LD=(cc,d)=>vm.runInContext('lookupDescripcion('+JSON.stringify(cc)+','+JSON.stringify(d)+')', ctx);
ok('reportar "crudo ODT" conserva "crudo ODT"', LD('3701.06.02','crudo ODT')==='crudo ODT', LD('3701.06.02','crudo ODT'));
ok('reportar el otro ítem conserva el otro', LD('3701.06.02','Concreto clase D para estructuras')==='Concreto clase D para estructuras', LD('3701.06.02','Concreto clase D para estructuras'));

console.log('\n== La fila que llega a DATA ==');
ok('deriveArea("3701.06.02") = odt', vm.runInContext('deriveArea("3701.06.02")', ctx)==='odt');
ctx._linea={ centro_costo:'3701.06.02', descripcion:'crudo ODT', unidad:'M3', largo:35,
             elemento:'ODT1-14+300', pk_inicial:'', pk_final:'', area:'', grupo:'', capitulo:'',
             actividad:'crudo ODT', observacion:'' };
const fila=vm.runInContext('buildDataRow(_linea, "2026-08-03", "ts", "mauricio", "capataz_odt", "id1")', ctx);
const G={FECHA:0,GRUPO:2,CC:3,CAPITULO:4,DESCRIPCION:5,UF:6,PROY:7,ELEM:8,ABSI:9,ABSF:10,UNI:13,LARGO:14,ACT:24,AREA:27};
ok('GRUPO = DRENAJES Y ESTRUCTURAS', fila[G.GRUPO]==='DRENAJES Y ESTRUCTURAS', String(fila[G.GRUPO]));
ok('CAPITULO = DRENAJE TRANSVERSAL', fila[G.CAPITULO]==='DRENAJE TRANSVERSAL', String(fila[G.CAPITULO]));
ok('DESCRIPCION verbatim = "crudo ODT"', fila[G.DESCRIPCION]==='crudo ODT', String(fila[G.DESCRIPCION]));
ok('CC = 3701.06.02', fila[G.CC]==='3701.06.02', String(fila[G.CC]));
ok('ELEMENTO = el marcador ODT elegido', fila[G.ELEM]==='ODT1-14+300', String(fila[G.ELEM]));
ok('ABS INI/FIN = abscisa puntual del marcador', fila[G.ABSI]===14300 && fila[G.ABSF]===14300, fila[G.ABSI]+'/'+fila[G.ABSF]);
ok('UF/PROYECTO derivados del marcador (14+300 → UF1/3701)', fila[G.UF]==='UF1' && fila[G.PROY]==='3701');
ok('cantidad directa (35 M3)', fila[G.LARGO]===35 && fila[G.UNI]==='M3');
ok('columna interna area = odt (pisado por día+área)', fila[G.AREA]==='odt', String(fila[G.AREA]));
ok('columna interna actividad = "crudo ODT" (desglose del jefe, D113)', fila[G.ACT]==='crudo ODT', String(fila[G.ACT]));

// Una ODT más allá de 30+000: el CC se re-ancla a 3702, que NO tiene fila propia en la BASE. La
// descripción debe seguir saliendo verbatim por la llave CORTA (06.02), no caer al ítem equivocado.
ctx._linea2={ centro_costo:'3701.06.02', descripcion:'crudo ODT', unidad:'M3', largo:12,
              elemento:'ODT3-34+500', pk_inicial:'', pk_final:'', area:'', grupo:'', capitulo:'',
              actividad:'crudo ODT', observacion:'' };
const f2=vm.runInContext('buildDataRow(_linea2, "2026-08-03", "ts", "mauricio", "capataz_odt", "id2")', ctx);
ok('ODT en UF2: CC re-anclado a 3702.06.02', f2[G.CC]==='3702.06.02' && f2[G.UF]==='UF2', f2[G.CC]+' '+f2[G.UF]);
ok('  · DESCRIPCION sigue verbatim "crudo ODT" (llave corta)', f2[G.DESCRIPCION]==='crudo ODT', String(f2[G.DESCRIPCION]));
ok('  · sigue siendo área odt', f2[G.AREA]==='odt');

console.log('\n'+(fallos? '✗ '+fallos+' fallo(s) de '+casos : '✓ '+casos+' comprobaciones OK'));
process.exit(fallos?1:0);

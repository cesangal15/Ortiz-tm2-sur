/**
 * Verificación — conciliador de actas, bloque 1b (pendientes de digitación):
 * el CC propuesto se lee del MATERIAL aunque la hoja no sea de granulares.
 *
 * Bug corregido (ago-2026): la regla de material se buscaba SOLO en la lista del
 * ámbito de la hoja. Como la lista de TERRAPLEN tiene una única regla COMODÍN
 * (patrón vacío, matchea cualquier texto), toda hoja que no fuera GRANULARES
 * —incluidas las AMBAS, las de nombre de mes, que por definición mezclan los dos—
 * proponía el sufijo del terraplén `.02.11` para CUALQUIER material. Una remisión
 * de SUB BASE de Putana salía como `3702.02.11` en vez de `3702.03.02`, y la col. G
 * quedaba con el texto crudo de la proforma en vez del nombre de la BASE ("Sub base").
 *
 * Correr:  node backend/pruebas/verificar_conciliador_pendientes_material.js
 */
'use strict';
const path=require('path');
const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,configSeed,propuestaPendiente,materialBasePendiente,ambitoPendiente,derivadosProforma}=C;

S.config=configSeed();
// bases mínimas: solo se usan para el catálogo de respaldo y la unidad de la col. R
S.bases.GRANULARES={rows:[{cc:'3701.03.02',unidad:'m3/km'},{cc:'3701.03.02',unidad:'m3/km'}]};
S.bases.TERRAPLEN={rows:[{cc:'3701.02.11',unidad:'m3km'}]};

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};
// hoja 'AGOSTO 2026' = el caso real: nombre de mes → ámbito AMBAS
const rc=(ambito,material,destino)=>({ambito,obs:'',hoja:'AGOSTO 2026',
  secundarios:{origen:'PUTANA',destino:destino||'35.35',material,cantidad:12}});

console.log('\n1) Hoja AMBAS (nombre de mes) — las filas del reporte del usuario');
chk('SUB BASE, PUTANA → 35.35', propuestaPendiente(rc('AMBAS','SUB BASE','35.35')).cc, '3702.03.02');
chk('SUB BASE, PUTANA → 25.5',  propuestaPendiente(rc('AMBAS','SUB BASE','25.5')).cc,  '3701.03.02');
chk('col. G = como escribe la BASE', materialBasePendiente(rc('AMBAS','SUB BASE')), 'Sub base');
chk('unidad de la base de granulares', derivadosProforma(rc('AMBAS','SUB BASE')).unidad, 'm3/km');
chk('ámbito efectivo', ambitoPendiente(rc('AMBAS','SUB BASE')), 'GRANULARES');

console.log('\n2) Las demás variantes de material, en las tres clases de hoja');
for(const amb of ['GRANULARES','TERRAPLEN','AMBAS']){
  chk(amb+' · SUB BASE', propuestaPendiente(rc(amb,'SUB BASE')).cc, '3702.03.02');
  chk(amb+' · SUB-BASE', propuestaPendiente(rc(amb,'SUB-BASE')).cc, '3702.03.02');
  chk(amb+' · SUBBASE',  propuestaPendiente(rc(amb,'SUBBASE')).cc,  '3702.03.02');
  chk(amb+' · BTC',      propuestaPendiente(rc(amb,'BTC')).cc,      '3702.03.04');
  chk(amb+' · CRUDO DE RIO', propuestaPendiente(rc(amb,'CRUDO DE RIO')).cc, '3702.02.11');
}

console.log('\n3) El terraplén no cambia: sin material granular sigue mandando el comodín');
chk('TERRAPLEN · MATERIAL DE CORTE', propuestaPendiente(rc('TERRAPLEN','MATERIAL DE CORTE')).cc, '3702.02.11');
chk('TERRAPLEN · sin material',      propuestaPendiente(rc('TERRAPLEN','')).cc,                  '3702.02.11');
chk('AMBAS · MATERIAL DE CORTE',     propuestaPendiente(rc('AMBAS','MATERIAL DE CORTE')).cc,     '3702.02.11');
chk('TERRAPLEN · ámbito efectivo',   ambitoPendiente(rc('TERRAPLEN','MATERIAL DE CORTE')),       'TERRAPLEN');
chk('TERRAPLEN · unidad',            derivadosProforma(rc('TERRAPLEN','')).unidad,               'm3km');

console.log('\n4) El nombre de la HOJA no puede hacer de material en hojas con ámbito propio');
// una hoja de terraplén llamada "…BASE…" mandaría todas sus filas sin material a .03.04
const hojaBase={ambito:'TERRAPLEN',obs:'',hoja:'TERRAPLEN BASE 2026',
  secundarios:{origen:'19+800',destino:'33+500',material:''}};
chk('hoja "TERRAPLEN BASE 2026", fila sin material', propuestaPendiente(hojaBase).cc, '3702.02.11');

console.log('\n5) El área observada del destino sigue mandando sobre el material');
chk('SUB BASE → PUENTE', propuestaPendiente(rc('AMBAS','SUB BASE','PUENTE 33+400')), {area:'PUENTE',cc:C.CC_AREA_AJENA});

console.log(fallos?('\n❌ '+fallos+' comprobación(es) fallaron\n'):'\n✅ Todo correcto\n');
process.exit(fallos?1:0);

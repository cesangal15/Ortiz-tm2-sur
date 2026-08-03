/**
 * Verificación — conciliador de actas, bloque 1b (pendientes de digitación).
 *
 * Bug corregido (ago-2026): el ORIGEN de la proforma entraba al escaneo de "áreas
 * observadas". Como el origen es siempre el sitio de CARGUE y la proforma lo escribe
 * "PLANTA" a secas, la palabra disparaba área ajena y proponía el CC fijo 3701.11.03
 * en filas que son NUESTRAS. Ahora el área se lee SOLO del destino/observación.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_pendientes_area.js
 */
'use strict';
const path=require('path');
const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,configSeed,propuestaPendiente,CC_AREA_AJENA}=C;

S.config=configSeed();
// base mínima para ccCatalogo(): solo se usa cuando falta PK o material
S.bases.GRANULARES={rows:[{cc:'3701.03.02',unidad:'m3/km'},{cc:'3701.03.02',unidad:'m3/km'},{cc:'3701.11.03',unidad:'m3/km'}]};
S.bases.TERRAPLEN={rows:[{cc:'3701.02.11',unidad:'m3km'}]};

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};
const rc=(ambito,origen,destino,material,obs)=>({ambito,obs:obs||'',secundarios:{origen,destino,material}});

console.log('\n1) Origen PLANTA (el cargue de Putana) — las 14 filas del reporte del usuario');
// CRUDO DE RIO · PLANTA → 25+700  ⇒ nuestra, prefijo 3701 (PK 25 ≤ 30) + sufijo crudo .02.11
chk('crudo, PLANTA → 25+700',   propuestaPendiente(rc('GRANULARES','PLANTA','25+700','CRUDO DE RIO')), {area:'',cc:'3701.02.11'});
chk('sub base, PLANTA → 37+000',propuestaPendiente(rc('GRANULARES','PLANTA','37+000','SUB BASE')),     {area:'',cc:'3702.03.02'});
chk('sub base, PLANTA → 26+500',propuestaPendiente(rc('GRANULARES','PLANTA','26+500','SUB BASE')),     {area:'',cc:'3701.03.02'});
chk('sub base, PLANTA → 39+200',propuestaPendiente(rc('GRANULARES','PLANTA','39+200','SUB BASE')),     {area:'',cc:'3702.03.02'});
chk('BTC, PLANTA PUTANA → 12+000',propuestaPendiente(rc('GRANULARES','PLANTA PUTANA','12+000','BTC')), {area:'',cc:'3701.03.04'});

console.log('\n2) El área SÍ se sigue leyendo del destino y de la observación');
chk('destino PUENTE',        propuestaPendiente(rc('GRANULARES','PLANTA','PUENTE 33+400','SUB BASE')), {area:'PUENTE',cc:CC_AREA_AJENA});
chk('destino TM1',           propuestaPendiente(rc('GRANULARES','PLANTA','TM1','SUB BASE')),           {area:'TM1',cc:CC_AREA_AJENA});
chk('obs "material para AMP"',propuestaPendiente(rc('GRANULARES','PLANTA','26+500','SUB BASE','material para AMP')), {area:'AMP',cc:CC_AREA_AJENA});
chk('destino RCD',           propuestaPendiente(rc('TERRAPLEN','19+800','RCD','')),                    {area:'RCD',cc:CC_AREA_AJENA});

console.log('\n3) Terraplén: el origen es una abscisa, no debe cambiar nada');
chk('terraplén 19+800 → 22+300',propuestaPendiente(rc('TERRAPLEN','19+800','22+300','')),              {area:'',cc:'3701.02.11'});
chk('terraplén 19+800 → 33+500',propuestaPendiente(rc('TERRAPLEN','19+800','33+500','')),              {area:'',cc:'3702.02.11'});

console.log('\n4) Casos borde: sin PK y sin material');
chk('sin PK, con material',  propuestaPendiente(rc('GRANULARES','PLANTA','','SUB BASE')),              {area:'',cc:'3701.03.02'});
chk('sin PK ni material',    propuestaPendiente(rc('GRANULARES','PLANTA','','')),                      {area:'',cc:'3701.03.02'});

console.log(fallos?('\n❌ '+fallos+' comprobación(es) fallaron\n'):'\n✅ Todo correcto\n');
process.exit(fallos?1:0);

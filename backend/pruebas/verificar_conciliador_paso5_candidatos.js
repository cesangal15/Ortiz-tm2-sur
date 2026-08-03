/**
 * Verificación — conciliador de actas, Paso 5 (investigación PDF).
 *
 * Bug corregido (ago-2026): al seleccionar una faltante, el candidato EXACTO salía
 * "como el renglón solo", sin la página del PDF. Dos causas, las dos de compartir
 * el mismo nodo <canvas> del caché:
 *   (a) una misma página podía entrar DOS veces como candidata de la misma faltante
 *       (el OCR leía el número exacto y, de otro parte de la hoja, uno a un dígito);
 *       insertar el canvas cacheado en el segundo renglón lo MOVÍA fuera del primero
 *       —el exacto, que va arriba—, que quedaba sin página;
 *   (b) un render en vuelo podía robarle el canvas al panel recién pintado.
 * Fix: `_candsDe` deja una fila por página (mejor nivel, todas las lecturas) y
 * `pagDom` entrega SIEMPRE una copia del canvas; el maestro se queda en el caché.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_paso5_candidatos.js
 */
'use strict';
const path=require('path');
const C=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));
const {S,Paso5}=C;

let fallos=0;
const chk=(nombre,ok,detalle)=>{
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+(detalle!==undefined?'  → '+JSON.stringify(detalle):''));
};

const cand=(file,page,token,nivel)=>({key:file+'#'+page,file,fileIdx:0,page,token,nivel});

console.log('\n1) Una fila por página (el exacto y el ≈ de la misma hoja se fusionan)');
S.ocr.candidatos={'25927':[cand('A.pdf',5,'25927','verde'),cand('A.pdf',5,'25921','naranja'),cand('B.pdf',2,'25937','naranja')]};
S.ocr.descartados={};
let out=Paso5._candsDe({remision:'25927'});
chk('quedan 2 renglones, no 3',out.length===2,out.map(c=>c.key+' '+c.nivel));
chk('el exacto va primero',out[0].key==='A.pdf#5'&&out[0].nivel==='verde');
chk('conserva las dos lecturas de la página',JSON.stringify(out[0].tokens)===JSON.stringify(['25927','25921']),out[0].tokens);
chk('la otra página sigue apareciendo',out[1].key==='B.pdf#2'&&out[1].nivel==='naranja');

console.log('\n2) Da igual el orden en que el OCR haya cruzado los tokens');
S.ocr.candidatos={'25927':[cand('A.pdf',5,'25921','naranja'),cand('A.pdf',5,'25927','verde')]};
out=Paso5._candsDe({remision:'25927'});
chk('un solo renglón',out.length===1,out.map(c=>c.key));
chk('el nivel se eleva a verde',out[0].nivel==='verde'&&out[0].token==='25927');

console.log('\n3) "No es" (descartados) sigue filtrando por página');
S.ocr.candidatos={'25927':[cand('A.pdf',5,'25927','verde'),cand('B.pdf',2,'25937','naranja')]};
S.ocr.descartados={'25927|A.pdf#5':true};
out=Paso5._candsDe({remision:'25927'});
chk('solo queda la no descartada',out.length===1&&out[0].key==='B.pdf#2',out.map(c=>c.key));
chk('el índice de "No es" apunta a la misma fila que se pintó',Paso5._candsDe({remision:'25927'})[0].key===out[0].key);

console.log('\n4) Sin candidatos / faltante desconocida');
S.ocr.descartados={};
chk('remisión sin candidatos → lista vacía',Paso5._candsDe({remision:'99999'}).length===0);

console.log('\n5) pagDom entrega una COPIA: dos renglones nunca comparten el mismo nodo');
const fakeCanvas=()=>({width:0,height:0,_ctx:{drawImage(){}},getContext(){return this._ctx;}});
global.document={createElement:()=>fakeCanvas()};
const maestro=fakeCanvas(); maestro.width=800; maestro.height=1100;
Paso5.renderPagina=async()=>maestro;   // simula el caché de páginas
(async()=>{
  const a=await Paso5.pagDom(0,5,1.4);
  const b=await Paso5.pagDom(0,5,1.4);
  chk('cada llamada devuelve un nodo distinto',a!==b&&a!==maestro&&b!==maestro);
  chk('la copia conserva el tamaño',a.width===800&&a.height===1100,[a.width,a.height]);
  Paso5.renderPagina=async()=>null;
  chk('página que no se puede renderizar → null',(await Paso5.pagDom(0,9,1.4))===null);
  console.log(fallos?('\n❌ '+fallos+' comprobación(es) fallaron\n'):'\n✅ Todo correcto\n');
  process.exit(fallos?1:0);
})();

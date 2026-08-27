/**
 * Verificación — conciliador de actas, Paso 5 (OCR): partes del formato NUEVO de PUTANA.
 *
 * Motivo (ago-2026, con fotos del dueño). Los granulares de PUTANA pasan a llegar como TIQUETE
 * DE BÁSCULA impreso en matricial: todo monoespaciado, gris, del mismo cuerpo, y fotografiado con
 * el móvil. La remisión es el campo `COPIA DE TIQUETE NUMERO:8.650` del encabezado.
 *
 * Eso tumba las DOS suposiciones del lector viejo y añade una trampa:
 *   1. No hay color que aislar — `umbralRojo` mide r − max(g,b), que en gris es ≈ 0, así que la
 *      pasada A no llamaba al OCR ni una vez.
 *   2. El número NO es grande ni está arriba a la derecha: es un campo de texto más.
 *   3. Viene con SEPARADOR DE MILES, así que el `\d{3,6}` de siempre lee `8` y `650` y jamás
 *      produce `8650`, por bien que el OCR haya leído la hoja.
 *
 * Lo que este formato sí tiene es ESTRUCTURA: el número lleva su rótulo delante. Por eso se lee
 * ANCLADO al rótulo — que además es lo único que lo distingue de los otros ocho números de la
 * hoja (NIT, teléfono, los tres pesos, placa, PK, volumen), varios de ellos a un dígito de una
 * remisión de cuatro cifras.
 *
 * Medido con tesseract 5.3.4 sobre réplicas degradadas de las dos fotos reales (rampa de luz,
 * sombra de la mano, desenfoque y JPEG), a 1000 y 1400 px de ancho:
 *   - pasada C (esta): la remisión en 4 de 4, en VERDE, con UN token por página.
 *   - pasada B (la de hoy): 13 tokens de basura por página; con la proforma escribiendo `8.650`
 *     no la encuentra NUNCA, y en un caso da un VERDE FALSO — `12.630` es el peso de entrada del
 *     tiquete, no una remisión.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_ocr_tiquete.js
 */
'use strict';
const path=require('path');
const {numeroRemision,sinMiles,tokensTiquete,tokensNumericos,binarizaAdaptativa,oscuridadPx,
       sinCeros,dist1}=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};

console.log('\n1) `numeroRemision` — el punto es de MILES, la coma es decimal');
chk('8.650 (el caso de la foto)', numeroRemision('8.650'), '8650');
chk('8.642 (la otra foto)', numeroRemision('8.642'), '8642');
chk('sin separador, igual', numeroRemision('8650'), '8650');
chk('26.650,00 kg → se corta la parte decimal', numeroRemision('26.650,00'), '26650');
chk('el OCR mete un espacio: 8 .642', numeroRemision('8 .642'), '8642');
chk('ceros a la izquierda se conservan (0348 vive)', numeroRemision('0348'), '0348');
chk('el NIT no es una remisión (9 cifras)', numeroRemision('900.356.846'), '');
chk('el teléfono tampoco (10 cifras)', numeroRemision('3132404053'), '');
chk('dos cifras no alcanzan', numeroRemision('12'), '');
chk('vacío', numeroRemision(''), '');

console.log('\n2) `sinMiles` — quita el separador de miles y SOLO eso');
chk('8.650 → 8650', sinMiles('8.650'), '8650');
chk('1.234.567', sinMiles('1.234.567'), '1234567');
chk('CH6199 intacta (D: la remisión es texto literal)', sinMiles('CH6199'), 'CH6199');
chk('0348 intacta (los ceros son parte del número)', sinMiles('0348'), '0348');
chk('8650 intacta', sinMiles('8650'), '8650');
chk('26.650,00 NO es patrón de miles limpio → intacta', sinMiles('26.650,00'), '26.650,00');

console.log('\n3) `tokensTiquete` — anclado al rótulo, tolerante al OCR sucio');
chk('línea limpia', tokensTiquete('COPIA DE TIQUETE NUMERO:8.650'), ['8650']);
chk('Q leída como 0', tokensTiquete('COPIA DE TI0UETE NUMERO:8.642'), ['8642']);
chk('I leída como 1 y T como 7', tokensTiquete('C0PIA DE T1QUE7E NUMERO :8.642'), ['8642']);
chk('espacio colado por el OCR', tokensTiquete('COPIA DE TIQUETE NUMERO:8 .642'), ['8642']);
chk('variante NRO.', tokensTiquete('TIQUETE NRO. 8.650'), ['8650']);
chk('sin rótulo intermedio', tokensTiquete('TIQUETE 8650'), ['8650']);
chk('dos tiquetes en la misma hoja', tokensTiquete('TIQUETE NUMERO:8.642 ... TIQUETE NUMERO:8.650'), ['8642','8650']);

console.log('\n4) …y NO se lleva los otros ocho números de la hoja');
const HOJA=[
  'Ortiz Construcciones y Proyectos S.A','NIT :900.356.846-7','TELEFONO:3132404053',
  'DIRECCION:Betulia','COPIA DE TIQUETE NUMERO:8.650',
  'ENTRADA : 27/ago/2026 06:07:00 a. m 12.630,00',
  'SALIDA : 27/ago/2026 07:20:00 a. m 39.280,00 26.650,00 Kilogramos',
  'PRODUCTO : BASE TRATADA CON CEMENTO   CODIGO : 12',
  'PLACA : NNM 208','DESTINO : PK36+850','OBSERVACIONES : VOLUMEN.14,99M3'].join('\n');
chk('la hoja entera da UN solo token: la remisión', tokensTiquete(HOJA), ['8650']);
const sueltos=tokensNumericos(HOJA);
chk('la pasada de respaldo, en cambio, da un montón', sueltos.length>8, true);
chk('…incluido el peso de entrada 12630, que NO es una remisión', sueltos.indexOf('12630')>=0, true);
chk('sin ancla no se inventa nada', tokensTiquete('UNA HOJA CUALQUIERA 8650'), []);

console.log('\n5) `tokensNumericos` — el separador de miles en las pasadas de respaldo');
chk('el \\d{3,6} de siempre parte 8.650 en 8 y 650', ('8.650'.match(/\d{3,6}/g)||[]), ['650']);
chk('con la corrección sale también 8650', tokensNumericos('8.650').indexOf('8650')>=0, true);

console.log('\n6) Cruce con las faltantes (misma regla que `_cruzar`)');
const nivel=(tk,rem)=>{
  const remSC=sinCeros(rem);
  if(tk===rem||sinCeros(tk)===remSC||sinMiles(tk)===sinMiles(rem)) return 'verde';
  if(dist1(tk,rem)<=1) return 'naranja';
  return null;
};
chk('proforma 8650 · tiquete 8650', nivel('8650','8650'), 'verde');
chk('proforma 8.650 (con punto) · tiquete 8650 → VERDE, no naranja', nivel('8650','8.650'), 'verde');
chk('proforma 8650 · tiquete 8.650', nivel('8.650','8650'), 'verde');
chk('una vecina a un dígito sigue siendo naranja', nivel('8650','8651'), 'naranja');
chk('CH6199 no se ve afectada', nivel('CH6199','CH6199'), 'verde');
chk('0348 vs 348 → verde POR LA REGLA DE CEROS que ya existía, no por sinMiles', nivel('0348','348'), 'verde');
chk('…y sinMiles por su cuenta NO los colapsa', sinMiles('0348')===sinMiles('348'), false);

console.log('\n7) `binarizaAdaptativa` — la media LOCAL salva la mitad en sombra');
// Franja con rampa de luz: papel de 240 a 90 (la sombra de la mano al fotografiar el parte).
// La tinta va siempre al 60% de su fondo, así que su contraste RELATIVO es constante.
function conRampa(w,h,marcas){
  const d=new Uint8ClampedArray(w*h*4);
  const fondo=(x)=>Math.round(240-150*(x/w));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const i=(y*w+x)*4; const v=fondo(x);
    d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
  }
  for(const m of marcas) for(let y=m.y;y<m.y+m.h;y++) for(let x=m.x;x<m.x+m.w;x++){
    const i=(y*w+x)*4; const v=Math.round(fondo(x)*0.6);
    d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
  }
  return d;
}
const W=240,H=80;
const marcas=[{x:20,y:30,w:10,h:20},{x:60,y:30,w:10,h:20},   // en la zona iluminada
              {x:170,y:30,w:10,h:20},{x:210,y:30,w:10,h:20}]; // en la zona en sombra
const d=conRampa(W,H,marcas);
const esMarca=(x,y)=>marcas.some(m=>x>=m.x&&x<m.x+m.w&&y>=m.y&&y<m.y+m.h);
// Umbral GLOBAL, el enfoque que se descartó: cualquier corte fijo sobre la oscuridad.
function global(d,w,h,T){
  let dentro=0,fuera=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const on=oscuridadPx(d,(y*w+x)*4)>=T;
    if(on){ if(esMarca(x,y)) dentro++; else fuera++; }
  }
  return {dentro,fuera};
}
const pxMarca=marcas.reduce((a,m)=>a+m.w*m.h,0);
// Con el corte puesto para ver la tinta iluminada, el papel en sombra entra entero.
const gris=Math.round(240*0.6);                    // la tinta de la zona MÁS iluminada
const g=global(d,W,H,oscuridadPx([gris,gris,gris,255],0));
chk('umbral global: arrastra papel de la sombra', g.fuera>1000, true);
const mask=binarizaAdaptativa(d,W,H);
let dentro=0,fuera=0;
for(let y=0;y<H;y++) for(let x=0;x<W;x++){ if(mask[y*W+x]){ esMarca(x,y)?dentro++:fuera++; } }
chk('adaptativo: coge las 4 marcas, iluminadas y en sombra', dentro>pxMarca*0.6, true);
chk('adaptativo: casi no arrastra papel', fuera<pxMarca*0.5, true);
const enSombra=marcas.slice(2).reduce((a,m)=>{
  for(let y=m.y;y<m.y+m.h;y++) for(let x=m.x;x<m.x+m.w;x++) if(mask[y*W+x]) a++;
  return a;},0);
chk('las marcas de la zona oscura NO se pierden', enSombra>0, true);

console.log('\n8) El render del OCR pide la intención de IMPRESIÓN (si no, se para con la pestaña oculta)');
/* pdf.js agenda el dibujo con requestAnimationFrame cuando la intención es la de PANTALLA
   (`useRequestAnimationFrame: !intentPrint`), desde el PRIMER trozo. Un navegador no dispara rAF
   en una pestaña oculta, así que `page.render().promise` no resuelve nunca y el bucle del OCR se
   queda colgado en el `await`: no lento, PARADO. Comprobado con pdf.js 3.11.174 (la versión
   fijada) simulando la pestaña oculta —rAF existe pero su callback jamás se llama—: con la
   intención por defecto se cuelga tras pedir 1 rAF; con `intent:'print'` resuelve pidiendo 0.
   Esto no se puede verificar sin navegador, así que se vigila en el CÓDIGO: quitar el flag es
   una regresión que nadie notaría hasta minimizar la ventana en mitad de un corte. */
const fuente=require('fs').readFileSync(
  path.join(__dirname,'..','..','conciliador','conciliador.js'),'utf8');
chk("el bucle del OCR llama a renderPagina con paraOcr", /renderPagina\(fi,pg,2\.0,true\)/.test(fuente), true);
chk("…y paraOcr pone intent:'print'", /if\(paraOcr\)\s*par\.intent='print';/.test(fuente), true);
chk('la intención entra en la clave del caché (no se pisan las dos)', /paraOcr\?'p':'d'/.test(fuente), true);
chk('las páginas que se MUESTRAN siguen con la intención de pantalla', /pagDom\(fi,c\.page,1\.4\)/.test(fuente)&&!/pagDom\([^)]*,true\)/.test(fuente), true);

console.log('\n'+(fallos?('❌ '+fallos+' verificación(es) fallaron'):'✅ Todo correcto'));
process.exit(fallos?1:0);

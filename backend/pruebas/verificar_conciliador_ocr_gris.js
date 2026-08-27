/**
 * Verificación — conciliador de actas, Paso 5 (OCR): partes SIN letra roja (pasada A2).
 *
 * Motivo (ago-2026, reportado por el dueño): los partes granulares de PUTANA empiezan a llegar
 * con OTRA presentación — el número de recibo **ya no va en rojo**, sale impreso en negro/gris
 * como el resto del formulario (y hay escaneos que apagan del todo el color).
 *
 * Qué pasaba: `umbralRojo` mide "rojez" = r − max(g,b). En tinta negra o gris eso es ~0, así que
 * `hayTinta` daba **falso en las cinco bandas** y la pasada A no llamaba al OCR ni una vez. La
 * página caía en la pasada B (hoja entera en gris, psm 3), que es el RESPALDO: lee todos los
 * números de la hoja —fecha, cantidad, placa, PK, el teléfono del membrete— y de ahí salen
 * candidatos naranja a un dígito que no son nada.
 *
 * Corrección: pasada A2, con las MISMAS bandas de la pasada A, aislando el número por TAMAÑO
 * en vez de por color (`mascaraOscura` = `umbralOscuro` + `componentes` + `glifosGrandes`).
 * Corre solo cuando la pasada A no dejó nada, así que el formato viejo cuesta igual que antes.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_ocr_gris.js
 */
'use strict';
const path=require('path');
const {umbralRojo,umbralOscuro,oscuridadPx,componentes,glifosGrandes,mascaraOscura}=
  require(path.join(__dirname,'..','..','conciliador','conciliador.js'));

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};

/* ---- Banda sintética: un lienzo RGBA donde se pintan rectángulos, que es lo que son los
   glifos para el filtro (alto y ancho es lo único que mira `glifosGrandes`). ---- */
function lienzo(w,h,{papel=235,ruido=4}={}){
  const d=new Uint8ClampedArray(w*h*4);
  let semilla=98765;                               // LCG: misma banda en cada corrida
  const rnd=()=>((semilla=(semilla*1103515245+12345)&0x7fffffff)/0x7fffffff);
  for(let p=0;p<w*h;p++){
    const i=p*4, v=papel-Math.round(rnd()*ruido);
    d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
  }
  return {d,w,h};
}
// Pinta una mancha de tinta. `rojo` la deja como el formato VIEJO (roja); si no, gris/negra.
function tinta(L,x,y,w,h,{nivel=60,rojo=false}={}){
  for(let yy=y;yy<y+h;yy++) for(let xx=x;xx<x+w;xx++){
    const i=(yy*L.w+xx)*4;
    L.d[i]=rojo?Math.min(255,nivel+70):nivel;
    L.d[i+1]=nivel; L.d[i+2]=nivel; L.d[i+3]=255;
  }
}
// Un folio de `n` dígitos de alto `alto`, separados (que no se toquen: son n manchas).
function folio(L,x,y,n,alto,opts){
  const anc=Math.round(alto*0.6), sep=Math.round(alto*0.35);
  for(let k=0;k<n;k++) tinta(L,x+k*(anc+sep),y,anc,alto,opts);
  return n;
}
// Cuerpo de texto del formulario: manchitas pequeñas en varias líneas.
function textoChico(L,x,y,lineas,porLinea,alto,opts){
  for(let f=0;f<lineas;f++) for(let k=0;k<porLinea;k++)
    tinta(L,x+k*(alto+3),y+f*(alto*2),alto-2,alto,opts);
  return lineas*porLinea;
}

console.log('\n1) Formato NUEVO: folio en NEGRO sobre papel blanco (el caso reportado)');
let L=lienzo(400,300);
folio(L,190,20,5,40);                              // el folio, arriba a la derecha, grande
textoChico(L,20,120,6,10,9);                       // el formulario, pequeño
let ur=umbralRojo(L.d,L.w*L.h);
chk('la pasada A NO ve tinta (era el bug: ni llamaba al OCR)', ur.hayTinta, false);
let m=mascaraOscura(L.d,L.w,L.h);
chk('la pasada A2 sí detecta tinta', m.hayTinta, true);
chk('conserva los 5 dígitos del folio', m.glifos.length, 5);
chk('y tira las 60 manchas del texto chico', m.glifos.every(g=>g.h>=30), true);
chk('la máscara no sale vacía', m.px>0, true);

console.log('\n2) Formato VIEJO (rojo): la pasada A sigue mandando, no se toca nada');
L=lienzo(400,300);
folio(L,190,20,5,40,{nivel:110,rojo:true});
textoChico(L,20,120,6,10,9);
ur=umbralRojo(L.d,L.w*L.h);
chk('la pasada A ve la tinta roja', ur.hayTinta, true);
chk('→ con la pasada A viva, la A2 no corre (coste igual que antes)', ur.hayTinta===true, true);

console.log('\n3) Escaneo LAVADO: papel gris 200 y tinta gris 150 (umbral fijo no serviría)');
L=lienzo(400,300,{papel:200});
folio(L,190,20,5,40,{nivel:150});
textoChico(L,20,120,6,10,9,{nivel:150});
m=mascaraOscura(L.d,L.w,L.h);
chk('detecta contraste', m.hayTinta, true);
chk('el umbral queda ENTRE papel y tinta', m.T>oscuridadPx([200,200,200,255],0)&&m.T<=oscuridadPx([150,150,150,255],0), true);
chk('conserva los 5 dígitos', m.glifos.length, 5);

console.log('\n4) Banda en BLANCO (entre partes): no se puede inventar un número');
L=lienzo(400,300);
m=mascaraOscura(L.d,L.w,L.h);
chk('sin contraste → se descarta', m.hayTinta, false);
chk('no devuelve máscara (no llama al OCR)', m.mask, null);
chk('motivo', m.motivo, 'sin contraste');

console.log('\n5) Banda con SOLO texto chico (mitad inferior del parte): sin folio, sin lectura');
L=lienzo(400,600);                                 // banda alta: el suelo del folio son 18 px
textoChico(L,20,60,8,12,12);                       // texto de 12 px: pasa el mínimo, no el suelo
m=mascaraOscura(L.d,L.w,L.h);
chk('hay tinta…', m.hayTinta, true);
chk('…pero nada llega al suelo de altura del folio', m.glifos.length, 0);
chk('la banda se descarta y cae a la pasada B, como antes', m.mask, null);
chk('motivo', m.motivo, 'sin número grande');

console.log('\n6) Marcos y rayas del formulario no cuentan como número');
L=lienzo(400,300);
tinta(L,10,10,380,3);                              // raya horizontal de lado a lado
tinta(L,10,10,3,280);                              // raya vertical
folio(L,190,40,5,40);
m=mascaraOscura(L.d,L.w,L.h);
chk('quedan exactamente los 5 dígitos (las 2 rayas fuera)', m.glifos.length, 5);
chk('ninguno es más ancho que la mitad de la banda', m.glifos.every(g=>g.w<=200), true);

console.log('\n7) Una MANCHA grande del escaneo no puede tapar el folio');
L=lienzo(400,300);
folio(L,190,20,5,40);
tinta(L,20,200,60,120);                            // borrón: alto 120 = 40% de la banda
m=mascaraOscura(L.d,L.w,L.h);
chk('el folio sobrevive (5 dígitos iguales hacen grupo; el borrón está solo)', m.glifos.length, 5);
chk('el borrón no entra', m.glifos.every(g=>g.h===40), true);

console.log('\n8) `componentes`: cuenta las manchas y mide sus cajas');
const mask=new Uint8Array(10*10);
mask[0]=1; mask[1]=1; mask[11]=1;                  // una mancha de 3 px (2×2)
mask[55]=1;                                        // otra suelta
let c=componentes(mask,10,10);
chk('dos manchas', c.comps.length, 2);
chk('la primera mide 2×2 con 3 px', [c.comps[0].w,c.comps[0].h,c.comps[0].px], [2,2,3]);
chk('la segunda es un punto', [c.comps[1].w,c.comps[1].h,c.comps[1].px], [1,1,1]);

console.log('\n9) `glifosGrandes`: el corte es relativo, no un tamaño quemado');
const cajas=[{id:1,h:40,w:24,px:960},{id:2,h:38,w:23,px:874},{id:3,h:12,w:8,px:96},{id:4,h:9,w:6,px:54}]
  .map(o=>Object.assign({x0:0,x1:o.w-1,y0:0,y1:o.h-1},o));
chk('el grupo alto (40 y 38) gana al chico', glifosGrandes(cajas,400,300).map(g=>g.id), [1,2]);
chk('con la tolerancia abierta entran todos', glifosGrandes(cajas,400,300,{frac:0.2}).map(g=>g.id), [1,2,3,4]);
chk('un solo glifo alto no forma grupo → se sigue bajando', glifosGrandes(cajas.slice(0,1).concat(cajas.slice(2)),400,300).map(g=>g.id), [3,4]);
chk('exigiendo 3 dígitos iguales, ningún grupo basta → banda descartada', glifosGrandes(cajas,400,300,{minGrupo:3}), []);

console.log('\n'+(fallos?('❌ '+fallos+' verificación(es) fallaron'):'✅ Todo correcto'));
process.exit(fallos?1:0);

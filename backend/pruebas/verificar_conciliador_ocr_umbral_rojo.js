/**
 * Verificación — conciliador de actas, Paso 5 (OCR): umbral ADAPTATIVO de tinta roja.
 *
 * Bug corregido (ago-2026). Reportado por el dueño con `SOPORTES ORTIZ TRAMO 2 DEL 01 AL 15 DE
 * AGOSTO DE 2026.pdf` (25 pág., CamScanner): el OCR dejó **21 de 25 páginas "sin lectura"**.
 * No era límite del lector: los partes traen el número de recibo impreso en ROJO y grande, pero
 * ese PDF salió con el color APAGADO. La pasada A recortaba la tinta con un umbral FIJO
 * (`r>60 && r>max(g,b)*1.3 && r-max(g,b)>20`), calibrado para tinta viva. Medido sobre el PDF
 * real (render a escala 2.0, el mismo del app):
 *
 *   - escaneo vivo   (pág. 1)  → píxeles del número: r≈129 g≈89 b≈94  → rojez ≈ 36, ratio 1.46
 *   - escaneo apagado(pág. 10) → píxeles del número: r≈154 g≈130 b≈130 → rojez ≈ 24, ratio 1.19
 *
 * El apagado NO pasa `r > 1.3·max(g,b)`: la franja quedaba con CERO píxeles rojos, por debajo
 * del mínimo de 40, y `_recorteRojo` devolvía null — el OCR ni se llamaba. En las páginas 8 a 22
 * del PDF real, la página ENTERA daba entre 0 y 13 píxeles con la regla vieja.
 *
 * Corrección: el umbral lo pone la propia franja (`umbralRojo`): pico = percentil 99,9 del canal
 * de rojez (= la tinta) y corte al 45% de ese pico, con portero `hayTinta` (pico<10 = no hay
 * número rojo en la franja; sin ese portero el suelo del umbral marcaría el ruido del papel).
 *
 * Resultado medido con tesseract 5.3.4 sobre las 25 páginas del PDF real:
 * lecturas en **24 de 25 páginas** (antes 4), la mayoría exactas contra el número impreso.
 *
 * Correr:  node backend/pruebas/verificar_conciliador_ocr_umbral_rojo.js
 */
'use strict';
const path=require('path');
const {umbralRojo,rojezPx}=require(path.join(__dirname,'..','..','conciliador','conciliador.js'));

let fallos=0;
const chk=(nombre,got,esp)=>{
  const ok=JSON.stringify(got)===JSON.stringify(esp);
  if(!ok) fallos++;
  console.log((ok?'  ok   ':'  FALLA')+'  '+nombre+'  → '+JSON.stringify(got)+(ok?'':'   esperado '+JSON.stringify(esp)));
};

// Franja sintética calibrada con los valores MEDIDOS en el PDF real.
// Papel: claro y casi neutro (rojez 0..ruido). Tinta: `rojez` puntos de rojo sobre el papel.
function franja(w,h,{rojez,frac,rTinta=150,rPapel=235,ruido=5}){
  const n=w*h, d=new Uint8ClampedArray(n*4);
  let semilla=12345;                       // LCG: misma franja en cada corrida
  const rnd=()=>((semilla=(semilla*1103515245+12345)&0x7fffffff)/0x7fffffff);
  const tinta=Math.round(n*frac);
  for(let p=0;p<n;p++){
    const i=p*4, esTinta=p<tinta;          // la tinta va al principio; da igual dónde
    const r=esTinta?rTinta:rPapel;
    const baja=esTinta?rojez:Math.round(rnd()*ruido);
    d[i]=r; d[i+1]=r-baja; d[i+2]=r-baja; d[i+3]=255;
  }
  return {d,n,tinta};
}
// La regla VIEJA, tal cual estaba en _recorteRojo antes de la corrección.
function reglaVieja(d){
  let c=0;
  for(let i=0;i<d.length;i+=4){
    const r=d[i], mx=Math.max(d[i+1],d[i+2]);
    if(r>60 && r>mx*1.3 && (r-mx)>20) c++;
  }
  return c;
}
function seleccionados(d,T){
  let c=0;
  for(let i=0;i<d.length;i+=4) if(rojezPx(d,i)>=T && d[i]>40) c++;
  return c;
}

console.log('\n1) Escaneo VIVO (rojez 36) — el caso que ya funcionaba, no se rompe');
let f=franja(300,200,{rojez:36,frac:0.005});
let u=umbralRojo(f.d,f.n);
chk('detecta tinta', u.hayTinta, true);
chk('el umbral queda por DEBAJO de la tinta', u.T<36, true);
chk('selecciona la tinta completa', seleccionados(f.d,u.T), f.tinta);
chk('la regla vieja también la veía', reglaVieja(f.d)>40, true);

console.log('\n2) Escaneo APAGADO de CamScanner (rojez 24) — el caso del PDF del usuario');
f=franja(300,200,{rojez:24,frac:0.005});
u=umbralRojo(f.d,f.n);
chk('la regla VIEJA no veía NADA (el bug)', reglaVieja(f.d), 0);
chk('ahora sí detecta tinta', u.hayTinta, true);
chk('el umbral queda por DEBAJO de la tinta', u.T<24, true);
chk('selecciona la tinta completa', seleccionados(f.d,u.T), f.tinta);

console.log('\n3) Franja SIN número rojo (solo ruido del papel) — no se puede inventar tinta');
f=franja(300,200,{rojez:0,frac:0,ruido:6});
u=umbralRojo(f.d,f.n);
chk('pico se queda en el ruido', u.pico<10, true);
chk('la franja se descarta (no llama al OCR)', u.hayTinta, false);

console.log('\n4) Tinta MUY apagada (rojez 14, el peor escaneo visto)');
f=franja(300,200,{rojez:14,frac:0.005});
u=umbralRojo(f.d,f.n);
chk('la regla vieja tampoco la veía', reglaVieja(f.d), 0);
chk('se detecta', u.hayTinta, true);
chk('selecciona la tinta completa', seleccionados(f.d,u.T), f.tinta);

console.log('\n5) Número pequeño en franja grande (tinta = 0,2% de la franja)');
f=franja(600,400,{rojez:24,frac:0.002});
u=umbralRojo(f.d,f.n);
chk('se detecta igual', u.hayTinta, true);
chk('selecciona la tinta completa', seleccionados(f.d,u.T), f.tinta);
chk('sin arrastrar el papel (nada de más)', seleccionados(f.d,u.T)-f.tinta, 0);

console.log('\n'+(fallos?('❌ '+fallos+' verificación(es) fallaron'):'✅ Todo correcto'));
process.exit(fallos?1:0);

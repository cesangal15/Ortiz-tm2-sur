#!/usr/bin/env node
/**
 * Verificación D158 — la foto del tablero de producción, compartida.
 *
 * `tablero-produccion.html` calculaba la foto en el navegador y la guardaba en el localStorage de
 * quien pulsaba el botón. El jefe y los residentes seguían viendo la copia embebida en el archivo.
 * D158 la mueve al Sheet: quien publica, publica para todos.
 *
 * Se ejecuta contra el código REAL: carga `Codigo.gs` como módulo con un Sheet falso EN MEMORIA que
 * se deja escribir. No abre el Sheet real ni la red.
 *
 * Lo que puede romperse en silencio y por eso se comprueba:
 *   · el TROCEADO — una celda de Sheets admite 50.000 caracteres y la foto ronda los 95.000. Si el
 *     troceado se rompe, Sheets trunca la celda sin avisar y el JSON vuelve ilegible;
 *   · el PREFIJO `~` — un trozo que empiece por `=` lo guarda Sheets como FÓRMULA y su contenido se
 *     pierde. Es el fallo más silencioso de todos: solo aparece si el corte cae en el sitio malo;
 *   · el BORRADO PREVIO — una foto nueva más corta que la anterior dejaría trozos huérfanos al final
 *     y el JSON saldría con basura pegada;
 *   · el GUARD DE ROL en el servidor — si viviera solo en el cliente, `localStorage.setItem('rol',
 *     'admin')` bastaría para que un residente publicara una foto a toda la obra (D109 existe por eso);
 *   · la LECTURA SIN FOTO y la INCOMPLETA — las dos tienen que devolver `foto:null` para que el
 *     tablero se quede con la suya, nunca una pantalla vacía delante de una sala.
 *
 * Y al final se MUTA el código a propósito para comprobar que el arnés no es ciego.
 *
 *   node backend/pruebas/verificar_d158_tablero_foto.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8');
let fallos=0, casos=0;
function ok(n,c,x){ casos++; if(!c){ fallos++; console.log('  ✗ '+n+(x?'  → '+x:'')); } else console.log('  ✓ '+n); }

function hojaFalsa(filas){
  const g={
    _f: filas.map(r=>r.slice()),
    getLastRow: ()=>g._f.length,
    getLastColumn: ()=>g._f.reduce((m,r)=>Math.max(m,r.length),0),
    getMaxRows: ()=>Math.max(g._f.length,200), getMaxColumns: ()=>Math.max(g.getLastColumn(),26),
    insertRowsAfter(){}, insertColumnsAfter(){},
    _fila(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getRange(f,c,nf,nc){
      nf=(nf===undefined?1:nf); nc=(nc===undefined?1:nc);
      return {
        getValues(){ const out=[];
          for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]||[], fila=[];
            for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]);
            out.push(fila); } return out; },
        setValues(m){ for(let i=0;i<m.length;i++){ const r=g._fila(f-1+i);
            for(let j=0;j<m[i].length;j++) r[c-1+j]=m[i][j]; } },
        setValue(v){ g._fila(f-1)[c-1]=v; },
        clearContent(){ for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]; if(!r) continue;
            for(let j=c-1;j<c-1+nc;j++) r[j]=''; } }
      };
    }
  };
  return g;
}

function cargar(hojasIni, mutar){
  const src = mutar ? mutar(SRC) : SRC;
  const hojas={};
  Object.keys(hojasIni||{}).forEach(k=>{ hojas[k]=hojaFalsa(hojasIni[k]); });
  const ctx={ console,
    SpreadsheetApp:{ openById: ()=>({
      getSheetByName:(n)=>hojas[n]||null,
      insertSheet:(n)=>{ hojas[n]=hojaFalsa([]); return hojas[n]; },
      getSpreadsheetTimeZone:()=>'America/Bogota' }) },
    ContentService:{ createTextOutput:(t)=>({ setMimeType:()=>JSON.parse(t) }), MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:()=>({ get:()=>null, put(){} }) },
    PropertiesService:{ getScriptProperties:()=>({ getProperty:()=>null, setProperty(){} }) },
    Utilities:{ computeHmacSha256Signature:()=>[], base64Encode:()=>'', getUuid:()=>'uuid',
                formatDate:(d)=>'2026-09-07' },
    Logger:{ log(){} }, Session:{ getScriptTimeZone:()=>'America/Bogota' }
  };
  ctx.globalThis=ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  ctx._hojas=hojas; return ctx;
}

/* Una foto de tamaño realista (~95 KB) con un `=` colocado A PROPÓSITO justo donde cae el corte
   entre el primer y el segundo trozo: si el prefijo `~` desapareciera, Sheets se comería ese trozo. */
function fotoGrande(){
  const dias=[]; for(let i=0;i<900;i++)
    dias.push({f:'2026-08-'+String((i%28)+1).padStart(2,'0'), exc:i*1.5, ter:i, sub:i/2, bas:i/3, t:'SOLEADO'});
  const f={ fc:1.3, desde:'2025-08', generado:'2026-09-07 10:00', per:[{p:'2026-08', d:dias, a:{}, m:null}] };
  let s=JSON.stringify(f);
  while(s.length < 95000){ f.per[0].d.push(dias[0]); s=JSON.stringify(f); }
  return f;
}

console.log('\n1 · Guard de ROL en el SERVIDOR (D109): quién puede publicar');
{
  const foto={ per:[{p:'2026-08'}], generado:'x' };
  for(const [rol,puede] of [['admin',true],['jefe',true],['residente',false],['capataz',false],['',false]]){
    const ctx=cargar({});
    const r=ctx.tableroGuardar({ action:'tablero_guardar', foto, _rol:rol, usuario:rol||'anon' });
    ok('rol "'+(rol||'(vacío)')+'" '+(puede?'publica':'NO publica'), !!r.ok===puede, JSON.stringify(r.error||''));
    const escrito = !!(ctx._hojas.TABLERO && ctx._hojas.TABLERO._f.length>1);
    ok('  y la hoja '+(puede?'se escribió':'quedó intacta'), escrito===puede);
  }
}

console.log('\n2 · Ida y vuelta de una foto de 95 KB (troceado, prefijo, reconstrucción)');
{
  const ctx=cargar({});
  const foto=fotoGrande();
  const crudo=JSON.stringify(foto);
  const g=ctx.tableroGuardar({ action:'tablero_guardar', foto, _rol:'admin', usuario:'admin' });
  ok('publica', g.ok===true, JSON.stringify(g.error||''));
  ok('la foto pasa de 50.000 caracteres (si no, la prueba no prueba nada)', crudo.length>50000, crudo.length);
  ok('se partió en más de un trozo', g.meta.trozos>1, 'trozos='+g.meta.trozos);
  const celdas=ctx._hojas.TABLERO._f.slice(1);
  ok('ninguna celda pasa el límite de Sheets', celdas.every(r=>String(r[1]).length<=50000));
  ok('TODA celda empieza por ~ (ninguna puede volverse fórmula)', celdas.every(r=>String(r[1]).charAt(0)==='~'));
  const r=ctx.tableroLeer();
  ok('se vuelve a leer', r.ok===true && !!r.foto);
  ok('y es IDÉNTICA a la publicada', JSON.stringify(r.foto)===crudo);
  ok('la meta dice cuántos caracteres y períodos', r.meta && r.meta.caracteres===crudo.length && r.meta.periodos===foto.per.length);
}

console.log('\n3 · Una foto MÁS CORTA no deja trozos huérfanos de la anterior');
{
  const ctx=cargar({});
  ctx.tableroGuardar({ action:'tablero_guardar', foto:fotoGrande(), _rol:'admin', usuario:'admin' });
  const corta={ fc:1.3, generado:'2026-09-08 09:00', per:[{p:'2026-09', d:[], a:{}, m:null}] };
  ctx.tableroGuardar({ action:'tablero_guardar', foto:corta, _rol:'admin', usuario:'admin' });
  const r=ctx.tableroLeer();
  ok('se lee la CORTA, sin basura pegada', r.foto && JSON.stringify(r.foto)===JSON.stringify(corta),
     r.error||JSON.stringify(r.foto&&r.foto.per));
}

console.log('\n4 · Sin foto, foto incompleta y foto vacía: nunca una pantalla en blanco');
{
  ok('sin hoja TABLERO devuelve foto:null', cargar({}).tableroLeer().foto===null);
  const ctx=cargar({});
  ctx.tableroGuardar({ action:'tablero_guardar', foto:fotoGrande(), _rol:'admin', usuario:'admin' });
  ctx._hojas.TABLERO._f[2][1]='';                       // se borra un trozo del medio
  const r=ctx.tableroLeer();
  ok('con un trozo perdido devuelve foto:null y lo dice', r.foto===null && !!r.error, JSON.stringify(r.error));
  const v=cargar({}).tableroGuardar({ action:'tablero_guardar', foto:{per:[]}, _rol:'admin', usuario:'admin' });
  ok('una foto sin períodos se rechaza', v.ok===false);
}

console.log('\n5 · El arnés no es ciego (se rompe el código a propósito)');
{
  const foto=fotoGrande();
  const sinPrefijo=cargar({}, s=>s.replace(/filas\.push\(\[i\+1, '~'\+trozos\[i\]\]\)/, 'filas.push([i+1, trozos[i]])'));
  const g=sinPrefijo.tableroGuardar({ action:'tablero_guardar', foto, _rol:'admin', usuario:'admin' });
  const celdas=sinPrefijo._hojas.TABLERO._f.slice(1);
  ok('sin el prefijo ~, la comprobación del punto 2 FALLA', !celdas.every(r=>String(r[1]).charAt(0)==='~'));
  const sinBorrado=cargar({}, s=>s.replace(/if\(last>1\) sh\.getRange\(2,1,last-1,TABLERO_HEADERS\.length\)\.clearContent\(\);/, ''));
  sinBorrado.tableroGuardar({ action:'tablero_guardar', foto, _rol:'admin', usuario:'admin' });
  sinBorrado.tableroGuardar({ action:'tablero_guardar', foto:{fc:1.3,generado:'z',per:[{p:'2026-09',d:[]}]},
                              _rol:'admin', usuario:'admin' });
  const r=sinBorrado.tableroLeer();
  ok('sin el borrado previo, la foto vuelve rota', !(r.foto && r.foto.per && r.foto.per.length===1 && !r.error));
  const sinGuard=cargar({}, s=>s.replace(/const permiso=puedePublicarTablero_\(body\);/, 'const permiso={ok:true};'));
  ok('sin el guard, un residente publicaría',
     sinGuard.tableroGuardar({ action:'tablero_guardar', foto, _rol:'residente', usuario:'res' }).ok===true);
}

console.log('\n'+(fallos?('✗ '+fallos+' de '+casos+' comprobaciones fallaron'):('✓ '+casos+' comprobaciones, todas bien')));
process.exit(fallos?1:0);

#!/usr/bin/env node
/**
 * Verificación D139 — alta y baja de máquinas desde la pantalla (backlog 2.29).
 *
 * Hermano de `verificar_d138_flota_viva.js`, que sigue cubriendo la LECTURA (ventana semiabierta,
 * estancias múltiples, respaldo). Aquí se comprueba lo que D139 agrega: la ESCRITURA de la hoja
 * `MAQUINAS`, el guard de rol en el servidor y el detector de parecidos.
 *
 * Se ejecuta contra el código REAL: carga `Codigo.gs` como módulo con un Sheet falso EN MEMORIA que
 * sí se deja escribir. No abre el Sheet real ni la red.
 *
 * Lo que puede romperse en silencio y por eso se comprueba:
 *   · el guard de rol — si viviera solo en el cliente, `localStorage.setItem('rol','admin')` bastaría
 *     para que el jefe escribiera (D109 existe justo por eso);
 *   · las fechas — sin `fdateValida_` (D106) entra una estancia sin fecha, que no está vigente ningún
 *     día: la máquina desaparecería de las capturas sin que nadie sepa por qué;
 *   · las DOS memorias — `getFlotaRows_` tiene memo propio y NO lo alcanza `invalidarHoja_`; si solo
 *     se invalidara la hoja, una lectura posterior en la MISMA ejecución devolvería datos viejos en
 *     silencio (es el problema que D107 documentó para `_memoRango`);
 *   · el detector de parecidos — es la razón de ser del ítem: un `RT02` que no cruza con
 *     `dim_maquinaria` rompe el pegado a Captura_Diaria EN SILENCIO (D111);
 *   · la lectura acotada — leer MAQUINARIA entera para sacar una columna sería una regresión (D107);
 *   · la recepción de reportes — `guardarReporte` sigue SIN consultar el catálogo (D138/D82).
 *
 * Y al final se MUTA el código a propósito para comprobar que el arnés no es ciego, como se hizo en
 * D138 con la ventana semiabierta.
 *
 *   node backend/pruebas/verificar_d139_flota_pantalla.js
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const REPO=path.resolve(__dirname,'..','..');
const SRC=fs.readFileSync(path.join(REPO,'backend','Codigo.gs'),'utf8');
let fallos=0, casos=0;
function ok(nombre, cond, extra){ casos++; if(!cond){ fallos++; console.log('  ✗ '+nombre+(extra?'  → '+extra:'')); } else console.log('  ✓ '+nombre); }

/* ---------- Sheet falso ESCRIBIBLE ---------- */
function hojaFalsa(filas){
  const g={
    _f: filas.map(function(r){ return r.slice(); }),
    getLastRow: function(){ return g._f.length; },
    getLastColumn: function(){ return g._f.reduce(function(m,r){ return Math.max(m,r.length); },0); },
    getMaxRows: function(){ return Math.max(g._f.length, 200); },
    getMaxColumns: function(){ return Math.max(g.getLastColumn(), 26); },
    insertRowsAfter: function(){}, insertColumnsAfter: function(){},
    _fila: function(i){ while(g._f.length<=i) g._f.push([]); return g._f[i]; },
    getRange: function(f,c,nf,nc){
      nf=(nf===undefined?1:nf); nc=(nc===undefined?1:nc);
      return {
        getValues: function(){
          const out=[];
          for(let i=f-1;i<f-1+nf;i++){ const r=g._f[i]||[], fila=[];
            for(let j=c-1;j<c-1+nc;j++) fila.push(r[j]===undefined?'':r[j]);
            out.push(fila); }
          return out;
        },
        setValues: function(m){
          for(let i=0;i<m.length;i++){ const r=g._fila(f-1+i);
            for(let j=0;j<m[i].length;j++) r[c-1+j]=m[i][j]; }
        },
        setValue: function(v){ g._fila(f-1)[c-1]=v; }
      };
    }
  };
  return g;
}

const H=['id_maquina','tipo','horas_prog','propiedad','fecha_ingreso','fecha_retiro','notas'];
// MAQUINARIA falsa: solo importa que exista la columna `id_maquina` en su sitio del layout D52 (col E).
function maquinariaFalsa(ids){
  const h=[]; for(let i=0;i<40;i++) h.push('c'+i);
  h[4]='id_maquina'; h[1]='fecha';
  const filas=[h];
  ids.forEach(function(id){ const r=new Array(40).fill(''); r[1]='2026-08-01'; r[4]=id; filas.push(r); });
  return hojaFalsa(filas);
}

function cargarBackend(filasMaquinas, idsMaquinaria, mutar){
  const src = mutar ? mutar(SRC) : SRC;
  const hojas={};
  if(filasMaquinas) hojas.MAQUINAS = hojaFalsa(filasMaquinas);
  if(idsMaquinaria) hojas.MAQUINARIA = maquinariaFalsa(idsMaquinaria);
  const ctx={ console,
    SpreadsheetApp:{ openById: function(){ return {
      getSheetByName: function(n){ return hojas[n] || null; },
      insertSheet: function(n){ hojas[n]=hojaFalsa([]); return hojas[n]; },
      getSpreadsheetTimeZone: function(){ return 'America/Bogota'; } }; } },
    // Devuelve el objeto ya parseado: los tests miran el JSON de la respuesta, no la cadena.
    ContentService:{ createTextOutput:function(t){ return { setMimeType:function(){ return JSON.parse(t); } }; },
                     MimeType:{JSON:'json'} },
    CacheService:{ getScriptCache:function(){ return { get:function(){return null;}, put:function(){} }; } },
    PropertiesService:{ getScriptProperties:function(){ return { getProperty:function(){return null;}, setProperty:function(){} }; } },
    Utilities:{ computeHmacSha256Signature:function(){ return []; }, base64Encode:function(){ return ''; },
                getUuid:function(){ return 'uuid'; } },
    Logger:{ log:function(){} },
    Session:{ getScriptTimeZone:function(){ return 'America/Bogota'; } }
  };
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  ctx._hojas=hojas;
  return ctx;
}
// Copia de las filas de datos de la hoja MAQUINAS (sin encabezado), para comparar antes/después.
function volcado(ctx){ return JSON.stringify((ctx._hojas.MAQUINAS||{_f:[]})._f.slice(1)); }

const BASE=[H,
  ['BL005','BULLDOZER',6.4,'propia','2026-01-01','',''],
  ['EXC015','EXCAVADORA',6.4,'propia','2026-01-01','',''],
  ['FNG02','FINISHER',6.4,'propia','2026-06-01','2026-06-15',''],
  ['RT-02','RETROEXCAVADORA',5,'alquilada','2026-07-01','','La pajarita']
];
const HIST=['BL005','EXC015','FNG02','RT-02','MO03'];
const ALTA_OK={ op:'alta', id_maquina:'MO03', tipo:'MOTONIVELADORA', propiedad:'propia',
                fecha_ingreso:'2026-08-10', notas:'', fecha:'2026-08-20' };

console.log('\n1 · Guard de ROL en el SERVIDOR (D109), no solo en el cliente');
{
  const jefe=cargarBackend(BASE, HIST);
  const antes=volcado(jefe);
  const r=jefe.flotaGuardar(Object.assign({_rol:'jefe', usuario:'jefe', confirmado:true}, ALTA_OK));
  ok('jefe NO puede escribir la flota',        r.ok===false, JSON.stringify(r));
  ok('y el mensaje dice que es solo lectura',  /SOLO LECTURA/i.test(r.error||''), r.error);
  ok('la hoja quedó intacta',                  volcado(jefe)===antes);

  ['admin','residente'].forEach(function(rol){
    const c=cargarBackend(BASE, HIST);
    const x=c.flotaGuardar(Object.assign({_rol:rol, usuario:rol, confirmado:true}, ALTA_OK));
    ok(rol+' SÍ puede escribir la flota', x.ok===true, JSON.stringify(x.error||''));
  });
  const j=cargarBackend(BASE, HIST);
  const xj=j.flotaGuardar(Object.assign({_rol:'asistencia_plus', usuario:'jeisson', confirmado:true}, ALTA_OK));
  ok('jeisson SÍ puede escribir la flota',     xj.ok===true, JSON.stringify(xj.error||''));

  const otro=cargarBackend(BASE, HIST);
  const xo=otro.flotaGuardar(Object.assign({_rol:'capataz', usuario:'angel', confirmado:true}, ALTA_OK));
  ok('un capataz NO puede',                    xo.ok===false);

  // El rol NO puede venir del cliente: doPost lo sobrescribe SIEMPRE con el del token.
  ok('doPost sobrescribe body._rol con el del token', /body\._rol\s*=\s*ses\.rol/.test(SRC));
  ok('doPost enruta flota_guardar',                   /action==='flota_guardar'\)\s*return flotaGuardar\(body\)/.test(SRC));
  ok('doGet expone ?action=flota (solo lectura)',     /a==='flota'\)\s*return flotaLeer\(e\)/.test(SRC));
}

console.log('\n2 · Fechas: sin fecha válida no se escribe NADA (D106)');
{
  const c=cargarBackend(BASE, HIST), antes=volcado(c);
  const casos=[
    ['ingreso vacío',   { fecha_ingreso:'' }],
    ['ingreso basura',  { fecha_ingreso:'el lunes' }],
    ['ingreso inexistente (31-feb)', { fecha_ingreso:'2026-02-31' }],
    ['retiro basura',   { fecha_retiro:'ayer' }]
  ];
  casos.forEach(function(x){
    const r=c.flotaGuardar(Object.assign({_rol:'admin', usuario:'admin', confirmado:true}, ALTA_OK, x[1]));
    ok('rechaza '+x[0], r.ok===false, JSON.stringify(r));
  });
  const r2=c.flotaGuardar(Object.assign({_rol:'admin', usuario:'admin', confirmado:true}, ALTA_OK,
                                        { fecha_ingreso:'2026-08-10', fecha_retiro:'2026-08-01' }));
  ok('rechaza retiro ANTERIOR al ingreso', r2.ok===false, JSON.stringify(r2));
  const r3=c.flotaGuardar(Object.assign({_rol:'admin', usuario:'admin', confirmado:true}, ALTA_OK,
                                        { fecha_ingreso:'2026-08-10', fecha_retiro:'2026-08-10' }));
  ok('rechaza retiro IGUAL al ingreso (ventana vacía)', r3.ok===false, JSON.stringify(r3));
  ok('tras todos los rechazos la hoja sigue igual', volcado(c)===antes);
}

console.log('\n3 · Identidad de la estancia = id_maquina + fecha_ingreso');
{
  const c=cargarBackend(BASE, HIST);
  const dup=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'propia', fecha_ingreso:'2026-01-01' });
  ok('rechaza dos estancias con la MISMA clave', dup.ok===false, JSON.stringify(dup));
  ok('y lo dice sin hablar de números de fila del cliente', /ya existe una estancia/i.test(dup.error||''), dup.error);

  const tras=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'propia', fecha_ingreso:'2026-05-01' });
  ok('rechaza una estancia que se PISA con otra abierta', tras.ok===false, JSON.stringify(tras));

  // Un reingreso legítimo (la estancia vieja está cerrada) sí entra, como FILA NUEVA.
  const antes=(c._hojas.MAQUINAS._f.length);
  const re=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'FNG02', tipo:'FINISHER', propiedad:'propia', fecha_ingreso:'2026-08-03', fecha:'2026-08-10' });
  ok('un REINGRESO entra como fila nueva',   re.ok===true && c._hojas.MAQUINAS._f.length===antes+1, JSON.stringify(re.error||''));
  const fng=re.estancias.filter(function(e){ return e.id_maquina==='FNG02'; });
  ok('y la estancia vieja se CONSERVA (el hueco no se pierde)', fng.length===2,
     'editar la fila vieja borraría el mes en que la máquina no estuvo (D85)');
  ok('en el hueco de julio no estaba',       c.flotaEnFecha_('2026-07-10').catalogo.FNG02===undefined);
  ok('el 3-ago ya está de vuelta',           !!c.flotaEnFecha_('2026-08-03').catalogo.FNG02);
}

console.log('\n4 · El detector de parecidos (la razón del ítem, D111)');
{
  const c=cargarBackend(BASE, HIST), antes=volcado(c);
  const typo=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta',
    id_maquina:'RT02', tipo:'RETROEXCAVADORA', propiedad:'alquilada', fecha_ingreso:'2026-09-01' });
  ok('«RT02» no se escribe de una',        typo.ok===false && typo.confirmar===true, JSON.stringify(typo));
  ok('y propone «RT-02»',                  typo.sugerencia==='RT-02', JSON.stringify(typo.sugerencia));
  ok('el aviso nombra el histórico',       /histórico de MAQUINARIA/.test(typo.error||''), typo.error);
  ok('no escribió nada mientras pregunta', volcado(c)===antes);

  // Una máquina NUEVA DE VERDAD: pregunta una vez (es lo correcto) pero NO inventa un parecido.
  const nueva=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta',
    id_maquina:'PALA77', tipo:'EXCAVADORA', propiedad:'alquilada', fecha_ingreso:'2026-09-01' });
  ok('una máquina nueva de verdad NO dispara un falso parecido', nueva.confirmar===true && nueva.sugerencia==='',
     JSON.stringify(nueva.sugerencia));
  const conf=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'PALA77', tipo:'EXCAVADORA', propiedad:'alquilada', fecha_ingreso:'2026-09-01', fecha:'2026-09-05' });
  ok('confirmada una vez, entra',          conf.ok===true && !!c.flotaEnFecha_('2026-09-05').catalogo.PALA77, JSON.stringify(conf.error||''));

  // Un ID que YA está en el histórico de MAQUINARIA no pregunta nada.
  const c2=cargarBackend(BASE, HIST);
  const sinPregunta=c2.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta',
    id_maquina:'MO03', tipo:'MOTONIVELADORA', propiedad:'propia', fecha_ingreso:'2026-08-10' });
  ok('un ID del histórico entra SIN preguntar', sinPregunta.ok===true, JSON.stringify(sinPregunta));

  // Y un reingreso de algo que ya está en la hoja tampoco pregunta (aunque no esté en el histórico).
  const c3=cargarBackend([H,['ZZ1','EXCAVADORA',6.4,'propia','2026-01-01','2026-02-01','']], ['BL005']);
  const rei=c3.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta',
    id_maquina:'ZZ1', tipo:'EXCAVADORA', propiedad:'propia', fecha_ingreso:'2026-03-01' });
  ok('un reingreso de lo que ya está en la hoja no pregunta', rei.ok===true, JSON.stringify(rei));

  // La normalización es la que hace el trabajo: quitar lo no alfanumérico + mayúsculas.
  ok('normMaqClave_ colapsa RT-02 y rt02', c.normMaqClave_('RT-02')===c.normMaqClave_('rt02'));
  ok('y NO colapsa códigos distintos',     c.normMaqClave_('MO03')!==c.normMaqClave_('MO04'));
}

console.log('\n5 · La lectura del histórico va ACOTADA A UNA COLUMNA (D107)');
{
  const muchas=[]; for(let i=0;i<300;i++) muchas.push('EXC'+i);
  const c=cargarBackend(BASE, muchas);
  c._celdas=0;
  const hist=c.idsMaquinariaHistorico_();
  const leidas=c._celdas;
  ok('encuentra los 300 ids del histórico', hist.n===300, String(hist.n));
  ok('leyendo ~1 columna, no las 40',       leidas <= 300+40+5, leidas+' celdas (la hoja entera serían '+(301*40)+')');
  c._celdas=0; c.idsMaquinariaHistorico_();
  ok('y la segunda llamada no cuesta nada (memo)', c._celdas===0, String(c._celdas));
}

console.log('\n6 · Baja: cerrar la estancia abierta con la ventana semiabierta');
{
  const c=cargarBackend(BASE, HIST);
  const r=c.flotaGuardar({ _rol:'residente', usuario:'residente', op:'baja',
    clave:{id_maquina:'EXC015', fecha_ingreso:'2026-01-01'}, fecha_retiro:'2026-08-20', fecha:'2026-08-19' });
  ok('la baja se guarda',                       r.ok===true, JSON.stringify(r.error||''));
  ok('la víspera del retiro sigue en obra',     !!c.flotaEnFecha_('2026-08-19').catalogo.EXC015);
  ok('el día del retiro YA NO está',            c.flotaEnFecha_('2026-08-20').catalogo.EXC015===undefined,
     'fecha_retiro es el primer día que ya no estuvo (D138/D85)');
  ok('no se creó una fila nueva',               c._hojas.MAQUINAS._f.length===BASE.length);

  const otra=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'baja',
    clave:{id_maquina:'EXC015', fecha_ingreso:'2026-01-01'}, fecha_retiro:'2026-09-01' });
  ok('una estancia ya cerrada no se vuelve a cerrar', otra.ok===false, JSON.stringify(otra));
  ok('y manda a "Corregir" o a un alta nueva',        /Corregir/.test(otra.error||''), otra.error);

  const fantasma=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'baja',
    clave:{id_maquina:'BL005', fecha_ingreso:'1999-01-01'}, fecha_retiro:'2026-09-01' });
  ok('una clave que no existe se rechaza',      fantasma.ok===false, JSON.stringify(fantasma));

  const alReves=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'baja',
    clave:{id_maquina:'BL005', fecha_ingreso:'2026-01-01'}, fecha_retiro:'2025-12-01' });
  ok('retiro anterior al ingreso se rechaza',   alReves.ok===false, JSON.stringify(alReves));
}

console.log('\n7 · Corregir una estancia mal escrita (sin que sea el camino del reingreso)');
{
  const c=cargarBackend(BASE, HIST);
  const filas=c._hojas.MAQUINAS._f.length;
  const r=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'corregir',
    clave:{id_maquina:'FNG02', fecha_ingreso:'2026-06-01'},
    id_maquina:'FNG02', tipo:'FINISHER', propiedad:'propia',
    fecha_ingreso:'2026-06-02', fecha_retiro:'2026-06-15', notas:'ingreso corregido', fecha:'2026-06-10' });
  ok('corregir NO crea una fila nueva',   r.ok===true && c._hojas.MAQUINAS._f.length===filas, JSON.stringify(r.error||''));
  ok('el ingreso quedó corregido',        c.flotaEnFecha_('2026-06-01').catalogo.FNG02===undefined
                                          && !!c.flotaEnFecha_('2026-06-02').catalogo.FNG02);
  const choque=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'corregir',
    clave:{id_maquina:'FNG02', fecha_ingreso:'2026-06-02'},
    id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'propia', fecha_ingreso:'2026-01-01', confirmado:true });
  ok('corregir tampoco puede duplicar una clave', choque.ok===false, JSON.stringify(choque));
}

console.log('\n8 · Tipos y horas programadas');
{
  const c=cargarBackend(BASE, HIST);
  const malTipo=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'BL005', tipo:'COSA RARA', propiedad:'propia', fecha_ingreso:'2027-01-01' });
  ok('un tipo fuera de la lista se rechaza al ESCRIBIR', malTipo.ok===false, JSON.stringify(malTipo));
  const malProp=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'regalada', fecha_ingreso:'2027-01-01' });
  ok('la propiedad tiene que ser propia/alquilada',     malProp.ok===false, JSON.stringify(malProp));
  const sinProg=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'MO03', tipo:'MOTONIVELADORA', propiedad:'alquilada', fecha_ingreso:'2027-01-01', fecha:'2027-01-02' });
  ok('horas vacías → 5 h alquilada (D10)', sinProg.ok===true && c.flotaEnFecha_('2027-01-02').catalogo.MO03.prog===5,
     JSON.stringify(sinProg.error||''));
  const conProg=c.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta', confirmado:true,
    id_maquina:'MO04', tipo:'MOTONIVELADORA', propiedad:'propia', horas_prog:'8', fecha_ingreso:'2027-01-01', fecha:'2027-01-02' });
  ok('horas escritas mandan sobre la propiedad', conProg.ok===true && c.flotaEnFecha_('2027-01-02').catalogo.MO04.prog===8,
     JSON.stringify(conProg.error||''));
}

console.log('\n9 · Tras escribir, una lectura en la MISMA ejecución ve lo nuevo (las DOS memorias)');
{
  const c=cargarBackend(BASE, HIST);
  // Lectura ANTES de escribir: deja las dos memorias calientes (_memoHoja/_memoRango y _flotaRows).
  const antes=c.flotaEnFecha_('2026-08-20');
  ok('antes de escribir, MO03 no está',   antes.catalogo.MO03===undefined);
  const r=c.flotaGuardar(Object.assign({_rol:'admin', usuario:'admin', confirmado:true}, ALTA_OK));
  ok('el alta se guarda',                 r.ok===true, JSON.stringify(r.error||''));
  ok('la respuesta ya trae la estancia nueva',
     (r.estancias||[]).some(function(e){ return e.id_maquina==='MO03' && e.fecha_ingreso==='2026-08-10'; }));
  const despues=c.flotaEnFecha_('2026-08-20');
  ok('una lectura POSTERIOR, misma ejecución, ya la ve', !!despues.catalogo.MO03,
     'si solo se invalidara la hoja y no `_flotaRows`, aquí saldrían datos viejos EN SILENCIO');
  ok('y el catálogo de ese día crece en 1', Object.keys(despues.catalogo).length===Object.keys(antes.catalogo).length+1);
}

console.log('\n10 · Avisos de la hoja: lo que hoy nadie ve');
{
  const c=cargarBackend([H,
    ['BL005','BULLDOZER',6.4,'propia','2026-01-01','',''],
    ['BL005','BULLDOZER',6.4,'propia','2026-03-01','',''],           // se pisa con la de arriba
    ['RT02','RETROEXCAVADORA',5,'alquilada','2026-07-01','',''],     // el typo de D111
    ['XX','',null,'','no-es-fecha','','']                            // sin fecha de ingreso
  ], ['BL005','RT-02']);
  const p=c.flotaLeer({parameter:{fecha:'2026-08-20'}});
  ok('devuelve todas las estancias, no solo las vigentes', p.estancias.length===4, String(p.estancias.length));
  ok('avisa del traslape',              p.avisos.some(function(a){ return /se pisan/.test(a); }), JSON.stringify(p.avisos));
  ok('avisa de la fecha inválida',      p.avisos.some(function(a){ return /fecha_ingreso/.test(a); }));
  ok('avisa del tipo vacío',            p.avisos.some(function(a){ return /sin tipo/.test(a); }));
  ok('señala «RT02» contra el histórico y nombra «RT-02»',
     p.avisos.some(function(a){ return /RT02/.test(a) && /RT-02/.test(a); }), JSON.stringify(p.avisos));
  ok('marca cuáles están vigentes hoy', p.estancias.filter(function(e){ return e.vigente; }).length>0);
  ok('sirve la lista de tipos a la pantalla', (p.tipos||[]).indexOf('EXCAVADORA')>=0);
}

console.log('\n11 · Lo que NO cambia');
{
  const cuerpo=SRC.slice(SRC.indexOf('function guardarReporte('),
                         SRC.indexOf('\nfunction ', SRC.indexOf('function guardarReporte(')+30));
  ok('guardarReporte sigue sin consultar MAQ_CATALOGO',  cuerpo.indexOf('MAQ_CATALOGO')<0);
  ok('guardarReporte sigue sin consultar flotaEnFecha_', cuerpo.indexOf('flotaEnFecha_')<0,
     'validar ahí perdería un reporte que esperó en el teléfono a que volviera la señal (D82)');
  ok('guardarReporte sigue sin consultar la hoja MAQUINAS', cuerpo.indexOf('MAQUINAS')<0);
  ok('flota_guardar escribe SOLO la hoja MAQUINAS',
     (function(){ const i=SRC.indexOf('function flotaGuardar(');
        const f=SRC.slice(i, SRC.indexOf('\nfunction ', i+30));
        return f.length>1000 && !/getSheet\('(DATA|BANDEJA|MAQUINARIA|VOLQUETAS|OBSERVACIONES)'/.test(f)
               && /getSheet\('MAQUINAS'/.test(f); })());
  const sw=fs.readFileSync(path.join(REPO,'sw.js'),'utf8');
  ok('sw.js NO sube CACHE_V (no entran archivos nuevos al precache)', /CACHE_V\s*=\s*'tm2-v5'/.test(sw));
  ok('la pantalla de maquinaria NO va al precache (necesita datos vivos, D49)',
     sw.indexOf('produccion-maquinaria.html') < 0 || !/PRECACHE\s*=\s*\[[^\]]*produccion-maquinaria\.html/.test(sw));
}

/* La pantalla real, con un DOM mínimo: no es una prueba de aspecto, es que el camino de pintado no
 * lance y que cada rol vea exactamente lo que le toca. */
const PANTALLA_JS=(fs.readFileSync(path.join(REPO,'produccion-maquinaria.html'),'utf8')
                     .match(/<script>([\s\S]*?)<\/script>/)||[])[1];
// `STATE`/`MAQPROG` son `let`: en un script de vm no cuelgan del contexto, así que se expone un
// puente al FINAL del script real (no lo modifica: solo añade una línea) para poder sembrar un día
// de datos y pedir el pintado.
const PUENTE = "\n;window.__test={ setProd:function(st,pr){ STATE=st; MAQPROG=pr; render(); } };\n";
function pantalla(rol, usuario, mutar){
  const js = (mutar ? mutar(PANTALLA_JS) : PANTALLA_JS) + PUENTE;
  const nodos={};
  function nodo(id){ return nodos[id] || (nodos[id]={ id:id, innerHTML:'', textContent:'', value:'', className:'', style:{}, onclick:null }); }
  const ctx={ console, JSON, Math, Date, Promise, parseFloat, parseInt, isNaN, Object, String, Array, encodeURIComponent,
    document:{ getElementById:nodo },
    localStorage:{ getItem:function(k){ return k==='rol'?rol:(k==='usuario'?usuario:null); }, setItem:function(){}, removeItem:function(){} },
    fetch:function(){ return Promise.reject(new Error('sin red')); },
    alert:function(){}, confirm:function(){ return false; },
    location:{ href:'' }
  };
  ctx.window=ctx; ctx.globalThis=ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  ctx.window.onload();
  return { ctx:ctx, nodos:nodos,
           // D139b: la pestaña pinta en DOS contenedores — cabecera (resumen/alta/buscador) y lista.
           flota:function(d){ ctx.aplicarFlota(d); return nodo('flotaCont').innerHTML+nodo('flotaLista').innerHTML; },
           lista:function(){ return nodo('flotaLista').innerHTML; },
           cab:function(){ return nodo('flotaCont').innerHTML; } };
}

console.log('\n12 · La pestaña Flota se pinta sin romperse (guard de rol en el cliente)');
{
  // Se ejecuta el <script> REAL de la pantalla con un DOM mínimo. No es una prueba de aspecto: es que
  // el camino de pintado no lance y que el jefe no vea ni un botón de escritura.
  ok('la pantalla trae un <script> propio', !!PANTALLA_JS);
  const datos={ ok:true, fecha:'2026-08-20', tipos:['BULLDOZER','EXCAVADORA'],
    orden_tipo:['BULLDOZER','EXCAVADORA','MOTONIVELADORA','FINISHER','VIBROCOMPACTADOR'],
    fuente:'hoja', historico_maquinaria:5, avisos:['Fila 9 (XX): sin tipo; se tratará como máquina CON producción.'],
    estancias:[
      { id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'propia', notas:"la de Jose 'el flaco'", fila:2, horas_prog:6.4, prog:6.4,
        fecha_ingreso:'2026-01-01', fecha_retiro:'', valida:true, produce:true, vigente:true },
      { id_maquina:'EXC015', tipo:'EXCAVADORA', propiedad:'propia', notas:'', fila:3, horas_prog:6.4, prog:6.4,
        fecha_ingreso:'2026-01-01', fecha_retiro:'', valida:true, produce:true, vigente:true },
      { id_maquina:'CR019', tipo:'VIBROCOMPACTADOR', propiedad:'propia', notas:'ORTIZ', fila:4, horas_prog:6.4, prog:6.4,
        fecha_ingreso:'2026-01-01', fecha_retiro:'', valida:true, produce:false, vigente:true },
      { id_maquina:'BL009', tipo:'BULLDOZER', propiedad:'propia', notas:'Entregada (D136)', fila:5, horas_prog:6.4, prog:6.4,
        fecha_ingreso:'2026-01-01', fecha_retiro:'2026-08-20', valida:true, produce:true, vigente:false },
      { id_maquina:'FNG02', tipo:'FINISHER', propiedad:'propia', notas:'', fila:6, horas_prog:'', prog:6.4,
        fecha_ingreso:'2026-06-01', fecha_retiro:'2026-06-15', valida:true, produce:true, vigente:false },
      { id_maquina:'FNG02', tipo:'FINISHER', propiedad:'propia', notas:'', fila:7, horas_prog:'', prog:6.4,
        fecha_ingreso:'2026-08-03', fecha_retiro:'2026-08-20', valida:true, produce:true, vigente:false },
      { id_maquina:'MO09', tipo:'MOTONIVELADORA', propiedad:'alquilada', notas:'llega el lunes', fila:8, horas_prog:'', prog:5,
        fecha_ingreso:'2026-09-01', fecha_retiro:'', valida:true, produce:true, vigente:false },
      { id_maquina:'XX', tipo:'', propiedad:'', notas:'', fila:9, horas_prog:'', prog:6.4,
        fecha_ingreso:'', fecha_retiro:'', valida:false, produce:true, vigente:false }
    ] };

  const admin=pantalla('admin','admin');
  const hAdmin=admin.flota(datos);
  ok('admin ve el botón de alta',        /DAR DE ALTA UNA MÁQUINA/.test(hAdmin));
  ok('admin ve "Dar de baja" y "Corregir"', /Dar de baja/.test(hAdmin) && /Corregir/.test(hAdmin));
  ok('el resumen dice cuántas hay en obra HOY', /class="k-val">3<\/div><div class="k-lbl">en obra hoy/.test(hAdmin), admin.cab().slice(0,400));
  ok('se muestran los avisos de la hoja',  /Revisar en la hoja \(1\)/.test(hAdmin));
  ok('una nota con comilla no rompe el marcado', hAdmin.indexOf("Jose 'el flaco'")>=0 || hAdmin.indexOf('Jose &#39;')>=0 || hAdmin.indexOf("Jose 'el")>=0);
  ok('el recordatorio de la ventana semiabierta está a la vista', /primer día que ya no estuvo/i.test(hAdmin));

  const jefe=pantalla('jefe','jefe');
  const hJefe=jefe.flota(datos);
  ok('el jefe NO ve el botón de alta',    !/DAR DE ALTA UNA MÁQUINA/.test(hJefe));
  ok('el jefe NO ve dar de baja/corregir/reingreso',
     !/Dar de baja/.test(hJefe) && !/Corregir/.test(hJefe) && !/Reingreso/.test(hJefe));
  ok('el jefe SÍ ve la flota y los avisos', /BL005/.test(hJefe) && /Revisar en la hoja/.test(hJefe));
  ok('y se le dice que es solo lectura',    /solo lectura/i.test(hJefe));
  ok('el jefe no fue expulsado al login',   jefe.ctx.location.href==='');

  const je=pantalla('asistencia_plus','jeisson');
  const hJe=je.flota(datos);
  ok('jeisson entra y edita la flota',      /DAR DE ALTA UNA MÁQUINA/.test(hJe) && je.ctx.location.href==='');
  ok('a jeisson se le esconde la pestaña de producción', je.nodos.tabProd.style.display==='none');
  ok('y arranca en la pestaña de Flota',    je.nodos.panelFlota.style.display==='' && je.nodos.panelProd.style.display==='none');

  const capataz=pantalla('capataz','angel');
  ok('un capataz sale al login',            /index\.html/.test(capataz.ctx.location.href), capataz.ctx.location.href);

  // ---- D139b: la queja real era la presentación. Lo de HOY manda; lo devuelto no estorba. ----
  const lista=admin.lista();
  ok('«En obra hoy» va ANTES que «Ya no están en la obra»',
     lista.indexOf('En obra hoy') >= 0 && lista.indexOf('En obra hoy') < lista.indexOf('Ya no están en la obra'));
  ok('las de hoy salen AGRUPADAS por tipo',
     /BULLDOZER/.test(lista) && /EXCAVADORA/.test(lista) && /VIBROCOMPACTADOR/.test(lista));
  ok('y en el orden del catálogo (bulldozer antes que excavadora)',
     lista.indexOf('>BULLDOZER ') < lista.indexOf('>EXCAVADORA '), 'MAQ_ORDEN_TIPO');
  ok('las devueltas NO se listan hasta abrir el bloque',
     lista.indexOf('BL009')<0 && /Ya no están en la obra/.test(lista),
     'el bloque va plegado: se mira solo si se quiere');
  ok('el bloque plegado dice cuántas son',   /2 máquinas · su histórico en MAQUINARIA se conserva/.test(lista), lista.slice(-400));
  admin.ctx.flTogglePleg('fuera');
  const abierto=admin.lista();
  ok('al abrirlo aparecen las devueltas con su ventana completa',
     /BL009/.test(abierto) && /2026-01-01 → 2026-08-20/.test(abierto));
  ok('FNG02 (2 estancias) ofrece su historial', /2 estancias/.test(abierto));
  ok('«Por llegar» sale aparte',              /Por llegar/.test(abierto) && /MO09/.test(abierto));
  ok('las filas rotas salen arriba del todo, para arreglarlas',
     abierto.indexOf('Filas con problema') >= 0 && abierto.indexOf('Filas con problema') < abierto.indexOf('En obra hoy'));
  ok('la regla de producción nula se dice UNA vez, en el separador del tipo',
     /VIBROCOMPACTADOR.{0,120}sin producción propia/.test(abierto)
     && (abierto.match(/sin producción propia/g)||[]).length===1,
     'por TIPO (D41/D44/D111), no como un chip repetido en cada fila');

  // El buscador filtra sin tocar el resumen (que es el estado de la obra, no el de la búsqueda).
  admin.ctx.flFiltro('EXC');
  const filtrado=admin.lista();
  ok('el buscador filtra la lista',           /EXC015/.test(filtrado) && !/BL005/.test(filtrado));
  ok('y el resumen NO cambia con el filtro',  /class="k-val">3<\/div><div class="k-lbl">en obra hoy/.test(admin.cab()));
  admin.ctx.flFiltro('');

  // La pestaña de Flota es de escritorio: contenedor ancho (mismo criterio que digitadora.html, D83).
  admin.ctx.verTab('flota');
  ok('la pestaña de Flota ensancha el contenedor', /ancho/.test(admin.nodos.contenedor.className), admin.nodos.contenedor.className);
  admin.ctx.verTab('prod');
  ok('la de producción vuelve al ancho de siempre', !/ancho/.test(admin.nodos.contenedor.className));

  // La OTRA mitad del "solo lectura": la pestaña de producción del día (D59/D60/D61/D62 intactos).
  const prod={ fecha:'2026-08-20',
    frentes:[{ proyecto:'3701', bucket:'TERRAPLEN', cc:'02.07', label:'Terraplén', tipo:'terraplen',
      oficial:300, n_maquinas:1, pk_oficial:['14+200'], filas:[{ id_registro:'r1', id_maquina:'BL005',
      actividad:'Terraplén', tipo_equipo:'BULLDOZER', produccion_actual:250, produccion_orig:'', prefill:300,
      otras_actividades:[], pk:'14+200', horas:6.4 }] }],
    otras:[{ id_maquina:'MO03', actividad:'Subbase', produccion_actual:80, unidad:'m3', reporta:'angel', pk:'', horas:6 }],
    flota_produccion:[{ id_maquina:'BL005', tipo:'BULLDOZER', prog:6.4, reportada:true }],
    faltantes:[{ id_maquina:'CR019', tipo:'VIBROCOMPACTADOR', prog:6.4 }] };
  function pintarProd(p){
    prod.frentes.forEach(function(f){ f.filas.forEach(function(r){ r._val=String(r.prefill); }); });
    p.ctx.__test.setProd({ fecha:prod.fecha, frentes:prod.frentes, otras:prod.otras,
                           flota:prod.flota_produccion, faltantes:prod.faltantes, nuevas:[] },
                         { BL005:6.4, CR019:6.4 });
    return p.nodos.resultados.innerHTML;
  }
  const hpJefe=pintarProd(pantalla('jefe','jefe'));
  ok('el jefe NO ve el botón de guardar producción', !/btnGuardar/.test(hpJefe));
  ok('el jefe NO ve inputs de producción',           hpJefe.indexOf('<input')<0, hpJefe.slice(0,300));
  ok('el jefe NO ve "redirigir producción"',         !/redirigir a máquina/.test(hpJefe));
  ok('el jefe NO puede asignar una faltante',        !/Asignar/.test(hpJefe));
  ok('pero SÍ ve el panorama del día',               /BL005/.test(hpJefe) && /CR019/.test(hpJefe) && /FALTA/.test(hpJefe));
  const hpAdmin=pintarProd(pantalla('admin','admin'));
  ok('el admin sigue viendo todo lo editable',
     /btnGuardar/.test(hpAdmin) && /redirigir a máquina/.test(hpAdmin) && /Asignar/.test(hpAdmin) && hpAdmin.indexOf('<input')>=0);
  const hpRes=pintarProd(pantalla('residente','residente'));
  ok('el residente también edita la producción',     /btnGuardar/.test(hpRes) && /redirigir a máquina/.test(hpRes));
}

console.log('\n13 · MUTACIÓN a propósito: comprobar que el arnés no es ciego');
{
  // (a) Si el guard de rol dejara pasar a cualquiera, la sección 1 tendría que fallar.
  const sinGuard=cargarBackend(BASE, HIST, function(src){
    return src.replace('function puedeEscribirFlota_(body){',
                       'function puedeEscribirFlota_(body){ return {ok:true};'); });
  const rj=sinGuard.flotaGuardar(Object.assign({_rol:'jefe', usuario:'jefe', confirmado:true}, ALTA_OK));
  ok('sin el guard de rol, el jefe SÍ escribiría (el arnés lo detectaría)', rj.ok===true,
     'la comprobación del guard no estaría midiendo nada');

  // (b) Si solo se invalidara la hoja y no `_flotaRows`, la lectura posterior devolvería datos viejos.
  const memoRota=cargarBackend(BASE, HIST, function(src){
    const i=src.indexOf('function flotaGuardar(');
    const cabeza=src.slice(0,i), cola=src.slice(i);
    return cabeza + cola.replace("    _flotaRows = undefined;       // memo propio de getFlotaRows_ (la otra memoria)\n", ""); });
  memoRota.flotaEnFecha_('2026-08-20');                       // calienta el memo
  const w=memoRota.flotaGuardar(Object.assign({_rol:'admin', usuario:'admin', confirmado:true}, ALTA_OK));
  ok('sin invalidar `_flotaRows`, la lectura posterior NO ve lo nuevo',
     !(w.estancias||[]).some(function(e){ return e.id_maquina==='MO03'; }),
     'la comprobación de las dos memorias no estaría midiendo nada');

  // (c) Si el detector de parecidos no normalizara, «RT02» entraría sin preguntar.
  const sinNorm=cargarBackend(BASE, HIST, function(src){
    return src.replace("function normMaqClave_(s){ return String(s==null?'':s).replace(/[^A-Za-z0-9]/g,'').toUpperCase(); }",
                       "function normMaqClave_(s){ return String(s==null?'':s).toUpperCase(); }"); });
  const t=sinNorm.flotaGuardar({ _rol:'admin', usuario:'admin', op:'alta',
    id_maquina:'RT02', tipo:'RETROEXCAVADORA', propiedad:'alquilada', fecha_ingreso:'2026-09-01' });
  ok('sin normalizar, «RT02» no encontraría a «RT-02»', !t.sugerencia,
     'la comprobación del detector no estaría midiendo nada');

  // (d) Si el pintado ignorara PUEDE_FLOTA, el jefe vería los botones de escritura.
  const jefeSuelto=pantalla('jefe','jefe', function(js){ return js.split('puede=PUEDE_FLOTA').join('puede=true'); });
  const hSuelto=jefeSuelto.flota({ ok:true, fecha:'2026-08-20', estancias:[
    { id_maquina:'BL005', tipo:'BULLDOZER', propiedad:'propia', notas:'', fila:2, horas_prog:6.4, prog:6.4,
      fecha_ingreso:'2026-01-01', fecha_retiro:'', valida:true, produce:true, vigente:true }], avisos:[] });
  ok('sin el guard del cliente, el jefe SÍ vería los botones', /Dar de baja/.test(hSuelto),
     'la comprobación de solo lectura no estaría midiendo nada');
}

console.log('\n'+(fallos===0 ? '✅ '+casos+' comprobaciones, todas OK' : '❌ '+fallos+' de '+casos+' fallaron'));
process.exit(fallos===0?0:1);

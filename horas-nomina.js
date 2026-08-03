/**
 * TM2 Sur — Clasificador de horas de nómina (D112)
 *
 * QUÉ ES. El código que decide, a partir de la entrada/salida reportadas y del TURNO, cuántas horas
 * van a cada columna del **Parte de Navision**: C ordinarias · D ordinarias Dom/Fest · E extra diurna ·
 * F extra nocturna · G recargo nocturno ordinario · H extra diurna Dom/Fest.
 *
 * POR QUÉ VIVE APARTE. Hasta D112 estas funciones estaban DENTRO de `resumen-asistencia.html`, que es
 * quien genera el Excel del Parte. Al añadir `horas-persona.html` ("Horas por persona", D112) hacía
 * falta el MISMO cálculo en otra pantalla, y copiarlo habría sido la peor decisión posible: esa
 * pantalla existe justamente para responder reclamos de pago ("¿por qué me pagaron esto?"), así que si
 * sus números difirieran del Parte aunque fuera en un decimal, haría daño en vez de servir. Dos copias
 * divergen; una sola fuente, no.
 *
 * REGLA PARA QUIEN VENGA DESPUÉS: aquí NO se ajusta nada "solo para una pantalla". Cualquier cambio de
 * lógica afecta al Parte que se importa a Navision y a la pantalla de reclamos a la vez — se decide
 * aparte (registro de decisiones) y se aplica a las dos por construcción.
 *
 * D112 movió el código SIN CAMBIAR UNA LÍNEA de lógica; la no-regresión se verificó celda a celda con
 * el arnés `backend/pruebas/verificar_refactor_horas.js` (el antes sale de git, no de una
 * transcripción a mano).
 *
 * Se carga con <script src="horas-nomina.js"></script> ANTES del script de la página. No toca el DOM,
 * no hace peticiones y no depende de `auth.js`: son funciones puras sobre los datos que ya trae el
 * backend (`config`, `festivos`, `turnos` + la fila de ASISTENCIA).
 *
 * No entra al precache del service worker (`sw.js`): solo lo usan pantallas que necesitan datos vivos
 * y por eso están fuera de la lista (D49/D82), así que `CACHE_V` no sube por este archivo.
 */

/* ---------- Clasificador de horas (D72, Opción A) ----------
 * La jornada del TURNO reportado es la ORDINARIA; las extras empiezan al pasar la hora de salida del
 * turno (extra = trabajado − programado). Recargo nocturno = horas entre nocturno_desde (19:00, Ley
 * 2466/2025) y las 06:00 del día siguiente. Devuelve, además de las ordinarias/extras, el RECARGO
 * NOCTURNO ORDINARIO (columna G): las horas ordinarias que caen en la ventana nocturna.
 *   Columnas Navision que llena: C ordinarias · E extra diurna · F extra nocturna · G recargo noct ord.
 * `turnoRow`={entrada,salida,descanso_ini,descanso_fin} del turno; si falta, se arma la jornada estándar
 * del día (diurna) → conserva el comportamiento previo para filas sin turno (legacy / faltantes).
 * Las extras se topan a CONFIG.max_extras_dia (2); avisoExtra marca cuando hubo más. Domingo/festivo:
 * todo a ord_domfest + avisoDomFest (las columnas Dom/Fest H–N siguen siendo revisión manual, §6).
 * Verificado por simulación (T1 diurno; T2/T3/T4 nocturnos con cruce de medianoche). */
function round2(n){ return Math.round(n*100)/100; }
function horasNum(hhmm){ if(!hhmm) return null; const p=String(hhmm).split(':'); if(p.length<2) return null; const n=Number(p[0])+Number(p[1])/60; return isNaN(n)?null:n; }
function ovlp(a1,a2,b1,b2){ return Math.max(0, Math.min(a2,b2)-Math.max(a1,b1)); }
// Jornada estándar del día como "turno virtual" (para filas sin turno). L-V 07:00-15:30 (almuerzo), Sáb.
function jornadaPorDefecto(tipoJornada, cfg){
  if(tipoJornada==='sabado') return { entrada:cfg.entrada_sab||'07:00', salida:cfg.salida_sab||'11:30', descanso_ini:'', descanso_fin:'' };
  return { entrada:cfg.entrada_lv||'07:00', salida:cfg.salida_lv||'15:30', descanso_ini:cfg.almuerzo_ini||'12:00', descanso_fin:cfg.almuerzo_fin||'13:00' };
}
// Fila de TURNOS que aplica a (turno, fecha) — misma preferencia por día que el formulario.
// D77: en sábado, un turno SIN variante de sábado usa su horario de semana (lj/lv) como estándar —
// el turno sigue existiendo el sábado aunque no tenga horario propio ese día (antes caía a cand[0]).
function turnoRowFor(turnoNum, fecha, turnos, tipoJornada){
  if(!turnoNum || !turnos || !turnos.length || tipoJornada==='domfest') return null;
  const cand=turnos.filter(t=>String(t.turno)===String(turnoNum)); if(!cand.length) return null;
  const d=String(fecha||'').split('-'); const dow=new Date(Number(d[0]),Number(d[1])-1,Number(d[2])).getDay();
  const dt = dow===6?'sabado':dow===5?'viernes':dow===0?'domingo':'lj';
  const pref = dt==='sabado'?['sabado','lj','lv']:dt==='viernes'?['viernes','lv']:['lj','lv'];
  for(let i=0;i<pref.length;i++){ const m=cand.find(t=>t.tipo_dia===pref[i]); if(m) return m; }
  return cand[0];
}
function clasificarHoras(tipoJornada, entrada, salida, cfg, turnoRow){
  const vacio={ordinarias:0, ord_domfest:0, extra_diurna:0, extra_nocturna:0, recargo_noct_ord:0, extra_domfest:0, domfest_diurna_scomp:0, avisoExtra:false, avisoDomFest:false};
  const e=horasNum(entrada), s0=horasNum(salida);
  if(e==null || s0==null) return vacio;
  const Sact = s0 < e ? s0+24 : s0;                       // cruce de medianoche (nocturnos)
  if(tipoJornada==='domfest'){
    // D81 (enmienda al criterio D72/D77): Dom/Fest = hasta 7h (CONFIG.domfest_tope) en Horas
    // Ordinarias Dom/Fest (col D); lo trabajado DE MÁS va a **Horas extras diurnas Dom/Fest (col H
    // del Parte)** hasta max_extras_dia (2h, corroborado con Navision por el dueño jul-2026). Más
    // allá de 7+2 se avisa (avisoDomFest) para revisión manual. NADA en col L (nada de 0.33/0.67).
    // Descuenta almuerzo si el rango lo cubre (igual que entre semana).
    let tot=Sact-e;
    const almIni=horasNum(cfg.almuerzo_ini||'12:00'), almFin=horasNum(cfg.almuerzo_fin||'13:00');
    if(almIni!=null && almFin!=null && e<=almIni && Sact>=almFin) tot-=(almFin-almIni);
    if(tot<0) tot=0;
    const tope=parseFloat(cfg.domfest_tope); const cap=isNaN(tope)?7:tope;
    const maxCfg=parseFloat(cfg.max_extras_dia); const capE=isNaN(maxCfg)?2:maxCfg;
    const extraDF=Math.min(Math.max(0, tot-cap), capE);
    return { ordinarias:0, ord_domfest:round2(Math.min(tot,cap)), extra_diurna:0, extra_nocturna:0, recargo_noct_ord:0,
      extra_domfest:round2(extraDF), domfest_diurna_scomp:0, avisoExtra:false, avisoDomFest: tot>cap+capE+0.01 };
  }
  // Ventana nocturna [nocturno_desde, nocturno_hasta del día siguiente) — por defecto [19:00, 06:00).
  // D77: el fin de la ventana sale de CONFIG.nocturno_hasta (antes 06:00 fijo). Lo que una extra pase
  // de esa hora cuenta como EXTRA DIURNA (p. ej. turno 4 hasta 06:30 → 1.5h extra noct + 0.5h diurna).
  const nDesde=horasNum(cfg.nocturno_desde||'19:00'), NOC1=nDesde;
  const nHasta=horasNum(cfg.nocturno_hasta||'06:00'), NOC2=(nHasta==null?6:nHasta)+24;
  const jt = turnoRow || jornadaPorDefecto(tipoJornada, cfg);
  const se=horasNum(jt.entrada), ss0=horasNum(jt.salida);
  const schedGross = (ss0<se? ss0+24 : ss0) - se;         // duración bruta programada (incluye descanso)
  // descanso programado como offset desde la entrada del turno
  let biOff=null, bfOff=null; const bi=horasNum(jt.descanso_ini), bf=horasNum(jt.descanso_fin);
  if(bi!=null && bf!=null){ const biL=bi<se?bi+24:bi; let bfL=bf<biL?bf+24:bf; biOff=biL-se; bfOff=bfL-se; }
  // Ancla a la entrada REAL: fin de jornada programada y descanso desplazados por la entrada real e.
  const schedEnd=e+schedGross, bkS=(biOff!=null)?e+biOff:null, bkE=(bfOff!=null)?e+bfOff:null;
  const ordEnd=Math.min(Sact, schedEnd);
  const ordBreak=(bkS!=null)?ovlp(bkS,bkE,e,ordEnd):0;
  const ordinarias=Math.max(0, (ordEnd-e)-ordBreak);
  // recargo nocturno ordinario = horas ordinarias dentro de la ventana nocturna (sin el descanso)
  const ordNocGross=ovlp(e,ordEnd,NOC1,NOC2);
  const ordNocBreak=(bkS!=null)?ovlp(Math.max(bkS,e),Math.min(bkE,ordEnd),NOC1,NOC2):0;
  const recargoNoct=Math.max(0, ordNocGross-ordNocBreak);
  // extras = lo trabajado tras el fin de la jornada programada (topadas a max_extras_dia)
  let extraDiurna=0, extraNocturna=0, avisoExtra=false;
  if(Sact>schedEnd){
    const extraFull=Sact-schedEnd;
    const maxCfg=parseFloat(cfg.max_extras_dia), cap=isNaN(maxCfg)?Infinity:maxCfg;
    avisoExtra=extraFull>cap+0.001; const extra=Math.min(extraFull,cap);
    const exNoc=ovlp(schedEnd, schedEnd+extra, NOC1, NOC2);
    extraNocturna=exNoc; extraDiurna=extra-exNoc;
  }
  return { ordinarias:round2(ordinarias), ord_domfest:0, extra_diurna:round2(extraDiurna<0?0:extraDiurna),
    extra_nocturna:round2(extraNocturna), recargo_noct_ord:round2(recargoNoct), extra_domfest:0, avisoExtra, avisoDomFest:false };
}

function tipoJornadaDeFecha(fechaStr, festivos){
  const d=fechaStr.split('-'); const dt=new Date(Number(d[0]),Number(d[1])-1,Number(d[2]));
  const dow=dt.getDay();
  if((festivos||[]).indexOf(fechaStr)>=0 || dow===0) return 'domfest';
  if(dow===6) return 'sabado';
  return 'lv';
}

// Node (arnés de pruebas) — en el navegador estas funciones ya son globales por el <script>.
if(typeof module==='object' && module.exports){
  module.exports={ round2, horasNum, ovlp, jornadaPorDefecto, turnoRowFor, clasificarHoras, tipoJornadaDeFecha };
}

/* ============================================================================
 * TEMA — claro / oscuro (D149)
 *
 * Dos trabajos, y el orden importa:
 *
 *   1. ANTES DE PINTAR. Este archivo se carga con <script src> en el <head>,
 *      o sea BLOQUEANTE a propósito: aplica `data-tema` en <html> antes de que
 *      el navegador pinte nada. Si se cargara al final, o con defer, se vería
 *      el parpadeo de blanco a negro (o al revés) en cada carga de cada
 *      pantalla. Son ~40 líneas: el bloqueo es despreciable y el parpadeo no.
 *
 *   2. EL INTERRUPTOR. Se inyecta dentro de `.header-user`, que ya existe en
 *      16 de las 18 pantallas. Es el mismo truco que usa offline.js con el chip
 *      de señal (que se mete en `.header-left`), y gracias a eso NO hay que
 *      tocar el marcado de ninguna cabecera: basta con enlazar este archivo.
 *      Donde no hay cabecera —el login y Reparto— queda fijo arriba a la
 *      derecha, sin chocar con el chip porque ese va a la izquierda.
 *
 * SIN ELEGIR NADA no se escribe `data-tema`: manda el modo del teléfono, que
 * es lo que queremos en obra. Muchos Android lo cambian solos con la luz
 * ambiente, así que quien sale al sol se lleva el claro sin tocar nada.
 * ==========================================================================*/
(function(){
  'use strict';
  var LLAVE = 'tm2_tema';   // 'claro' | 'oscuro' | ausente = lo que diga el teléfono

  function leer(){
    try{
      var v = localStorage.getItem(LLAVE);
      return (v === 'claro' || v === 'oscuro') ? v : null;
    }catch(e){ return null; }   // almacenamiento bloqueado: se sigue con el del teléfono
  }

  function aplicar(t){
    if(t) document.documentElement.setAttribute('data-tema', t);
    else  document.documentElement.removeAttribute('data-tema');
  }

  // --- 1. Antes de pintar ---------------------------------------------------
  aplicar(leer());

  // --- 2. El interruptor ----------------------------------------------------
  function temaEfectivo(){
    var t = leer();
    if(t) return t;
    try{
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'claro' : 'oscuro';
    }catch(e){ return 'oscuro'; }
  }

  function montar(){
    if(document.querySelector('.tm2-tema')) return;

    var caja = document.createElement('div');
    caja.className = 'tm2-tema';

    var sol  = document.createElement('button');
    var luna = document.createElement('button');
    sol.type = luna.type = 'button';
    sol.textContent  = '☀';   // ☀
    luna.textContent = '☾';   // ☾
    sol.title  = 'Modo claro';
    luna.title = 'Modo oscuro';
    sol.setAttribute('aria-label','Modo claro');
    luna.setAttribute('aria-label','Modo oscuro');

    function pintar(){
      var t = temaEfectivo();
      sol.setAttribute('aria-pressed',  t === 'claro'  ? 'true' : 'false');
      luna.setAttribute('aria-pressed', t === 'oscuro' ? 'true' : 'false');
    }

    function elegir(t){
      try{ localStorage.setItem(LLAVE, t); }catch(e){}
      aplicar(t);
      pintar();
    }

    sol.addEventListener('click',  function(){ elegir('claro');  });
    luna.addEventListener('click', function(){ elegir('oscuro'); });

    caja.appendChild(sol);
    caja.appendChild(luna);
    pintar();

    // Junto al usuario, arriba a la derecha. Ojo: `.header` es flex con
    // `space-between`, así que meter el interruptor como TERCER hermano lo
    // dejaría flotando en mitad de la cabecera. Por eso se envuelve junto a
    // `.header-user` en un grupo: la cabecera vuelve a tener dos hijos y el
    // interruptor queda pegado al usuario, que es donde lo dibujamos.
    // El envoltorio no rompe nada: `querySelector('.header-user')` sigue
    // encontrándolo, y `#btnMenu` y «Salir» siguen dentro de él.
    var casa = document.querySelector('.header-user');
    if(casa && casa.parentNode){
      var grupo = document.createElement('div');
      grupo.className = 'tm2-tema-grupo';
      casa.parentNode.insertBefore(grupo, casa);
      grupo.appendChild(caja);
      grupo.appendChild(casa);
    } else {
      caja.classList.add('tm2-tema-fijo');
      document.body.appendChild(caja);
    }

    // Si nadie ha elegido, el interruptor sigue al teléfono en vivo.
    try{
      var mq = window.matchMedia('(prefers-color-scheme: light)');
      var alCambiar = function(){ if(!leer()) pintar(); };
      if(mq.addEventListener) mq.addEventListener('change', alCambiar);
      else if(mq.addListener) mq.addListener(alCambiar);
    }catch(e){}
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();

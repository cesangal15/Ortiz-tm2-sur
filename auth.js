/**
 * TM2 Sur — Token de sesión en el cliente (D108, backlog 2.25)
 *
 * Adjunta el token FIRMADO que emitió el backend al entrar (D107) a TODA llamada dirigida al Apps
 * Script, sea GET o POST. Se hace envolviendo `fetch` en vez de tocar los ~60 sitios donde las 13
 * pantallas llaman a la API: así es imposible que se quede una llamada sin token por descuido, que es
 * exactamente el tipo de olvido que deja un agujero abierto.
 *
 * SE CARGA ANTES QUE NADA (incluido offline.js) en todas las páginas que hablan con el backend.
 *
 * POR QUÉ ESTO ARREGLA LO DEL MODO SIN CONEXIÓN: la cola de D82 reenvía con `fetch`, así que el token
 * se pega EN EL MOMENTO DEL ENVÍO, no cuando se capturó el reporte. Un reporte que pasó el fin de
 * semana en el teléfono sube con el token vigente, no con el que hubiera entonces. Y como el token no
 * caduca por reloj (vence por versión, ver D108 en el backend), sigue valiendo días después.
 *
 * El token NO es un secreto que haya que esconder del usuario: es SU sesión, y solo le sirve para
 * hacer lo que su propio rol ya le permite. Lo que impide es fabricarse otro rol o suplantar a otro,
 * porque va firmado con un secreto que nunca sale del servidor.
 */
(function(){
  'use strict';

  var KEY = 'tm2_token';

  function leer(){ try{ return localStorage.getItem(KEY) || ''; }catch(e){ return ''; } }

  // ¿Va dirigida al Apps Script? Se mira por host, no por comparar con una URL cableada: las dos
  // pantallas de asistencias apuntan a un despliegue distinto del de obra (D69, proyectos separados).
  function esAPI(url){ return String(url||'').indexOf('script.google.com/macros/') >= 0; }

  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  if(!_fetch) return;

  window.fetch = function(url, opts){
    try{
      var u = String(url || '');
      var t = leer();
      if(t && esAPI(u)){
        var metodo = String((opts && opts.method) || 'GET').toUpperCase();
        if(metodo === 'POST' && opts && typeof opts.body === 'string'){
          // El cuerpo de esta app siempre es JSON (con Content-Type text/plain, D31). Si por lo que
          // sea no lo fuera, se deja tal cual: mejor que la llamada falle por falta de token a
          // corromper un cuerpo que no entendemos.
          try{
            var b = JSON.parse(opts.body);
            if(b && typeof b === 'object' && !b.token){
              b.token = t;
              opts = Object.assign({}, opts, { body: JSON.stringify(b) });
            }
          }catch(e){ /* cuerpo no-JSON: no se toca */ }
        } else if(u.indexOf('token=') < 0){
          u += (u.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
        }
      }
      return _fetch(u, opts);
    }catch(e){
      return _fetch(url, opts);   // ante cualquier duda, la llamada sale como habría salido sin esto
    }
  };

  window.TM2Auth = {
    get: leer,
    set: function(t){ try{ localStorage.setItem(KEY, String(t||'')); }catch(e){} },
    clear: function(){ try{ localStorage.removeItem(KEY); }catch(e){} },
    /**
     * ¿La respuesta dice que la sesión ya no vale? El backend contesta {ok:false, auth:false} cuando
     * el token falta, está alterado o quedó fuera por versión. Las pantallas de consolidación lo usan
     * para mandar al login en vez de mostrar un error críptico.
     */
    caducada: function(data){ return !!(data && data.ok === false && data.auth === false); }
  };
})();

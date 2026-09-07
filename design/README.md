# Maquetas de presentación del tablero

Dos direcciones de diseño para `../tablero-produccion.html`, la pantalla que
reemplaza la hoja `GRAFICOS` en la presentación mensual a directivos.

| Archivo | Dirección |
|---|---|
| `Main.dc.html` | **Informe · versión larga.** El orden de la reunión: avance del contrato → cómo fue el mes → por qué → día a día. Exporta a PDF paginado. |
| `UnaPantalla.dc.html` | **Una sola pantalla.** Todo en 1440×900 sin scroll, en oscuro, para proyectar como diapositiva. |
| `canvas.json` | Disposición de los dos artboards en el lienzo y las notas. |

Son **maquetas**, no la página en funcionamiento: llevan los datos de agosto
2026 escritos a mano (el último período cerrado con partes de maquinaria),
tomados del mismo cálculo verificado contra `GRAFICOS`. La página real sigue
siendo `../tablero-produccion.html`, que lee los dos Excel.

## Regenerar el lienzo

El resultado sembrado no se versiona. Para volver a construirlo hace falta la
skill `design` de Claude Code:

    node "<base de la skill design>/seed-canvas.mjs" \
      --template "<base de la skill design>/payload.template.html" \
      --out tablero-tm2-sur-presentacion.html \
      --title "Tablero TM2 Sur · Presentación" \
      --artboard Main.dc.html --artboard UnaPantalla.dc.html \
      --canvas canvas.json

Cualquier cambio se hace en los `.dc.html` y se vuelve a sembrar; el archivo de
salida nunca se edita a mano.

# jimny-dash

Animación de mi Jimny 2026 andando por carretera, tierra, montaña y ciudad, hecha para la pantalla del carro.

**En vivo:** https://ignaciojimenezmojica.github.io/jimny-dash/

- La velocidad del paisaje sigue al GPS.
- Cambia sola a atardecer y noche según la altura real del sol.
- El cielo refleja el clima real (sol, nubes, lluvia, tormenta) y la fase de la luna.
- Panel de datos: velocidad actual, promedio y máxima, límite de la calle (OpenStreetMap), viaje, rumbo, hora, clima con lluvia en camino, gasolinera favorita más cercana y destino con distancia, tiempo y hora de llegada.
- Ajustes: odómetro, mantenimiento (cada 3 meses o 5.000 km), costo de gasolina en litros o galones, gasolineras favoritas, destinos guardados, historial de viajes y respaldo.

HTML, CSS y JavaScript puro, sin dependencias. Sin JavaScript la animación igual corre.

## Servicios que usa (gratis, sin clave)

| Servicio | Para qué |
|---|---|
| Open-Meteo | Clima y pronóstico de lluvia |
| OpenStreetMap (Overpass) | Límite de velocidad, tipo de calle y gasolineras |
| OSRM | Distancia y tiempo por carretera a los destinos |
| OpenStreetMap (Nominatim) | Buscar direcciones al guardar un destino |

Todo se guarda en el navegador. La página no tiene servidor propio ni analítica.

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html` | La página (versión de desarrollo) |
| `css/` | Estilos, escenas, carro y clima |
| `js/` | GPS, noche, widgets, calles, gasolineras, destinos, clima, luna, ajustes |
| `svg/` | Dibujos de cada escena |
| `web/` | Manifiesto, service worker e íconos para instalarla como app |
| `construir.py` | Arma la versión final |

## Construir

```
python construir.py
```

Genera:

- `dist/jimny.html`: un solo archivo con todo adentro, para abrir desde una USB (sin GPS: Chrome en Android no da la ubicación a archivos locales).
- `dist/web/`: la versión para publicar en HTTPS e instalar como app.

## GPS en la pantalla del carro

El GPS solo funciona desde HTTPS (o `localhost`). Si Chrome dice "This site can't ask for your permission", hay que apagar la burbuja flotante de la pantalla, aceptar el permiso y volver a encenderla.

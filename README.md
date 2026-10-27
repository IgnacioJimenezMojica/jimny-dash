# jimny-dash

Animación de mi Jimny 2026 andando por carretera, tierra, montaña, pueblo, barriada y ciudad, hecha para la pantalla del carro.

**En vivo:** https://ignaciojimenezmojica.github.io/jimny-dash/

- La velocidad del paisaje sigue al GPS.
- Cambia sola a atardecer y noche según la altura real del sol.
- El cielo refleja el clima real (sol, nubes, lluvia, tormenta) y la fase de la luna.
- Escena automática: aprende la escena que eliges a mano en cada zona, y en lugares nuevos usa el mapa (calle, zona, edificios y tiendas cercanas).
- Gasolina real: separa carretera, ciudad, tranque y tiempo detenido (con o sin aire), aprende el consumo de tus llenados con una regresión y muestra el tanque en rayitas.
- Panel de datos: velocidad actual, promedio y máxima, límite de la calle (OpenStreetMap), viaje, rumbo, hora, clima con lluvia en camino, gasolinera favorita más cercana y destino con distancia, tiempo y hora de llegada.
- Ajustes en pestañas: controles (GPS, pausa, luz, pantalla completa), qué tarjetas se ven, odómetro con lecturas, caja, mantenimiento (cada 3 meses o 5.000 km), gasolina, llenados, destinos, historial, diagnóstico y respaldo.

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
| `js/` | GPS, noche, widgets, calles, zonas aprendidas, consumo, gasolineras, destinos, clima, luna, ajustes, pantalla completa |
| `svg/` | Dibujos de cada escena |
| `web/` | Manifiesto, service worker e íconos para instalarla como app |
| `construir.py` | Arma la versión final |
| `.github/workflows/publicar.yml` | Publica la versión armada en GitHub Pages con cada push |

## Construir

```
python construir.py
```

Genera:

- `dist/jimny.html`: un solo archivo con todo adentro, para abrir desde una USB (sin GPS: Chrome en Android no da la ubicación a archivos locales).
- `dist/web/`: la versión para publicar en HTTPS e instalar como app.

## Publicar

Con cada push, GitHub Actions corre `construir.py` y publica `dist/web` en GitHub Pages (hay que elegir una vez Settings > Pages > Source: GitHub Actions). Esa versión se instala como app desde Chrome: abre a pantalla completa y sin internet.

## GPS en la pantalla del carro

El GPS solo funciona desde HTTPS (o `localhost`). Si Chrome dice "This site can't ask for your permission", hay que apagar la burbuja flotante de la pantalla, aceptar el permiso y volver a encenderla.

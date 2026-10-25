# jimny-dash

Animación de mi Jimny 2026 andando por carretera, tierra, montaña y ciudad, hecha para la pantalla del carro.

- La velocidad del paisaje sigue al GPS.
- Cambia sola a atardecer y noche según la altura real del sol.
- El cielo refleja el clima real (sol, nubes, lluvia, tormenta) y la fase de la luna.
- Panel de datos: velocidad actual, promedio y máxima, límite de la calle (OpenStreetMap), viaje, rumbo, hora y clima.
- Ajustes: odómetro, mantenimiento (cada 3 meses o 5.000 km), costo de gasolina en litros o galones, historial de viajes y respaldo.

HTML, CSS y JavaScript puro, sin dependencias. Sin JavaScript la animación igual corre.

## Estructura

| Ruta | Qué es |
|---|---|
| `index.html` | La página (versión de desarrollo) |
| `css/` | Estilos, escenas, carro y clima |
| `js/` | GPS, noche, widgets, calles, clima, luna, ajustes |
| `svg/` | Dibujos de cada escena |
| `web/` | Manifiesto, service worker e íconos para instalarla como app |
| `construir.py` | Arma la versión final |

## Construir

```
python construir.py
```

Genera:

- `dist/jimny.html`: un solo archivo con todo adentro, para abrir desde una USB.
- `dist/web/`: la versión para publicar en HTTPS e instalar como app.

## Publicar en Cloudflare Pages

Conectar este repositorio en Cloudflare Pages con:

- Comando de compilación: `python construir.py`
- Carpeta de salida: `dist/web`

El GPS solo funciona desde HTTPS (o `localhost`). Abierta como archivo local, Chrome en Android no da la ubicación.

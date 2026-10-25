"""Une index.html, los CSS, los SVG y el JavaScript en un solo archivo.

Uso:  python construir.py

Genera dos cosas:
  dist/jimny.html   un solo archivo para la USB (no depende de nada más)
  dist/web/         la versión para publicar en HTTPS: la misma página como
                    index.html, más manifiesto, service worker e íconos,
                    para poder instalarla y usarla sin internet
"""
import base64
import hashlib
import re
import shutil
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
SALIDA = RAIZ / "dist" / "jimny.html"
WEB = RAIZ / "dist" / "web"

# Etiquetas que solo van en la versión web (desde la USB darían error al no encontrar los archivos)
ETIQUETAS_WEB = """
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="iconos/icono-192.png">
<link rel="apple-touch-icon" href="iconos/icono-apple-180.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">"""


def svg_a_data_uri(ruta_css: Path, url: str) -> str:
    ruta = (ruta_css.parent / url).resolve()
    datos = base64.b64encode(ruta.read_bytes()).decode("ascii")
    return f'url("data:image/svg+xml;base64,{datos}")'


def incrustar_css(ruta_css: Path) -> str:
    css = ruta_css.read_text(encoding="utf-8")
    return re.sub(
        r'url\("([^"]+\.svg)"\)',
        lambda m: svg_a_data_uri(ruta_css, m.group(1)),
        css,
    )


def main() -> None:
    html = (RAIZ / "index.html").read_text(encoding="utf-8")

    def reemplazar_link(m: re.Match) -> str:
        ruta_css = RAIZ / m.group(1)
        return "<style>\n" + incrustar_css(ruta_css) + "</style>"

    html, n = re.subn(r'<link rel="stylesheet" href="([^"]+)">', reemplazar_link, html)

    def reemplazar_script(m: re.Match) -> str:
        return "<script>\n" + (RAIZ / m.group(1)).read_text(encoding="utf-8") + "</script>"

    html, ns = re.subn(r'<script src="([^"]+)"></script>', reemplazar_script, html)
    SALIDA.parent.mkdir(exist_ok=True)
    SALIDA.write_text(html, encoding="utf-8")
    print(f"Listo: {SALIDA} ({SALIDA.stat().st_size / 1024:.0f} KB, {n} hojas de estilo y {ns} scripts incrustados)")
    construir_web(html)


def construir_web(html: str) -> None:
    if WEB.exists():
        shutil.rmtree(WEB)
    (WEB / "iconos").mkdir(parents=True)

    html_web = html.replace("</title>", "</title>" + ETIQUETAS_WEB, 1)
    (WEB / "index.html").write_text(html_web, encoding="utf-8")

    manifiesto = (RAIZ / "web" / "manifest.webmanifest").read_text(encoding="utf-8")
    (WEB / "manifest.webmanifest").write_text(manifiesto, encoding="utf-8")

    for icono in sorted((RAIZ / "web" / "iconos").glob("*.png")):
        shutil.copy2(icono, WEB / "iconos" / icono.name)

    # La versión del service worker es una huella del contenido: si algo cambia,
    # el carro descarga la versión nueva y borra la vieja
    huella = hashlib.sha256((html_web + manifiesto).encode("utf-8")).hexdigest()[:10]
    sw = (RAIZ / "web" / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", huella)
    (WEB / "sw.js").write_text(sw, encoding="utf-8")
    print(f"Listo: {WEB} (versión {huella}). Esa carpeta es la que se publica.")


if __name__ == "__main__":
    main()

# Total Copy URL (MVP)

Herramienta local para copiar páginas web.

## Qué hace
1. **Guardar URL como HTML** con todos sus recursos (CSS, imágenes, fuentes, srcset, fondos CSS, @import) y rutas relativas. Por defecto guarda el DOM ya renderizado sin JavaScript (copia estática fiel); opcionalmente conserva los scripts.
2. **Capturas PNG** de página completa en escritorio (1440px), tablet (iPad) y móvil (iPhone 13).
3. **Exportar una sección**: selecciónala con el ratón en la vista previa y descarga un .zip con:
   - `index.html` de la sección (con el esqueleto de contenedores padre para que los selectores sigan aplicando)
   - `section.css` con **solo** las reglas que le afectan, conservando `@media`, `@supports`, `@container`, `@font-face` y `@keyframes` usados
   - `assets/` con únicamente las imágenes y fuentes de esa sección
   - `react/Section.jsx` y `astro/Section.astro`
   - `tailwind/index.html` y `tailwind/Section.jsx`: la sección reescrita con clases de Tailwind (mobile-first, `md:` 768px y `lg:` 1280px) a partir de los estilos calculados en cada ancho
   - `figma/figma.json`: la sección como capas para Figma (escritorio, tablet y móvil)
   - PNG de la sección en escritorio, tablet y móvil

## Exportar a Figma
La herramienta genera un `figma.json` (de una sección o de la página completa con «Página para Figma») y un plugin lo importa como capas editables: frames, textos con su fuente, imágenes, SVG, bordes, radios y sombras, en tres frames (escritorio 1440, tablet 768 y móvil 390).

Instalar el plugin (una sola vez, en Figma de escritorio):
1. Descarga «Plugin de Figma» desde la interfaz (o usa la carpeta `figma-plugin/`) y descomprímelo.
2. En Figma: menú **Plugins → Development → Import plugin from manifest…** y elige `figma-plugin/manifest.json`.
3. Ejecuta **Plugins → Development → Total Copy URL – Importar**, elige el `figma.json` y pulsa Importar.

Si una fuente no está instalada en tu equipo, el plugin usa Inter. Las posiciones son absolutas (sin auto layout).

## Uso
```bash
npm install      # instala dependencias y Chromium para Playwright
npm start        # abre http://localhost:4321
```
Las capturas se guardan en `data/`.

## Limitaciones conocidas (Tailwind)
- Los breakpoints originales se aproximan a los de Tailwind (móvil, md 768px, lg 1280px).
- Los estados `:hover`/`:focus` y los pseudo-elementos `::before`/`::after` aún no se convierten.
- Los valores salen como clases arbitrarias (`p-[40px]`); un paso futuro puede mapearlos a la escala de Tailwind.

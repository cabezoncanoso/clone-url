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
   - PNG de la sección en escritorio, tablet y móvil

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

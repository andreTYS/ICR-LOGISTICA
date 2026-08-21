# Frontend — panel web

HTML/JS puro (sin framework, sin build step para *servir* el panel). El único
build step es opcional y solo hace falta si vas a **tocar clases de Tailwind**
en `index.html` o `app.js`: `style.css` está pre-compilado y committeado, así
que el backend puede servir `frontend/` tal cual, sin depender de ningún CDN
en producción.

## Regenerar `style.css` tras editar clases de Tailwind

```bash
cd frontend
npm install       # instala tailwindcss + @tailwindcss/cli (una vez)
npm run build:css # compila tailwind.input.css -> style.css
```

Usa `npm run watch:css` durante desarrollo para recompilar en cada guardado.

## Paleta

Definida como theme de Tailwind en `tailwind.input.css`:

| Token          | Hex       | Uso                                  |
|----------------|-----------|---------------------------------------|
| `navy-950`     | `#00004C` | Sidebar, botones primarios, títulos   |
| `navy-900`     | `#000073` | Degradado del sidebar, hover de botón |
| `accent`       | `#00B7C2` | Enlaces, foco, acentos                |
| `accent-400`   | `#00FFC2` | Degradado de marca / nav activo       |

Los colores semánticos (éxito, error, alerta) se mantienen en verde/rojo
estándar de Tailwind por legibilidad, independientemente de la paleta de marca.

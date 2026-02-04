# ak-web

Personal website — developer portfolio and photography gallery.

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build to `dist/`
- `npm run preview` — Preview production build locally

## Architecture

- **Vanilla HTML/CSS/JS** — No framework. Multi-page Vite setup.
- **Multi-page**: Each page (`index.html`, `gallery/index.html`, `blog/index.html`) is a separate Vite entry point configured in `vite.config.js`.
- **CSS architecture**: `src/css/` contains modular stylesheets — `reset.css`, `tokens.css` (design tokens), `base.css` (typography), `layout.css` (page grid), `components.css`.
- **Dark-first theme**: Default dark palette with `prefers-color-scheme: light` override in `tokens.css`.
- **Deployed to Cloudflare Pages** via `wrangler.toml`.

## Conventions

- BEM-style class naming: `.block__element`, `.block__element--modifier`
- CSS custom properties defined in `tokens.css`
- Semantic HTML with ARIA landmarks
- No build-time templating — layout is duplicated across HTML files
- Font: Space Mono (Google Fonts, loaded via `<link>`)

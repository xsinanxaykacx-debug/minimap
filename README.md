# AYTAR Lab

This repository is the isolated development laboratory for AYTAR.

## Safety boundary
- Production remains in `xsinanxaykacx-debug/istanbul-nokta` (`aytar.vercel.app`).
- Do not make experimental changes in the production repository.
- Develop each feature on a dedicated branch and submit a pull request for review.
- Deploy this repository only to a separate Vercel Preview/project, never to the production AYTAR project.

## Stack
- React 19 + TypeScript + Vite
- MapLibre GL JS
- CARTO basemap styles (no API key required for the starter map)

## Local development
```bash
npm install
npm run dev
npm run build
```

Copy `.env.example` to `.env.local` and fill in optional service keys when needed.

## Initial scope
1. Stable map shell and responsive controls
2. Layer registry for pins, earthquakes, and traffic cameras
3. Data adapters kept separate from map rendering
4. No production credentials or production deployment targets in this repository

# Monorepo Migration — Cook Plan

## Overview

Move the existing FloraClin app into `web/` subfolder and create a new `site/` project for the landing page. pnpm workspaces monorepo.

## Group 0 — Create branch (sequential)

### Task 0: New branch
- `git checkout -b feat/monorepo main`

## Group 1 — Move app to web/ (sequential, cannot parallelize)

### Task 1A: Move all app files to web/
- `mkdir web`
- Move everything EXCEPT: `.git/`, `docs/`, `README.md`, `.gitignore`, root config that should stay
- Files to move: `src/`, `public/`, `e2e/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.*`, `postcss.config.*`, `components.json`, `docker-compose.test.yml`, `.env.local`, `.env.test`
- NOT moved: `.git/`, `docs/`, `node_modules/` (regenerated), `.claude/`
- Use `git mv` to preserve history

### Task 1B: Update web/package.json
- Change `name` from `floraclin` to `@floraclin/web`
- Keep all dependencies as-is
- Keep all scripts as-is

### Task 1C: Verify web/ builds
- `cd web && pnpm install && pnpm build`

## Group 2 — Root monorepo setup (depends on Group 1)

### Task 2A: Create root package.json
**Creates:** `package.json` (root)
```json
{
  "name": "floraclin",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @floraclin/web dev",
    "dev:site": "pnpm --filter @floraclin/site dev",
    "build": "pnpm -r build",
    "build:web": "pnpm --filter @floraclin/web build",
    "build:site": "pnpm --filter @floraclin/site build",
    "test": "pnpm --filter @floraclin/web test",
    "lint": "pnpm --filter @floraclin/web lint"
  }
}
```

### Task 2B: Create pnpm-workspace.yaml
**Creates:** `pnpm-workspace.yaml`
```yaml
packages:
  - 'web'
  - 'site'
```

### Task 2C: Create root .gitignore
**Modifies:** `.gitignore` (root)
- Ensure `node_modules/` covers both root and packages
- Keep existing entries

### Task 2D: Root tsconfig (optional)
- Not needed — each project has its own

## Group 3 — Create site/ project (depends on Group 2)

### Task 3A: Initialize site/ with Next.js
**Creates:** `site/` folder with:
- `package.json` (name: `@floraclin/site`)
- `tsconfig.json`
- `next.config.ts`
- `tailwind.config.ts` / `postcss.config.mjs`
- `src/app/layout.tsx` (root layout with design tokens)
- `src/app/page.tsx` (landing page)
- `src/app/globals.css` (design tokens from landing page plan)
- `public/` (copy brand assets from web/public/brand/)

### Task 3B: Landing page sections
**Creates:** Components in `site/src/components/`:
- `navigation.tsx`
- `hero.tsx`
- `how-it-works.tsx`
- `features.tsx`
- `testimonial.tsx`
- `cta-banner.tsx`
- `faq.tsx`
- `footer.tsx`

## Group 4 — Verify everything (depends on Group 3)

### Task 4A: Install all dependencies
- `cd /root && pnpm install`
- Verify both `web/` and `site/` resolve dependencies

### Task 4B: Build both projects
- `pnpm build:web`
- `pnpm build:site`

### Task 4C: Run web tests
- `pnpm test`

## Critical Notes

1. **git mv preserves history** — use it for all moves
2. **Vercel config** — web/ deploys to `app.floraclin.com.br`, site/ deploys to `floraclin.com.br`. Separate Vercel projects pointing to same repo with different root directories.
3. **.env.local** — each project has its own. Web keeps the existing one. Site gets a minimal one.
4. **CLAUDE.md** — stays at root, update paths to reference `web/src/`
5. **docs/** — stays at root (shared)
6. **node_modules** — pnpm workspaces hoists to root by default

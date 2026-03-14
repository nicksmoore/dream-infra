# Contributing to Dream Infra

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository and clone it locally.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Start the dev server:
   ```sh
   npm run dev
   ```

## Project Structure

```
src/
├── components/       # React UI components
├── contexts/         # React context providers (Auth, etc.)
├── hooks/            # Custom React hooks
├── lib/              # Core logic (DAG resolver, intent parser, engine)
├── pages/            # Route-level page components
├── integrations/     # Supabase client & types (auto-generated, do not edit)
supabase/
├── functions/        # Edge functions (uidi-engine, orchestrator, etc.)
```

## Development Guidelines

- **TypeScript** — All code must be fully typed. No `any` unless absolutely necessary.
- **Tailwind CSS** — Use semantic design tokens from `index.css` and `tailwind.config.ts`. Do not hardcode colors.
- **Components** — Keep components small and focused. Use shadcn/ui primitives where possible.
- **State** — Prefer React Query for server state and React context for auth/global state.

## Making Changes

1. Create a feature branch from `main`:
   ```sh
   git checkout -b feat/your-feature
   ```
2. Make your changes with clear, atomic commits.
3. Run linting before pushing:
   ```sh
   npm run lint
   ```
4. Open a Pull Request against `main` with a clear description of what changed and why.

## Edge Functions

Backend logic lives in `supabase/functions/`. Each function is auto-deployed. When modifying:

- Keep functions focused on a single responsibility.
- Handle errors gracefully and return structured JSON responses.
- Never commit secrets — use environment variables.

## Do Not Edit

These files are auto-generated and should **never** be modified manually:

- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/types.ts`
- `supabase/config.toml`
- `.env`

## Reporting Issues

Open a GitHub Issue with:

- A clear title and description
- Steps to reproduce (if applicable)
- Expected vs. actual behavior
- Screenshots or console logs when relevant

## Code of Conduct

Be respectful, constructive, and inclusive. We're all here to build something great.

# Digital Autopilot Detector

A monorepo for detecting "autopilot" behavior (Doomscrolling/Distraction) utilizing heuristic analysis and ML.

## Technologies Used

* **Monorepo Manager:** Turborepo, Bun
* **Frontend:** Next.js 15, React, Tailwind CSS (in `apps/web`)
* **Backend:** NestJS 11, Socket.io, BullMQ (in `apps/api`)
* **Database & ORM:** PostgreSQL (via Supabase), Prisma
* **Caching & Queue:** Redis
* **Authentication:** Custom JWT Strategy with `argon2` hashing
* **Chrome Extension:** Built with Manifest V3 + Vite (to be built in `apps/extension`)

## Getting Started

### Prerequisites
* [Bun](https://bun.sh/)
* PostgreSQL DB logic (Supabase recommended)
* Redis Server

### Setup
1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```
3. Enter `apps/api` and update your `.env` variables from `.env.example`
4. Run Prisma database generation:
   ```bash
   cd apps/api && bunx prisma generate
   ```

### Running Locally
To launch development environments across the workspace:
```bash
bun run dev
```

Learn more about the power of Turborepo:

- [Tasks](https://turborepo.dev/docs/crafting-your-repository/running-tasks)
- [Caching](https://turborepo.dev/docs/crafting-your-repository/caching)
- [Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching)
- [Filtering](https://turborepo.dev/docs/crafting-your-repository/running-tasks#using-filters)
- [Configuration Options](https://turborepo.dev/docs/reference/configuration)
- [CLI Usage](https://turborepo.dev/docs/reference/command-line-reference)
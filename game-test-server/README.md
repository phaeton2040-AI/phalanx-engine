# Game Test Server

A standalone server for Phalanx Engine game testing, ready for Heroku deployment.

## Local Development

```bash
# From monorepo root
pnpm install

# Run in development mode
pnpm dev:game-server

# Or from this directory
pnpm dev
```

## Build

```bash
# From monorepo root
pnpm build:game-server

# Or from this directory
pnpm build
```

## Heroku Deployment

This server is designed to be deployed from the **monorepo root**, not as a standalone project.

### Prerequisites

1. Install Heroku CLI: https://devcenter.heroku.com/articles/heroku-cli
2. Login to Heroku: `heroku login`

### Deploy Steps

```bash
# Navigate to monorepo root
cd /path/to/phalanx-engine-main

# Create a new Heroku app
heroku create your-game-server-name

# Enable pnpm buildpack (required for pnpm workspaces)
heroku buildpacks:set https://github.com/pnpm/heroku-buildpack-pnpm

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set CORS_ORIGINS=https://your-client-domain.com

# Deploy
git push heroku main
```

### Updating Deployment

```bash
# After making changes
git add .
git commit -m "Your changes"
git push heroku main
```

### View Logs

```bash
heroku logs --tail
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port (set automatically by Heroku) | `3000` |
| `NODE_ENV` | Environment mode | `development` |
| `CORS_ORIGINS` | Comma-separated list of allowed CORS origins | `http://localhost:3001,http://localhost:5173` |

## Scripts

- `pnpm dev` - Run server in development mode with hot reload
- `pnpm build` - Compile TypeScript to JavaScript
- `pnpm start` - Run compiled server (production)
- `pnpm clean` - Remove build artifacts

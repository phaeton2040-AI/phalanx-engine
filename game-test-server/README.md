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

| Variable               | Description                                    | Default                                       |
| ---------------------- | ---------------------------------------------- | --------------------------------------------- |
| `PORT`                 | Server port (set automatically by Heroku)      | `3000`                                        |
| `NODE_ENV`             | Environment mode                               | `development`                                 |
| `CORS_ORIGINS`         | Comma-separated list of allowed CORS origins   | `http://localhost:3001,http://localhost:5173` |
| `GOOGLE_CLIENT_ID`     | Google OAuth Client ID for JWT authentication  | (none - auth disabled)                        |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret for token exchange  | (none)                                        |

### Authentication

The server supports Google OAuth authentication with secure server-side token exchange.

**How it works:**
1. Client redirects user to Google OAuth with PKCE
2. User authenticates and is redirected back with an authorization code
3. Client sends the code to `/auth/token` endpoint on this server
4. Server exchanges the code for tokens using the `client_secret` (kept secure on server)
5. Server returns the ID token to the client
6. Client uses the ID token for WebSocket authentication

**Setup:**
```bash
# Set both client ID and secret
heroku config:set GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
heroku config:set GOOGLE_CLIENT_SECRET=your-client-secret

# Or in .env file for local development
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

**Important:** Never expose the `GOOGLE_CLIENT_SECRET` in client-side code!

## Scripts

- `pnpm dev` - Run server in development mode with hot reload
- `pnpm build` - Compile TypeScript to JavaScript
- `pnpm start` - Run compiled server (production)
- `pnpm clean` - Remove build artifacts

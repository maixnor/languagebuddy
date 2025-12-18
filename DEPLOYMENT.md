# LanguageBuddy Deployment Guide

This guide covers deploying both the backend API and frontend static site for LanguageBuddy.

## Prerequisites

- Nix package manager installed
- `just` command runner installed
- SSH access to your deployment server
- rsync installed

## Quick Start

From the root directory:

```bash
# Deploy everything to production
just deploy-all-prod

# Deploy everything to test
just deploy-all-test

# Deploy only backend
just deploy-backend-prod

# Deploy only frontend
just deploy-frontend-prod
```

## Configuration

### Server Paths

Edit the root `justfile` to configure your server and paths:

```justfile
FRONTEND_SERVER := "your-server.com"
FRONTEND_PROD_PATH := "/var/www/languagebuddy/prod/static"
FRONTEND_TEST_PATH := "/var/www/languagebuddy/test/static"
```

**Note:** The frontend is deployed to the backend's `static/` directory, so the backend serves the frontend files.

### Backend Configuration

Backend deployment is configured in the root `flake.nix`. The deployment script:
- Uses `fzf` to select a commit for production deployments
- Backs up and restores `.env.prod` file
- Builds with Nix
- Deploys via rsync
- Restarts the systemd service

### Frontend Configuration

Frontend is a static Astro site that gets deployed to the backend's `static/` directory. The deployment:
- Builds the site with Nix (outputs to `dist/`)
- Copies static files to backend's static directory via rsync (with `--no-perms --no-owner --no-group` to avoid permission issues)
- Backend serves the frontend via Express static middleware and dedicated routes
- No separate web server needed (backend serves everything)

## Server Setup

### Backend Serves Frontend

The backend Express server serves the frontend static files from its `static/` directory. No separate Nginx configuration is needed for the frontend - the backend handles everything:

- `/` → serves `static/index.html` (landing page)
- `/privacy` → serves `static/privacy.html`
- `/impressum` → serves `static/impressum.html`
- `/static/*` → serves all static assets (CSS, JS, images)

### Create Deployment Directories

On your server:

```bash
sudo mkdir -p /var/www/languagebuddy/{prod,test}/static
sudo chown -R maixnor:languagebuddy /var/www/languagebuddy
# OR if you want user ownership:
sudo chown -R maixnor:maixnor /var/www/languagebuddy
```

### Backend (Systemd Service)

Backend already uses systemd services. See backend deployment documentation.

## Available Commands

### Root Directory

```bash
# Deployment
just deploy-all-prod          # Deploy everything to prod
just deploy-all-test          # Deploy everything to test
just deploy-backend-prod      # Deploy only backend to prod
just deploy-backend-test      # Deploy only backend to test
just deploy-frontend-prod     # Deploy only frontend to prod
just deploy-frontend-test     # Deploy only frontend to test

# Building
just build-all                # Build both backend and frontend
just build-frontend           # Build only frontend

# Development
just dev-backend              # Start backend dev server
just dev-frontend             # Start frontend dev server

# Utilities
just clean                    # Clean all build artifacts
just logs-backend-prod        # Stream backend production logs
just logs-backend-test        # Stream backend test logs
```

### Backend Directory

```bash
cd backend
just run                      # Build and start
just test                     # Build and test
just deploy-prod              # Deploy to production
just stream-logs prod         # Stream production logs
```

### Frontend Directory

```bash
cd frontend
just dev                      # Start dev server
just build                    # Build for production
just preview                  # Preview production build
just deploy-prod              # Deploy to production
just clean                    # Clean build artifacts
```

## Development Workflow

1. **Local Development**
   ```bash
   # Terminal 1 - Backend
   cd backend && npm run dev
   
   # Terminal 2 - Frontend
   cd frontend && npm run dev
   ```

2. **Test Your Changes**
   ```bash
   # Backend tests
   cd backend && npm test
   
   # Frontend build test
   cd frontend && npm run build
   ```

3. **Deploy to Test Environment**
   ```bash
   just deploy-all-test
   ```

4. **Deploy to Production**
   ```bash
   just deploy-all-prod
   ```

## Deployment Process Details

### Backend Deployment

1. For production: Select commit with `fzf`
2. Backup `.env.prod` file
3. Create git worktree for selected commit
4. Build with Nix
5. Copy built artifacts and `.env.prod` to temp directory
6. Rsync to server
7. Restart systemd service
8. Cleanup worktree
9. Update `deployed-prod` git tag to the deployed commit

### Backend Test Deployment

1. Ensure git working directory is clean (no uncommitted changes)
2. Build from current HEAD
3. Deploy to test server
4. Restart test service
5. Update `deployed-test` git tag to HEAD

1. Build static site with Nix (`npm run build` → `dist/`)
2. Copy all static files from Nix result
3. Rsync to server's backend static directory (with `--no-perms --no-owner --no-group`)
4. Backend automatically serves new files (no restart needed)

## Troubleshooting

### Nix Build Issues

```bash
# Clean and rebuild
cd frontend && rm -rf node_modules package-lock.json result
npm install
nix build .
```

### Rsync Permission Issues

Ensure your user has write permissions to deployment directories:

```bash
# On server
sudo chown -R maixnor:languagebuddy /var/www/languagebuddy
# OR
sudo chown -R maixnor:maixnor /var/www/languagebuddy
```

The deployment uses `--no-perms --no-owner --no-group` flags to avoid permission errors.

### Backend Service Not Starting

Check systemd logs:

```bash
ssh your-server "sudo journalctl -u languagebuddy-api-prod.service -n 50"
```

### Frontend 404 Errors

The backend serves the frontend. Check that:
1. Files are in `/var/www/languagebuddy/{prod|test}/static/`
2. Backend is running and serving static files
3. Check backend logs for file serving errors

## SSL/HTTPS Setup

If using Nginx as a reverse proxy to the backend, use Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

The backend serves both API and frontend, so you only need one SSL certificate.

## Monitoring

- **Backend**: Use systemd logs (`journalctl`) and your observability stack (Tempo/Loki)
- **Frontend**: Check backend logs for static file serving (included in backend logs)
- Set up uptime monitoring (e.g., UptimeRobot, Pingdom)

## Rollback

### Backend

Deploy a previous commit:

```bash
just deploy-backend-prod
# Select previous commit from fzf menu
```

### Frontend

Redeploy a previous version:

```bash
# Build from a specific commit
cd frontend
git checkout <previous-commit>
nix build .
cd ..
just deploy-frontend-prod
```

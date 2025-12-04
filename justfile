# Root justfile for LanguageBuddy project

# Variables - CONFIGURE THESE FOR YOUR SERVER
FRONTEND_SERVER := "wb.maixnor.com"
FRONTEND_PROD_PATH := "/var/www/languagebuddy/web"
FRONTEND_TEST_PATH := "/var/www/languagebuddy/web"

# Show available commands
default:
  @just --list

# === Backend Commands ===

# Deploy backend to production
deploy-backend-prod:
  nix run .#deploy-prod

# Deploy backend to test
deploy-backend-test:
  nix run .#deploy-test

# === Frontend Commands ===

# Build frontend with Nix
build-frontend:
  cd frontend && nix build .

# Deploy frontend to production
deploy-frontend:
  nix run .#deploy-frontend

# Build everything
build-all:
  @echo "📦 Building backend..."
  cd backend && nix build .
  @echo "📦 Building frontend..."
  cd frontend && nix build .
  @echo "✅ All builds completed!"

# Deploy everything to production
deploy-all-prod:
  @echo "🚀 Deploying all services to production..."
  just deploy-backend-prod
  just deploy-frontend-prod
  @echo "✅ All production deployments completed!"

# Deploy everything to test
deploy-all-test:
  @echo "🚀 Deploying all services to test..."
  just deploy-backend-test
  just deploy-frontend
  @echo "✅ All test deployments completed!"

# === Development Commands ===

# Start backend dev server
dev-backend:
  cd backend && npm run dev

# Start frontend dev server
dev-frontend:
  cd frontend && npm run dev

# Start both dev servers (requires tmux or separate terminals)
dev-all:
  @echo "⚠️  This requires running in separate terminals:"
  @echo "  Terminal 1: just dev-backend"
  @echo "  Terminal 2: just dev-frontend"

# === Utility Commands ===

# Clean all build artifacts
clean:
  cd backend && rm -rf dist node_modules result
  cd frontend && rm -rf dist node_modules result
  @echo "✅ Cleaned all build artifacts"

# Stream backend production logs
logs-backend-prod:
  cd backend && just stream-logs prod

# Stream backend test logs
logs-backend-test:
  cd backend && just stream-logs test


# Root justfile for LanguageBuddy project

# Variables - CONFIGURE THESE FOR YOUR SERVER
FRONTEND_SERVER := "wb.maixnor.com"
FRONTEND_PROD_PATH := "/var/www/languagebuddy/prod/static"
FRONTEND_TEST_PATH := "/var/www/languagebuddy/test/static"

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
deploy-frontend-prod: build-frontend
  #!/usr/bin/env bash
  set -e
  echo "🚀 Starting frontend production deployment..."
  
  # Create temporary directory for deployment
  TEMP_DIR=$(mktemp -d)
  echo "📁 Using temporary directory: $TEMP_DIR"
  
  # Copy built artifacts from Nix result
  echo "📋 Copying built artifacts..."
  if [ -L frontend/result ]; then
    cp -rL frontend/result/* "$TEMP_DIR/"
  else
    cp -r frontend/result/* "$TEMP_DIR/"
  fi
  
  # Deploy to server
  echo "🌐 Deploying to production server..."
  # First, remove old read-only directories if they exist and fix permissions
  ssh "{{FRONTEND_SERVER}}" "sudo rm -rf {{FRONTEND_PROD_PATH}}/_astro {{FRONTEND_PROD_PATH}}/impressum {{FRONTEND_PROD_PATH}}/privacy 2>/dev/null || true && sudo mkdir -p {{FRONTEND_PROD_PATH}} && sudo chown -R languagebuddy:languagebuddy {{FRONTEND_PROD_PATH}} && sudo chmod -R u+rwX,g+rwX {{FRONTEND_PROD_PATH}}"
  # Deploy with rsync
  rsync -az --no-perms --no-owner --no-group --no-times --omit-dir-times "$TEMP_DIR/" "{{FRONTEND_SERVER}}:{{FRONTEND_PROD_PATH}}/"
  # Fix ownership and permissions after deployment
  ssh "{{FRONTEND_SERVER}}" "sudo chown -R languagebuddy:languagebuddy {{FRONTEND_PROD_PATH}} && sudo chmod -R u+rwX,g+rwX {{FRONTEND_PROD_PATH}}"
  
  # Cleanup
  rm -rf "$TEMP_DIR"
  
  echo "✅ Frontend production deployment completed successfully!"
  echo "📍 Deployed to: {{FRONTEND_SERVER}}:{{FRONTEND_PROD_PATH}}"

# Deploy frontend to test
deploy-frontend-test: build-frontend
  #!/usr/bin/env bash
  set -e
  echo "🚀 Starting frontend test deployment..."
  
  # Create temporary directory for deployment
  TEMP_DIR=$(mktemp -d)
  echo "📁 Using temporary directory: $TEMP_DIR"
  
  # Copy built artifacts from Nix result
  echo "📋 Copying built artifacts..."
  if [ -L frontend/result ]; then
    cp -rL frontend/result/* "$TEMP_DIR/"
  else
    cp -r frontend/result/* "$TEMP_DIR/"
  fi
  
  # Deploy to server
  echo "🌐 Deploying to test server..."
  # First, remove old read-only directories if they exist and fix permissions
  ssh "{{FRONTEND_SERVER}}" "sudo rm -rf {{FRONTEND_TEST_PATH}}/_astro {{FRONTEND_TEST_PATH}}/impressum {{FRONTEND_TEST_PATH}}/privacy 2>/dev/null || true && sudo mkdir -p {{FRONTEND_TEST_PATH}} && sudo chown -R languagebuddy:languagebuddy {{FRONTEND_TEST_PATH}} && sudo chmod -R u+rwX,g+rwX {{FRONTEND_TEST_PATH}}"
  # Deploy with rsync
  rsync -az --no-perms --no-owner --no-group --no-times --omit-dir-times "$TEMP_DIR/" "{{FRONTEND_SERVER}}:{{FRONTEND_TEST_PATH}}/"
  # Fix ownership and permissions after deployment
  ssh "{{FRONTEND_SERVER}}" "sudo chown -R languagebuddy:languagebuddy {{FRONTEND_TEST_PATH}} && sudo chmod -R u+rwX,g+rwX {{FRONTEND_TEST_PATH}}"
  
  # Cleanup
  rm -rf "$TEMP_DIR"
  
  echo "✅ Frontend test deployment completed successfully!"
  echo "📍 Deployed to: {{FRONTEND_SERVER}}:{{FRONTEND_TEST_PATH}}"

# === Combined Commands ===

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
  just deploy-frontend-test
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

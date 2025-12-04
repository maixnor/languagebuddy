{
  description = "LanguageBuddy Project Development Environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { 
          inherit system; 
          config = {
            allowUnfree = true;
          };
        };

        # Build the backend using its own flake
        buildBackend = pkgs.writeShellApplication {
          name = "build-backend";
          runtimeInputs = with pkgs; [ nix ];
          text = ''
            cd backend
            nix build .
          '';
        };

        # Create deployment script
        mkDeployScript = { environment, deployPath, server }: pkgs.writeShellApplication {
          name = "deploy-${environment}";
          runtimeInputs = with pkgs; [ openssh rsync git fzf gnutar ];
          text = ''
            set -e

            SERVER="${server}"
            DEPLOY_PATH="${deployPath}"
            ENVIRONMENT="${environment}"

            echo "🚀 Starting $ENVIRONMENT deployment..."

            # Check if we're in the correct directory
            if [ ! -f "backend/flake.nix" ]; then
                echo "❌ Error: Please run this script from the root of the languagebuddy repository"
                exit 1
            fi

            BUILD_DIR="backend"
            ENV_PROD_BACKUP=""

            # Allow user to select a commit for deployment
            if [ "$ENVIRONMENT" = "prod" ]; then
                COMMIT=$(git log --oneline -n 50 | fzf --prompt "Select commit: " | awk '{ print $1 }')
                if [ -z "$COMMIT" ]; then
                    echo "❌ No commit selected, aborting deployment"
                    exit 1
                fi
                echo "📌 Selected commit: $COMMIT"
                
                # Save .env.prod file path
                if [ -f "backend/.env.prod" ]; then
                    ENV_PROD_BACKUP=$(mktemp)
                    cp "backend/.env.prod" "$ENV_PROD_BACKUP"
                    echo "💾 Backed up .env.prod file"
                fi
                
                # Create a temporary directory for the clean source
                TEMP_BUILD_ROOT=$(mktemp -d)
                echo "📦 Extracting commit $COMMIT to $TEMP_BUILD_ROOT..."
                git archive --format=tar "$COMMIT" | tar -x -C "$TEMP_BUILD_ROOT"
                
                BUILD_DIR="$TEMP_BUILD_ROOT/backend"
            fi

            # Build the backend
            echo "📦 Building backend with Nix in $BUILD_DIR..."
            cd "$BUILD_DIR"
            nix build .

            # Create deployment directory
            TEMP_DIR=$(mktemp -d)
            echo "📁 Using temporary directory: $TEMP_DIR"

            # Copy built artifacts
            echo "📋 Copying built artifacts..."
            if [ -L result ]; then
                cp -rL result/* "$TEMP_DIR/"
            else
                cp -r result/* "$TEMP_DIR/"
            fi
            
            # Copy environment file
            if [ "$ENVIRONMENT" = "prod" ]; then
                if [ -n "$ENV_PROD_BACKUP" ]; then
                    echo "📋 Copying production environment file from backup..."
                    cp "$ENV_PROD_BACKUP" "$TEMP_DIR/.env"
                    rm "$ENV_PROD_BACKUP"
                elif [ -f ".env.prod" ]; then
                     echo "📋 Copying production environment file..."
                     cp ".env.prod" "$TEMP_DIR/.env"
                elif [ -f "backend/.env.prod" ]; then
                     echo "📋 Copying production environment file from backend directory..."
                     cp "backend/.env.prod" "$TEMP_DIR/.env"
                else
                    echo "⚠️  Warning: No .env.prod file found for production deployment!"
                fi
            elif [ "$ENVIRONMENT" = "test" ]; then
                if [ -f ".env" ]; then
                     echo "📋 Copying test environment file (.env)..."
                     cp ".env" "$TEMP_DIR/.env"
                elif [ -f "backend/.env" ]; then
                     echo "📋 Copying test environment file (backend/.env)..."
                     cp "backend/.env" "$TEMP_DIR/.env"
                else
                    echo "⚠️  Warning: No .env file found for test deployment!"
                fi
            fi

            # Deploy to server
            echo "🌐 Deploying to $ENVIRONMENT server..."
            # Deploy with rsync (no --delete to avoid permission issues)
            if ! rsync -az --no-perms --no-owner --no-group --no-times --omit-dir-times "$TEMP_DIR/" "$SERVER:$DEPLOY_PATH/"; then
                echo "❌ Error: Deployment failed, aborting"
                exit 1
            fi
            # Fix ownership and permissions
            # shellcheck disable=SC2029
            ssh "$SERVER" "sudo chown -R languagebuddy:languagebuddy $DEPLOY_PATH && sudo chmod -R u+rwX,g+rwX $DEPLOY_PATH"

            # Restart service
            echo "🔄 Restarting $ENVIRONMENT service..."
            # shellcheck disable=SC2029
            if ! ssh "$SERVER" "sudo systemctl restart languagebuddy-api-$ENVIRONMENT.service"; then
                echo "⚠️  Warning: Service restart failed or service not found"
                exit 1
            fi

            echo "📍 Deployed to: $SERVER:$DEPLOY_PATH"
            echo "✅ $ENVIRONMENT deployment completed successfully!"
          '';
        };

        # Create frontend deployment script
        mkFrontendDeployScript = { server, deployPath }: pkgs.writeShellApplication {
          name = "deploy-frontend";
          runtimeInputs = with pkgs; [ openssh rsync ];
          text = ''
            set -e
            SERVER="${server}"
            DEPLOY_PATH="${deployPath}"
            
            echo "🚀 Starting frontend deployment..."
            
            # Check directory
            if [ ! -d "frontend" ]; then
                echo "❌ Error: frontend directory not found. Please run from root."
                exit 1
            fi

            # Build
            echo "📦 Building frontend..."
            cd frontend
            nix build .
            # Return to root to easily handle paths if needed, though we operate on full paths or relative to here
            cd ..

            # Create temp dir
            TEMP_DIR=$(mktemp -d)
            echo "📁 Using temporary directory: $TEMP_DIR"

            # Copy artifacts
            echo "📋 Copying built artifacts..."
            # Handle potential symlink
            if [ -L frontend/result ]; then
                cp -rL frontend/result/* "$TEMP_DIR/"
            else
                cp -r frontend/result/* "$TEMP_DIR/"
            fi

            # Deploy to server
            echo "🌐 Deploying to $SERVER..."
            
            # Pre-deploy cleanup/permissions
            # shellcheck disable=SC2029
            ssh "$SERVER" "sudo rm -rf $DEPLOY_PATH/_astro $DEPLOY_PATH/impressum $DEPLOY_PATH/privacy 2>/dev/null || true && sudo mkdir -p $DEPLOY_PATH && sudo chown -R languagebuddy:languagebuddy $DEPLOY_PATH && sudo chmod -R u+rwX,g+rwX $DEPLOY_PATH"
            
            # Rsync
            if ! rsync -az --no-perms --no-owner --no-group --no-times --omit-dir-times "$TEMP_DIR/" "$SERVER:$DEPLOY_PATH/"; then
                echo "❌ Error: Deployment failed, aborting"
                rm -rf "$TEMP_DIR"
                exit 1
            fi
            
            # Post-deploy permissions
            # shellcheck disable=SC2029
            ssh "$SERVER" "sudo chown -R languagebuddy:languagebuddy $DEPLOY_PATH && sudo chmod -R u+rwX,g+rwX $DEPLOY_PATH"
            
            # Cleanup
            # files from nix store are read-only, so we need to make them writable before deleting
            chmod -R +w "$TEMP_DIR"
            rm -rf "$TEMP_DIR"
            
            echo "✅ Frontend deployment completed successfully!"
            echo "📍 Deployed to: $SERVER:$DEPLOY_PATH"
          '';
        };

      in
      {
        packages = rec {
          backend = buildBackend;
          deploy-prod = mkDeployScript { 
            environment = "prod"; 
            deployPath = "/var/www/languagebuddy/prod"; 
            server = "wb.maixnor.com";
          };
          deploy-test = mkDeployScript { 
            environment = "test"; 
            deployPath = "/var/www/languagebuddy/test"; 
            server = "wb.maixnor.com";
          };
          deploy-frontend = mkFrontendDeployScript {
            server = "wb.maixnor.com";
            deployPath = "/var/www/languagebuddy/web";
          };
          default = backend;
        };
      }
    );
}

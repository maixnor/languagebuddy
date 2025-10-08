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
          runtimeInputs = with pkgs; [ openssh rsync git fzf ];
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

            # Allow user to select a commit for deployment
            if [ "$ENVIRONMENT" = "prod" ]; then
                COMMIT=$(git log --oneline -n 50 | fzf --prompt "Select commit: " | awk '{ print $1 }')
                if [ -z "$COMMIT" ]; then
                    echo "❌ No commit selected, aborting deployment"
                    exit 1
                fi
                echo "📌 Selected commit: $COMMIT"
                
                # Save .env.prod file before creating worktree
                ENV_PROD_BACKUP=""
                if [ -f "backend/.env.prod" ]; then
                    ENV_PROD_BACKUP=$(mktemp)
                    cp "backend/.env.prod" "$ENV_PROD_BACKUP"
                    echo "💾 Backed up .env.prod file"
                fi
                
                # Create a temporary worktree for the selected commit
                TEMP_WORKTREE=$(mktemp -d)
                git worktree add "$TEMP_WORKTREE" "$COMMIT"
                cd "$TEMP_WORKTREE"
                
                # Restore .env.prod file to worktree
                if [ -n "$ENV_PROD_BACKUP" ] && [ -f "$ENV_PROD_BACKUP" ]; then
                    cp "$ENV_PROD_BACKUP" "backend/.env.prod"
                    echo "📋 Restored .env.prod to worktree"
                    rm "$ENV_PROD_BACKUP"
                fi
            fi

            # Build the backend
            echo "📦 Building backend with Nix..."
            cd backend
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
            
            # Copy environment file if it exists
            if [ -f ".env.prod" ]; then
                echo "📋 Copying production environment file..."
                cp ".env.prod" "$TEMP_DIR/.env"
            elif [ -f "backend/.env.prod" ]; then
                echo "📋 Copying production environment file from backend directory..."
                cp "backend/.env.prod" "$TEMP_DIR/.env"
            else
                echo "⚠️  Warning: No .env.prod file found, skipping environment file copy"
                echo "🔍 Current directory: $(pwd)"
                echo "🔍 Looking for: .env.prod and backend/.env.prod"
                ls -la .env* backend/.env* 2>/dev/null || echo "No .env files found"
            fi

            # Deploy to server
            echo "🌐 Deploying to $ENVIRONMENT server..."
            if ! rsync -az --delete --no-perms --no-owner --no-group "$TEMP_DIR/" "$SERVER:$DEPLOY_PATH/"; then
                echo "❌ Error: Deployment failed, aborting"
                exit 1
            fi

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
          default = backend;
        };
      }
    );
}

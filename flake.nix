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
                
                # Create a temporary worktree for the selected commit
                TEMP_WORKTREE=$(mktemp -d)
                git worktree add "$TEMP_WORKTREE" "$COMMIT"
                cd "$TEMP_WORKTREE"
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

            # Copy static files
            echo "📋 Copying static files..."
            cp -r static "$TEMP_DIR/"

            # Copy package.json for reference
            cp package.json "$TEMP_DIR/"

            # Deploy to server
            echo "🌐 Deploying to $ENVIRONMENT server..."
            if ! rsync -avz --delete "$TEMP_DIR/" "$SERVER:$DEPLOY_PATH/"; then
                echo "❌ Error: Deployment failed, aborting"
                exit 1
            fi

            # Restart service
            echo "🔄 Restarting $ENVIRONMENT service..."
            if ! ssh "$SERVER" "sudo systemctl restart languagebuddy-api-\$ENVIRONMENT.service"; then
                echo "⚠️  Warning: Service restart failed or service not found"
            fi

            # Cleanup temporary directories
            rm -rf "$TEMP_DIR"
            if [ "$ENVIRONMENT" = "prod" ] && [ -n "$TEMP_WORKTREE" ]; then
                cd /
                git worktree remove "$TEMP_WORKTREE" --force
            fi

            echo "✅ $ENVIRONMENT deployment completed successfully!"
            echo "📍 Deployed to: $SERVER:$DEPLOY_PATH"

            echo "🎉 $ENVIRONMENT deployment finished!"
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

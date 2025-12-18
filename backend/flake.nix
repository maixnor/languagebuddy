{
  description = "JavaScript example flake for Zero to Nix";

  inputs = {
    # Latest stable Nixpkgs
    nixpkgs.url = "github:nixos/nixpkgs";
  };

  outputs = { self, nixpkgs }:
    let
      lib = nixpkgs.lib; # Define lib here
      # Systems supported
      allSystems = [
        "x86_64-linux" # 64-bit Intel/AMD Linux
        "aarch64-linux" # 64-bit ARM Linux
        "x86_64-darwin" # 64-bit Intel macOS
        "aarch64-darwin" # 64-bit ARM macOS
      ];

      # Helper to provide system-specific attributes
      forAllSystems = f: nixpkgs.lib.genAttrs allSystems (system: f {
        pkgs = import nixpkgs { inherit system; };
      });
    in
    {
      packages = forAllSystems ({ pkgs }: {
        default = pkgs.buildNpmPackage {
          name = "languagebuddy-backend";

          buildInputs = with pkgs; [
            git # used for getting commit hash during build
            nodejs_22
          ];

          src = lib.cleanSource ./.; # Use lib.cleanSource

          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };

          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          buildPhase = ''
            node scripts/generate-build-info.js # Run script first
            npm run build:full
            ls -F dist/src/ # Add this line to list contents
          '';

          installPhase = ''
            mkdir -p $out
            
            # Copy all built artifacts
            cp -r dist/src/* $out/
            
            # Copy node_modules (runtime dependencies)
            cp -r node_modules $out/
            
            # Copy package.json for runtime reference
            cp package.json $out/
          '';
        };
      });
    };
}

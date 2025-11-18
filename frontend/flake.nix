{
  description = "LanguageBuddy Frontend - Astro Static Site";

  inputs = {
    # Latest stable Nixpkgs
    nixpkgs.url = "github:nixos/nixpkgs";
  };

  outputs = { self, nixpkgs }:
    let
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
          name = "languagebuddy-frontend";

          buildInputs = with pkgs; [
            nodejs_24
          ];

          src = self;

          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };

          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          buildPhase = ''
            npm run build
          '';

          installPhase = ''
            mkdir -p $out
            
            # Copy the entire dist directory (Astro output)
            cp -r dist/* $out/
          '';
        };
      });
    };
}

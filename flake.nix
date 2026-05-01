{
  description = "supermicro-ipmi userscript devshell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              # base toolchain
              uv
              python313
              ruff

              # network / VPN client (OpenVPN talks to the BMC's network)
              openvpn

              # research & decode
              websocat                  # talk WebSocket from the CLI
              js-beautify               # un-minify the IPMI's JS bundles
              html-tidy                 # pretty-print captured HTML
            ];
            shellHook = ''
              true
            '';
          };
        });
    };
}

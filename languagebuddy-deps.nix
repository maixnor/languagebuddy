{ config, pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    nodejs_24
  ];

  services.redis = {
    enable = true;
    extraConfig = ''
      appendonly yes
      appendfsync everysec
    '';
  };

  systemd.services.languagebuddy-update = {
    description = "Pull latest code and restart app";
    serviceConfig = {
      Type = "oneshot";
      WorkingDirectory = "/home/maixnor/repo/languagebuddy";
      ExecStart = pkgs.writeShellScript "languagebuddy-update.sh" ''
        if git fetch origin main && ! git diff --quiet HEAD..origin/main; then
          git pull origin main
          systemctl --user restart languagebuddy-app.service || true
        fi
      '';
      User = "maixnor";
    };
  };

  systemd.timers.languagebuddy-update = {
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnCalendar = "*:*:0/60";
      Unit = "languagebuddy-update.service";
    };
  };

  systemd.services.languagebuddy-app = {
    description = "LanguageBuddy App";
    after = [ "network.target" "redis.service" ];
    wantedBy = [ "default.target" ];
    serviceConfig = {
      WorkingDirectory = "/home/maixnor/repo/languagebuddy";
      ExecStart = "node index.js";
      Restart = "always";
      User = "maixnor";
      EnvironmentFile = "/home/maixnor/repo/languagebuddy/backend/.env";
    };
  };
}
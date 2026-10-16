module.exports = {
  apps: [
    {
      name: "smart-school-postgres",
      cwd: "C:\\APK\\pgsql",
      script: "run_postgres.js",
      autorestart: true,
      watch: false,
      restart_delay: 2000,
      max_restarts: 100
    },
    {
      name: "smart-school-backend",
      cwd: "C:\\APK\\backend",
      script: "dist/server.js",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      kill_timeout: 4000,
      restart_delay: 3000,
      min_uptime: "8s",
      max_restarts: 100,
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      }
    },
    {
      name: "cloudflare-tunnel",
      script: "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
      args: "tunnel run --protocol http2 --token eyJhIjoiYjA1ODFmZDAwM2MxM2I2NTQ1NWI4ZGE3MzZkZWI4ZWMiLCJ0IjoiNDE2MmNhMDEtYjEzYS00OWI4LThjM2ItYzk5M2NhNGI4ZmM3IiwicyI6IlpERmpaak5rWlRJdE5tWTFNaTAwWkdFMUxUa3laV0l0WVRaaE5XVTBNRGRoT0RBNCJ9",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 100
    }
  ]
};

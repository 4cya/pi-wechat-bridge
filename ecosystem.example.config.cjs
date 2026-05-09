// PM2 ecosystem config for pi-wechat-bridge
// Copy to ecosystem.config.cjs and adjust paths before use
module.exports = {
  apps: [
    {
      name: 'pi-wechat-bridge',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: '/path/to/pi-wechat-bridge',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/path/to/pi-wechat-bridge/logs/error.log',
      out_file: '/path/to/pi-wechat-bridge/logs/out.log',
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: ['sessions.json'],
      watch_delay: 3000,
    },
  ],
}

// PM2 ecosystem config for pi-wechat-bridge
module.exports = {
  apps: [
    {
      name: 'pi-wechat-bridge',
      script: 'npx',
      args: 'tsx src/index.ts',
      cwd: '/home/ubuntu/work/pi-wechat-bridge',
      interpreter: 'none', // use npx directly
      env: {
        NODE_ENV: 'production',
      },
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/home/ubuntu/work/pi-wechat-bridge/logs/error.log',
      out_file: '/home/ubuntu/work/pi-wechat-bridge/logs/out.log',
      merge_logs: true,
      // Auto-restart
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // Watch for sessions.json changes
      watch: ['sessions.json'],
      watch_delay: 3000,
    },
  ],
}

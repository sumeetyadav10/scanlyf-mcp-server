module.exports = {
  apps: [{
    name: 'scanlyf-mcp',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 523
    },
    error_file: '/var/log/scanlyf/error.log',
    out_file: '/var/log/scanlyf/out.log',
    log_file: '/var/log/scanlyf/combined.log',
    time: true
  }]
};
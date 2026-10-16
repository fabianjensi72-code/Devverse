const path = require('node:path');

// PM2 lee este archivo desde su propio proceso; cargar .env aquí permite
// heredar los secretos sin escribirlos en el archivo del ecosistema.
require('dotenv').config({ path: path.join(__dirname, '.env') });

module.exports = {
  apps: [
    {
      name: 'devverse-bot',
      script: 'index.js',
      cwd: __dirname,
      interpreter: 'node',
      autorestart: true,
      max_memory_restart: '250M',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};

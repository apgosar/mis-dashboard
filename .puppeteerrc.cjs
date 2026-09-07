const { join } = require('path');

module.exports = {
  // Keep the downloaded Chrome binary inside the project directory so it
  // survives Render's build -> runtime handoff (the default cache dir,
  // ~/.cache/puppeteer, is outside the project and gets dropped).
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};

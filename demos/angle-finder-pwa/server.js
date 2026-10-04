const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3011;

// Cloud Run sets K_REVISION to a unique value on every deploy. Locally it
// falls back to the process start time, so a dev server restart also gets a
// fresh version. This id drives cache-busting for both the HTML and the
// service worker, so a new deploy is never masked by a stale cache.
const BUILD_ID = process.env.K_REVISION || String(Date.now());

const indexTemplate = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const swTemplate = fs.readFileSync(path.join(__dirname, 'public', 'sw.js'), 'utf8');

const indexHtml = indexTemplate
  .replace('src="main.js"', `src="main.js?v=${BUILD_ID}"`)
  .replace('src="install-prompt.js"', `src="install-prompt.js?v=${BUILD_ID}"`)
  .replace('href="manifest.webmanifest"', `href="manifest.webmanifest?v=${BUILD_ID}"`)
  .replace('__BUILD_ID__', BUILD_ID);

const swJs = swTemplate.replaceAll('__BUILD_ID__', BUILD_ID);

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(indexHtml);
});

app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').send(swJs);
});

// Icons rarely change and are cheap to cache aggressively; app code stays
// revalidate-always so a new deploy is never masked by a stale cache.
app.use(
  express.static(path.join(__dirname, 'public'), {
    index: false,
    setHeaders: (res, filePath) => {
      const longLived = /[\\/]icons[\\/]/.test(filePath);
      res.set('Cache-Control', longLived ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  })
);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} (build ${BUILD_ID})`);
});

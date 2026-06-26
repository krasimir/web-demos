const express = require('express');

const app = express();
const PORT = 3001;

async function somethingSlow() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('Hey there!');
    }, 4000);
  });
}

app.get('/', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.write(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Streaming HTML (Suspense-style)</title>
      <style>
        body { font-family: sans-serif; max-width: 600px; margin: 40px auto; }
        .placeholder { color: #888; font-style: italic; }
        section { border: 1px solid #ddd; padding: 16px; margin-bottom: 16px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h1>Loading...</h1>
    </body>
    </html>
  `);

  const data = await somethingSlow();
  
  res.write(`
    <script>document.querySelector('h1').textContent = '${data}'</script>
  `);
  res.end();
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

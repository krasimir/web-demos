const express = require('express');

const app = express();
const PORT = 3001;

app.get('/', async (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader("Transfer-Encoding", "chunked");
  res.write(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Streaming HTML (Suspense-style)</title>
      <style>
        body { background: #333; color: #fff;font-family: sans-serif; max-width: 600px; margin: 40px auto; }
      </style>
    </head>
    <body>
      <h1>Loading...</h1>
    </body>
    </html>
  `);

  const data = await getData();
  
  res.write(`
    <script>document.querySelector('h1').textContent = '${data}'</script>
  `);
  res.end();
});

function getData() {
  return new Promise((resolve) => setTimeout(() => resolve("Hey there!"), 5000));
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

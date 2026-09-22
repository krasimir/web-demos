export const demos = [
  {
    name: 'Card + button',
    html: `<div class="card">
  <button>Say, hey!</button>
</div>`,
    css: `.card {
  width: 70%;
  height: 300px;
  border-radius: 0.4rem;
  background: #1c1c1c;
  border: solid 1px #5b5b5b;
}
button {
  font-size: 1rem;
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 0.5rem;
  background: #006fa7;
  color: #fff;
}
`,
    js: `console.log('Playground ready.');`,
  },
  {
    name: 'CSS color-mix()',
    html: `<div class="swatches">
  <div class="swatch a"></div>
  <div class="swatch b"></div>
  <div class="swatch c"></div>
</div>`,
    css: `.swatches {
  display: flex;
  gap: 1rem;
}
.swatch {
  width: 100px;
  height: 100px;
  border-radius: 0.75rem;
}
.a { background: color-mix(in oklab, royalblue 80%, white); }
.b { background: color-mix(in oklab, royalblue 50%, white); }
.c { background: color-mix(in oklab, royalblue 20%, white); }
`,
    js: `console.log('Playground ready.');`,
  },
];

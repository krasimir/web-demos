/* ******************************************** center */
const centering = {
  name: "I. The biggest problem",
  fontSize: { html: "1.2em", css: "1.2em" },
  problem: {
    html: `<div class="card">
  <button>Say, hey!</button>
</div>`,
    css: `.card {
  
}
`,
    js: ``
  },
  solution: {
    html: `<div class="card">
  <button>Say, hey!</button>
</div>`,
    css: `.card {
  display: grid;
  place-items: center;
}
`,
    js: ``
  }
};

/* ******************************************** contrast-color */
const contrastColor = {
  name: "II. Contrast Color",
  defaultTab: "css",
  fontSize: { html: "1em", css: "1em" },
  defaultParams: { bgColor: "#006fa7" },
  problem: {
    html: `<div class="card">
  <button>Say, hey!</button>
  <input type="color" />
</div>`,
    css: (code, params) => {
      if (!code) {
        return `.card {
  display: flex;
  flex-direction: column;
  gap: 1em;
  justify-content: center;
  align-items: center;
}
button {
  --bg-color: ${params.bgColor};
  background: var(--bg-color);
  color: #fff;
}
`;
      }
      return code.replace(/--bg-color:\s*[^;]+;/, `--bg-color: ${params.bgColor};`);
    },
    js: `
      const input = document.querySelector('input[type="color"]');
      input.style.backgroundColor = "#006fa7";
      input.value = "#006fa7";
      input.addEventListener('input', (e) => {
        document.querySelector('button').style.backgroundColor = e.target.value;
        input.style.backgroundColor = e.target.value;
        updateDemoParams({ bgColor: e.target.value });
      });
    `
  },
  solution: {
    html: `<div class="card">
  <button>Say, hey!</button>
  <input type="color" />
</div>`,
    css: `.card {
  display: flex;
  flex-direction: column;
  gap: 1em;
  justify-content: center;
  align-items: center;
}
button {
  --bg-color: #fff;
  background: var(--bg-color);
  color: contrast-color(var(--bg-color));
}
`,
    js: ``
  }
};

/* ******************************************** theming */
const theming = {
  name: "III. Theming",
  defaultTab: "html",
  fontSize: { html: "1em", css: "0.8em" },
  problem: {
    html: (code, params) => {
      const containerClass = params?.scheme === "dark" ? "dark" : "light";
      return `<div class="${containerClass}" id="container">
  <div class="card">
    <h1>Theming Demo</h1>
  </div>
  <nav>
    <button id="dark-btn">dark</button>
    <button id="light-btn">light</button>
  </nav>
</div>`;
    },
    css: `:root {
  --scheme: light;
}
.dark { --scheme: dark; }
.light { --scheme: light; }

@function --theme-color(--light, --dark) {
  result: var(--light);
  @container style(--scheme: dark) {
    result: var(--dark);
  }
}
.card {
  padding: 1em;
  background: --theme-color(#fff, #1c1c1c);
}
h1 {
  color: --theme-color(#14161a, #e8e8e8);
}
`,
    js: `const darkButton = document.getElementById('dark-btn');
const lightButton = document.getElementById('light-btn');
const container = document.getElementById('container');
darkButton.addEventListener('click', () => {
  updateDemoParams({ scheme: 'dark' });
});
lightButton.addEventListener('click', () => {
  updateDemoParams({ scheme: 'light' });
});
    `
  }
};

/* ******************************************** if */
const ifelse = {
  name: "III. If-Else",
  defaultTab: "html",
  fontSize: { html: "1.2em", css: "0.8em" },
  problem: {
    html: `<div class="card">
  <div
    class="progress"
    data-value="85" />
</div>`,
    css: `@function --check(--value <number>) {
  result: if(
    style(--value: 100): #6eff6e;
    else: #ff3333;
  );
}
.progress {
  width: 300px;
  height: 70px;
  background: --check(
    attr(data-value type(<number>), 0)
  );
}
.card {
  place-items: center;
  display: grid;
}`,
    js: ``
  }
};

/* ******************************************** dialog */
const dialog = {
  name: "IV. Dialog",
  defaultTab: "html",
  fontSize: { html: "0.8em", css: "0.85em" },
  problem: {
    html: `<button commandfor="dialog" command="show-modal">
  Open dialog
</button>

<dialog id="dialog" closedby="any">
  <h1>Native &lt;dialog&gt;</h1>
  <p>No JavaScript library required.</p>
  <form method="dialog">
    <button>Close</button>
  </form>
</dialog>`,
    css: `dialog {
  border: none;
  border-radius: 0.75rem;
  padding: 2rem;
  background: #1c1c1c;
  color: #fff;
  opacity: 0;
  transform: scale(0.9);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease,
    overlay 0.2s ease allow-discrete,
    display 0.2s ease allow-discrete;
}
dialog[open] {
  opacity: 1;
  transform: scale(1);
}
@starting-style {
  dialog[open] {
    opacity: 0;
    transform: scale(0.9);
  }
  dialog[open]::backdrop {
    opacity: 0;
  }
}
dialog::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.2s ease allow-discrete;
}
dialog[open]::backdrop {
  opacity: 1;
}
`,
    js: ``
  }
};

/* ******************************************** view transitions */
const viewTransitions = {
  name: "V. View Transitions",
  defaultTab: "html",
  fontSize: { html: "0.9em", css: "0.75em", js: "0.9em" },
  problem: {
    html: `<div class="product" id="product">
  <img
    class="product-image"
    src="/images/product.jpg"
    alt="Inter" />
  <p class="product-name">
    FC Inter home match jersey 2025/26
  </p>
</div>`,
    css: `.product-image {
  width: 220px;
  border-radius: 0.75rem;
}
.product-name {
  font-weight: bold;
  font-size: 1.15em;
  margin: 0;
}
.product.expanded .product-image {
  width: 100px;
  flex-shrink: 0;
}
.product {
  width: 300px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.75em;
  padding: 1.5em;
  border-radius: 0.75rem;
  background: #1c1c1c;
}
.product:hover {
  border: dashed 6px #333333;
}
.product.expanded {
  width: 400px;
  cursor: default;
  flex-direction: row;
  align-items: flex-start;
  text-align: left;
  gap: 1.25em;
  border: dashed 6px #333333;
}
.product.expanded .product-name {
  font-size: 1em;
}
.product-info {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}
.product-price {
  color: #6eff9c;
  font-weight: 700;
  font-size: 1.1em;
  margin: 0;
}
.product-desc {
  color: #b8bcc4;
  font-size: 0.8em;
  line-height: 1.4;
  margin: 0;
}
.close-btn {
  margin-top: 0.2em;
}
`,
    js: `const product = document.getElementById('product');

let expanded = false;
product.addEventListener('click', (e) => {
  // document.startViewTransition(() => {
    if (expanded) {
      product.innerHTML = cardMarkup;
      product.classList.remove('expanded');
    } else {
      product.innerHTML = detailMarkup;
      product.classList.add('expanded');
    }
    expanded = !expanded;
  // });
});
`
  },
  solution: {
    html: `<div class="product" id="product">
  <img
    class="product-image"
    src="/images/product.jpg"
    alt="Inter" />
  <p class="product-name">
    FC Inter home match jersey 2025/26
  </p>
</div>`,
    css: `@view-transition {
  navigation: auto;
}
.product {
  width: 300px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.75em;
  padding: 1.5em;
  border-radius: 0.75rem;
  background: #1c1c1c;
}
.product:hover {
  border: dashed 6px #333333;
}
.product.expanded {
  width: 400px;
  cursor: default;
  flex-direction: row;
  align-items: flex-start;
  text-align: left;
  gap: 1.25em;
  border: dashed 6px #333333;
}
.product-image {
  width: 220px;
  border-radius: 0.75rem;
  view-transition-name: product-image;
}
.product.expanded .product-image {
  width: 100px;
  flex-shrink: 0;
}
.product-name {
  font-weight: bold;
  font-size: 1.15em;
  margin: 0;
  view-transition-name: product-name;
}
.product.expanded .product-name {
  font-size: 1em;
}
.product-info {
  display: flex;
  flex-direction: column;
  gap: 0.4em;
}
.product-price {
  color: #6eff9c;
  font-weight: 700;
  font-size: 1.1em;
  margin: 0;
  view-transition-name: product-price;
}
.product-desc {
  color: #b8bcc4;
  font-size: 0.8em;
  line-height: 1.4;
  margin: 0;
  view-transition-name: product-desc;
}
.close-btn {
  view-transition-name: close-btn;
  margin-top: 0.2em;
}
::view-transition-group(product-image),
::view-transition-group(product-name),
::view-transition-group(close-btn) {
  animation-duration: 1s;
  animation-timing-function: cubic-bezier(1,-0.06,.14,.94);
}
::view-transition-new(product-price),
::view-transition-new(product-desc),
::view-transition-new(close-btn) {
  opacity: 0;
  animation: fade-in 0.4s ease-out;
  animation-delay: 0.8s;
}
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(40px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`,
    js: `const product = document.getElementById('product');

let expanded = false;
product.addEventListener('click', (e) => {
  document.startViewTransition(() => {
    if (expanded) {
      product.innerHTML = cardMarkup;
      product.classList.remove('expanded');
    } else {
      product.innerHTML = detailMarkup;
      product.classList.add('expanded');
    }
    expanded = !expanded;
  });

  // window.location.href = '/product.html'
});
`
  }
};

export const demos = [centering, contrastColor, ifelse, dialog, viewTransitions];

/* ******************************************** center */
const centering = {
  name: "I. Centering",
  fontSize: { html: "1em", css: "1.2em" },
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
  defaultTab: "css",
  fontSize: { html: "0.8em", css: "0.8em" },
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
  name: "IV. If-Else",
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

export const demos = [centering, contrastColor, theming, ifelse];

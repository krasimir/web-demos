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
  fontSize: { html: "1em", css: "0.8em" },
  problem: {
    html: `<div>
  <div class="card">
    <h1>Theming Demo</h1>
  </div>
</div>`,
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
    js: ``
  }
};

export const demos = [centering, contrastColor, theming];

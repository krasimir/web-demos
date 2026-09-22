/* ******************************************** center */
const centering = {
  name: "I. Centering",
  problem: {
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
`,
    js: ``
  },
  solution: {
    html: `<div class="card">
  <button>Say, hey!</button>
</div>`,
    css: `.card {
  width: 70%;
  height: 300px;
  border-radius: 0.4rem;
  background: #1c1c1c;
  border: solid 1px #5b5b5b;
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
  problem: {
    html: `<div class="card">
  <button>Say, hey!</button>
  <input type="color" />
</div>`,
    css: `.card {
  width: 70%;
  height: 300px;
  border-radius: 0.4rem;
  background: #1c1c1c;
  border: solid 1px #5b5b5b;
  display: flex;
  flex-direction: column;
  gap: 1em;
  justify-content: center;
  align-items: center;
}
`,
    js: `
      const input = document.querySelector('input[type="color"]');
      input.style.backgroundColor = "#006fa7";
      input.value = "#006fa7";
      input.addEventListener('input', (e) => {
        document.querySelector('button').style.backgroundColor = e.target.value;
        input.style.backgroundColor = e.target.value;
      });
    `
  },
  solution: {
    html: `<div class="card">
  <button>Say, hey!</button>
</div>`,
    css: `.card {
  width: 70%;
  height: 300px;
  border-radius: 0.4rem;
  background: #1c1c1c;
  border: solid 1px #5b5b5b;
  display: grid;
  place-items: center;
}
`,
    js: ``
  }
};

export const demos = [centering, contrastColor];

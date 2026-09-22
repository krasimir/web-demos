import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, indentUnit, defaultHighlightStyle } from '@codemirror/language';
import { oneDarkTheme, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { demos } from './demos.js';

const themeCompartment = new Compartment();
const darkEditorTheme = [oneDarkTheme, syntaxHighlighting(oneDarkHighlightStyle)];
const lightEditorTheme = [syntaxHighlighting(defaultHighlightStyle)];

const bareTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    padding: 0,
    caretColor: 'var(--cm-caret)',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 1.6,
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(120, 160, 255, .25) !important',
  },
}, { dark: true });

const demoNav = { prev: () => {}, next: () => {} };

function makeExtensions(langExtension, onChange) {
  return [
    history(),
    drawSelection(),
    themeCompartment.of(darkEditorTheme),
    bareTheme,
    EditorView.lineWrapping,
    indentUnit.of('  '),
    keymap.of([
      { key: 'F7', run: () => { demoNav.prev(); return true; } },
      { key: 'F9', run: () => { demoNav.next(); return true; } },
      ...defaultKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    langExtension(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }),
  ];
}

function createEditor(parent, langExtension, initialDoc, onChange) {
  return new EditorView({
    state: EditorState.create({
      doc: initialDoc,
      extensions: makeExtensions(langExtension, onChange),
    }),
    parent,
  });
}

const stage = document.getElementById('stage');
const tabs = Array.from(document.querySelectorAll('.tab'));
const editorHosts = Object.fromEntries(
  Array.from(document.querySelectorAll('[data-editor]')).map((el) => [el.dataset.editor, el])
);

let renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderStage, 150);
}

const views = {
  html: createEditor(editorHosts.html, html, demos[0].problem.html, scheduleRender),
  css: createEditor(editorHosts.css, css, demos[0].problem.css, scheduleRender),
  js: createEditor(editorHosts.js, javascript, demos[0].problem.js, scheduleRender),
};

function renderStage() {
  const htmlCode = views.html.state.doc.toString();
  const cssCode = views.css.state.doc.toString();
  const jsCode = views.js.state.doc.toString();
  const isLight = document.documentElement.dataset.theme === 'light';
  const stageBg = isLight ? '#ffffff' : '#0b0c0f';
  const stageFg = isLight ? '#14161a' : '#e8e8e8';

  stage.srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    min-height: 100%;
    font-size: 28px;
  }
  body {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: ${stageBg};
    color: ${stageFg};
    font-family: system-ui, -apple-system, sans-serif;
  }
  button {
    font-size: 1rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.5rem;
    background: #006fa7;
    color: #fff;
    cursor: pointer;
  }
  ${cssCode}
</style>
</head>
<body>
${htmlCode}
<script>
try {
${jsCode}
} catch (err) {
  console.error(err);
}
<\/script>
</body>
</html>`;
}

function setActiveTab(name) {
  tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  Object.entries(editorHosts).forEach(([name_, el]) => {
    el.hidden = name_ !== name;
  });
  views[name].focus();
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setActiveTab(tab.dataset.tab));
});

renderStage();

function setContent(tab, code) {
  const view = views[tab];
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
}

function applyVariant(demo, variant) {
  setContent('html', demo[variant].html);
  setContent('css', demo[variant].css);
  setContent('js', demo[variant].js);
}

let currentDemoIndex = 0;

const demoSelect = document.getElementById('demo-select');
demos.forEach((demo, index) => {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = demo.name;
  demoSelect.appendChild(option);
});
demoSelect.addEventListener('change', () => {
  currentDemoIndex = Number(demoSelect.value);
  applyVariant(demos[currentDemoIndex], 'problem');
  setActiveTab('html');
});

const solutionButton = document.getElementById('solution-btn');
solutionButton.addEventListener('click', () => {
  applyVariant(demos[currentDemoIndex], 'solution');
});

const themeButton = document.getElementById('theme-btn');
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeButton.textContent = theme === 'light' ? '🌙' : '☀️';
  Object.values(views).forEach((view) => {
    view.dispatch({
      effects: themeCompartment.reconfigure(theme === 'light' ? lightEditorTheme : darkEditorTheme),
    });
  });
  renderStage();
}
themeButton.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

function goToDemo(delta) {
  const nextIndex = Math.min(Math.max(currentDemoIndex + delta, 0), demos.length - 1);
  if (nextIndex === currentDemoIndex) return;
  currentDemoIndex = nextIndex;
  demoSelect.value = String(currentDemoIndex);
  applyVariant(demos[currentDemoIndex], 'problem');
  setActiveTab('html');
}

demoNav.prev = () => goToDemo(-1);
demoNav.next = () => goToDemo(1);

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.key === 'F7') {
    e.preventDefault();
    goToDemo(-1);
  } else if (e.key === 'F9') {
    e.preventDefault();
    goToDemo(1);
  }
});

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, indentUnit } from '@codemirror/language';
import { oneDarkTheme, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { demos } from './demos.js';

const bareTheme = EditorView.theme({
  '&': {
    fontSize: '16px',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
    padding: 0,
    caretColor: '#fff',
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

function makeExtensions(langExtension, onChange) {
  return [
    history(),
    drawSelection(),
    syntaxHighlighting(oneDarkHighlightStyle),
    oneDarkTheme,
    bareTheme,
    EditorView.lineWrapping,
    indentUnit.of('  '),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
    background: #0b0c0f;
    color: #e8e8e8;
    font-family: system-ui, -apple-system, sans-serif;
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

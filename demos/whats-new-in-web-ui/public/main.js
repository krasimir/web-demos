import {
  EditorState, Compartment,
  EditorView, keymap, drawSelection,
  defaultKeymap, history, historyKeymap, indentWithTab,
  html, css, javascript,
  syntaxHighlighting, indentUnit, defaultHighlightStyle,
  oneDarkTheme, oneDarkHighlightStyle,
} from './vendor/codemirror.js';
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

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const demoSlugs = demos.map((demo) => slugify(demo.name));

function demoIndexFromHash() {
  const index = demoSlugs.indexOf(location.hash.slice(1));
  return index === -1 ? 0 : index;
}

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

const TYPING_RENDER_DELAY = 150;
const PARAM_RENDER_DELAY = 700;
const CSS_PATCH_DELAY = 100;

let stageReady = false;
stage.addEventListener('load', () => { stageReady = true; });

let renderTimer;
let cssPatchTimer;
function scheduleRender(delay = TYPING_RENDER_DELAY) {
  clearTimeout(cssPatchTimer);
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderStage, delay);
}

function scheduleCssPatch() {
  if (!stageReady) {
    scheduleRender();
    return;
  }
  clearTimeout(cssPatchTimer);
  cssPatchTimer = setTimeout(() => {
    stage.contentWindow.postMessage({ __setCss: views.css.state.doc.toString() }, '*');
  }, CSS_PATCH_DELAY);
}

function handleEditorChange(tab) {
  if (tab === 'css') {
    scheduleCssPatch();
  } else {
    scheduleRender();
  }
}

function resolveField(field, params) {
  return typeof field === 'function' ? field(params) : field;
}

let currentDemoIndex = demoIndexFromHash();
let currentVariant = 'problem';
let currentParams = {};

const views = {
  html: createEditor(editorHosts.html, html, resolveField(demos[currentDemoIndex].problem.html, currentParams), () => handleEditorChange('html')),
  css: createEditor(editorHosts.css, css, resolveField(demos[currentDemoIndex].problem.css, currentParams), () => handleEditorChange('css')),
  js: createEditor(editorHosts.js, javascript, resolveField(demos[currentDemoIndex].problem.js, currentParams), () => handleEditorChange('js')),
};

function renderStage() {
  const htmlCode = views.html.state.doc.toString();
  const cssCode = views.css.state.doc.toString();
  const jsCode = views.js.state.doc.toString();
  const isLight = document.documentElement.dataset.theme === 'light';
  const stageBg = isLight ? '#ffffff' : '#0b0c0f';
  const stageFg = isLight ? '#14161a' : '#e8e8e8';

  stageReady = false;
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
  input {
    font-size: 1em;
    border: solid 2px #006fa7;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    padding: 1em;
    background: none;
    color: #fff;
  }
</style>
<style id="demo-css">${cssCode}</style>
</head>
<body>
<script>
  window.updateDemoParams = function (params) {
    window.parent.postMessage({ __demoParams: params }, '*');
  };
  window.addEventListener('message', function (event) {
    if (event.data && typeof event.data.__setCss === 'string') {
      document.getElementById('demo-css').textContent = event.data.__setCss;
    }
  });
<\/script>
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
  currentVariant = variant;
  currentParams = {};
  setContent('html', resolveField(demo[variant].html, currentParams));
  setContent('css', resolveField(demo[variant].css, currentParams));
  setContent('js', resolveField(demo[variant].js, currentParams));
}

function updateDemoParams(partial) {
  currentParams = { ...currentParams, ...partial };
  const variant = demos[currentDemoIndex][currentVariant];
  const dynamicTabs = ['html', 'css', 'js'].filter((tab) => typeof variant[tab] === 'function');
  dynamicTabs.forEach((tab) => setContent(tab, variant[tab](currentParams)));
  // A css-only change already went through the fast, non-destructive patch path
  // (see handleEditorChange). html/js changes need a real reload, so give that
  // a longer throttle to avoid interrupting whatever's mid-interaction in the preview.
  if (dynamicTabs.some((tab) => tab !== 'css')) {
    scheduleRender(PARAM_RENDER_DELAY);
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== stage.contentWindow) return;
  if (event.data && event.data.__demoParams) {
    updateDemoParams(event.data.__demoParams);
  }
});

const demoSelect = document.getElementById('demo-select');
demos.forEach((demo, index) => {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = demo.name;
  demoSelect.appendChild(option);
});
demoSelect.value = String(currentDemoIndex);
if (location.hash.slice(1) !== demoSlugs[currentDemoIndex]) {
  window.history.replaceState(null, '', `#${demoSlugs[currentDemoIndex]}`);
}

function selectDemo(index) {
  currentDemoIndex = index;
  demoSelect.value = String(index);
  applyVariant(demos[index], 'problem');
  setActiveTab('html');
  if (location.hash.slice(1) !== demoSlugs[index]) {
    location.hash = demoSlugs[index];
  }
}

demoSelect.addEventListener('change', () => {
  selectDemo(Number(demoSelect.value));
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
  selectDemo(nextIndex);
}

demoNav.prev = () => goToDemo(-1);
demoNav.next = () => goToDemo(1);

window.addEventListener('hashchange', () => {
  const index = demoIndexFromHash();
  if (index !== currentDemoIndex) selectDemo(index);
});

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

let activeConv = null;
let isStreaming = false;
let models = [];
let currentAbort = null;
let pendingImages = []; // { dataUrl, base64 }
let pendingFiles = []; // { name, content }
let openMenuConvId = null;

const convList = document.getElementById('conv-list');
const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const emptyState = document.getElementById('empty-state');
const modelSelect = document.getElementById('model-select');
const systemPromptEl = document.getElementById('system-prompt');
const tempPresetsEl = document.getElementById('temp-presets');
const tempCustomNoteEl = document.getElementById('temp-custom-note');
const numCtxEl = document.getElementById('num-ctx');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const imageStripEl = document.getElementById('image-strip');
const slashMenuEl = document.getElementById('slash-menu');
const textAttachBtn = document.getElementById('text-attach-btn');
const textFileInput = document.getElementById('text-file-input');
const fileStripEl = document.getElementById('file-strip');
const urlAttachBtn = document.getElementById('url-attach-btn');
const urlPopoverEl = document.getElementById('url-popover');
const urlInputEl = document.getElementById('url-input');
const urlSubmitBtn = document.getElementById('url-submit');
const urlErrorEl = document.getElementById('url-error');
const codePanelEl = document.getElementById('code-panel');
const codePanelTitleEl = document.getElementById('code-panel-title');
const codePanelContentEl = document.getElementById('code-panel-content');

const MAX_FILES = 3;
const MAX_FILE_CHARS = 60000;

// taal -> bestandsextensie, voor de downloadknop in het code-paneel
const LANG_EXT = {
  python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh', shell: 'sh',
  json: 'json', yaml: 'yml', html: 'html', css: 'css', sql: 'sql',
  markdown: 'md', c: 'c', cpp: 'cpp', java: 'java', go: 'go', rust: 'rs',
  php: 'php', ruby: 'rb', xml: 'xml', dockerfile: 'dockerfile',
};

const TEMP_PRESETS = [
  { value: null, label: 'Standaard' },
  { value: 0.2, label: 'Feitelijk' },
  { value: 0.7, label: 'Gebalanceerd' },
  { value: 1.3, label: 'Creatief' },
];
let selectedTemp = null;

// snelkoppelingen — hier aan te passen/uit te breiden
const SLASH_COMMANDS = [
  { cmd: '/vertaal', desc: 'Vertaal tekst naar het Engels', template: 'Vertaal de volgende tekst naar het Engels:\n\n' },
  { cmd: '/samenvat', desc: 'Vat tekst kort samen', template: 'Vat de volgende tekst kort en bondig samen:\n\n' },
  { cmd: '/leguit', desc: 'Leg iets begrijpelijk uit', template: 'Leg het volgende uitgebreid en begrijpelijk uit:\n\n' },
  { cmd: '/verbeter', desc: 'Verbeter grammatica en stijl', template: 'Verbeter de grammatica en stijl van de volgende tekst en licht de wijzigingen kort toe:\n\n' },
  { cmd: '/review', desc: 'Code review: bugs en edge cases', template: 'Doe een code review op het volgende: benoem bugs, edge cases en stijlproblemen:\n\n' },
];
let slashSelectedIndex = 0;

function renderTempPresets(){
  tempPresetsEl.innerHTML = TEMP_PRESETS.map((p, i) =>
    `<button type="button" class="temp-preset" data-i="${i}">${p.label}</button>`
  ).join('');
  tempPresetsEl.querySelectorAll('.temp-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      if(btn.disabled) return;
      selectedTemp = TEMP_PRESETS[parseInt(btn.dataset.i, 10)].value;
      updateTempUI();
    });
  });
}

function updateTempUI(){
  let matched = false;
  tempPresetsEl.querySelectorAll('.temp-preset').forEach((btn, i) => {
    const isActive = TEMP_PRESETS[i].value === selectedTemp;
    btn.classList.toggle('active', isActive);
    if(isActive) matched = true;
  });
  tempCustomNoteEl.textContent = (!matched && selectedTemp !== null)
    ? `aangepaste waarde: ${selectedTemp}`
    : '';
}

function setTempPresetsDisabled(disabled){
  tempPresetsEl.querySelectorAll('.temp-preset').forEach(btn => btn.disabled = disabled);
}

renderTempPresets();
updateTempUI();

marked.setOptions({ breaks: true });

// tweede verdedigingslaag naast img-src 'self' data: in de CSP: modeloutput
// zoals ![x](https://tracker.example/pixel.png) kan een externe request
// veroorzaken (IP-/metadata-lekkage, indirect via prompt-injectie). Alleen
// lokale data:-URI's (onze eigen base64-afbeeldingen) blijven toegestaan.
DOMPurify.addHook('afterSanitizeAttributes', function(node){
  if(node.tagName === 'IMG'){
    const src = node.getAttribute('src') || '';
    if(!src.startsWith('data:')){
      node.remove();
    }
  }
});

function renderMarkdown(target, raw){
  target._raw = raw;
  const html = DOMPurify.sanitize(marked.parse(raw));
  target.innerHTML = html;
  target.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
  target.querySelectorAll('pre').forEach(pre => {
    const code = pre.querySelector('code');
    const lang = (code && [...code.classList].find(c => c.startsWith('language-')) || '').replace('language-', '');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy-btn';
    copyBtn.textContent = 'kopieer';
    copyBtn.addEventListener('click', async () => {
      try{
        await navigator.clipboard.writeText(code ? code.textContent : pre.textContent);
        copyBtn.textContent = 'gekopieerd';
        setTimeout(() => copyBtn.textContent = 'kopieer', 1200);
      } catch{ /* clipboard-api niet beschikbaar (bv. geen https) */ }
    });
    pre.appendChild(copyBtn);

    // alleen een panel-knop bij een blok van serieuze lengte — kleine snippets hoeven niet in een paneel
    const codeText = code ? code.textContent : pre.textContent;
    if(codeText.split('\n').length > 3){
      const panelBtn = document.createElement('button');
      panelBtn.className = 'open-panel-btn';
      panelBtn.textContent = 'paneel ⧉';
      panelBtn.addEventListener('click', () => openCodePanel(codeText, lang));
      pre.appendChild(panelBtn);
    }
  });
}

function openCodePanel(code, lang){
  codePanelContentEl.textContent = code;
  codePanelContentEl.className = lang ? `language-${lang}` : '';
  hljs.highlightElement(codePanelContentEl);
  const ext = LANG_EXT[lang] || 'txt';
  codePanelTitleEl.textContent = lang ? `${lang} · .${ext}` : '.txt';
  codePanelContentEl.dataset.ext = ext;
  codePanelEl.classList.add('open');
}

document.getElementById('code-panel-close').addEventListener('click', () => {
  codePanelEl.classList.remove('open');
});
document.getElementById('code-panel-copy').addEventListener('click', async () => {
  const btn = document.getElementById('code-panel-copy');
  try{
    await navigator.clipboard.writeText(codePanelContentEl.textContent);
    btn.textContent = 'gekopieerd';
    setTimeout(() => btn.textContent = 'kopieer', 1200);
  } catch{ /* clipboard-api niet beschikbaar */ }
});
document.getElementById('code-panel-download').addEventListener('click', () => {
  const ext = codePanelContentEl.dataset.ext || 'txt';
  const blob = new Blob([codePanelContentEl.textContent], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `snippet.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
});

async function loadModels(){
  try{
    const r = await fetch('/api/models');
    if(!r.ok) throw new Error();
    const data = await r.json();
    models = data.models || [];
    if(models.length === 0){
      modelSelect.innerHTML = '<option>geen modellen gevonden</option>';
      modelSelect.disabled = true;
      sendBtn.disabled = true;
      return;
    }
    modelSelect.innerHTML = models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    modelSelect.disabled = false;
  } catch{
    modelSelect.innerHTML = '<option>kon modellen niet laden</option>';
    modelSelect.disabled = true;
  }
}

async function checkStatus(){
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  try{
    const r = await fetch('/api/health');
    if(!r.ok) throw new Error();
    dot.className = 'dot ok';
    text.textContent = 'ollama bereikbaar';
  } catch{
    dot.className = 'dot err';
    text.textContent = 'ollama onbereikbaar';
  }
}

function closeConvMenu(){
  document.querySelectorAll('.conv-menu').forEach(m => m.remove());
  openMenuConvId = null;
}

async function loadConversations(){
  const r = await fetch('/api/conversations');
  const items = await r.json();
  convList.innerHTML = '';
  for(const c of items){
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === activeConv ? ' active' : '');
    el.innerHTML = `
      <div class="conv-item-text">
        <div class="conv-item-title">${escapeHtml(c.title || 'Nieuw gesprek')}</div>
        <div class="conv-item-model">${escapeHtml(c.model || '')}</div>
      </div>
      <button class="conv-menu-btn" title="Meer opties">⋯</button>`;
    el.querySelector('.conv-item-text').addEventListener('click', () => openConversation(c.id));
    el.querySelector('.conv-menu-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if(openMenuConvId === c.id){ closeConvMenu(); return; }
      closeConvMenu();
      openMenuConvId = c.id;
      const menu = document.createElement('div');
      menu.className = 'conv-menu';
      menu.innerHTML = `
        <button data-action="rename">Hernoemen</button>
        <button data-action="export-md">Exporteren (.md)</button>
        <button data-action="export-json">Exporteren (.json)</button>
        <button data-action="delete" class="danger">Verwijderen</button>`;
      menu.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const action = ev.target.dataset.action;
        if(!action) return;
        closeConvMenu();
        if(action === 'rename') startRename(c.id, el);
        else if(action === 'export-md') window.location.href = `/api/conversations/${c.id}/export?format=md`;
        else if(action === 'export-json') window.location.href = `/api/conversations/${c.id}/export?format=json`;
        else if(action === 'delete'){
          await fetch(`/api/conversations/${c.id}`, { method: 'DELETE' });
          if(activeConv === c.id){ deselectConversation(); }
          loadConversations();
        }
      });
      el.appendChild(menu);
    });
    convList.appendChild(el);
  }
}

function startRename(convId, el){
  const titleEl = el.querySelector('.conv-item-title');
  const current = titleEl.textContent;
  const input = document.createElement('input');
  input.className = 'conv-item-title-input';
  input.value = current;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    if(newTitle && newTitle !== current){
      await fetch(`/api/conversations/${convId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
    }
    loadConversations();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
    if(e.key === 'Escape'){ input.value = current; input.blur(); }
  });
}

document.addEventListener('click', closeConvMenu);

function lockSettings(locked){
  modelSelect.disabled = locked || models.length === 0;
  systemPromptEl.disabled = locked;
  setTempPresetsDisabled(locked);
  numCtxEl.disabled = locked;
}

async function openConversation(id){
  activeConv = id;
  const r = await fetch(`/api/conversations/${id}/messages`);
  const data = await r.json();
  const conv = data.conversation;

  if(conv.model && models.includes(conv.model)) modelSelect.value = conv.model;
  systemPromptEl.value = conv.system_prompt || '';
  selectedTemp = conv.temperature ?? null;
  updateTempUI();
  numCtxEl.value = conv.num_ctx ?? '';
  lockSettings(true);

  messagesEl.innerHTML = '';
  if(data.messages.length === 0){ messagesEl.appendChild(emptyState); }
  data.messages.forEach((m, i) => {
    addBubble(m.role, m.content, m.images, m.stats, m.thinking, {
      id: m.id,
      files: m.files,
      isLast: i === data.messages.length - 1 && m.role === 'assistant'
    });
  });
  scrollDown();
  loadConversations();
}

function deselectConversation(){
  activeConv = null;
  messagesEl.innerHTML = '';
  messagesEl.appendChild(emptyState);
  systemPromptEl.value = '';
  selectedTemp = null;
  updateTempUI();
  numCtxEl.value = '';
  lockSettings(false);
}

function createThinkingBlock(){
  const details = document.createElement('details');
  details.className = 'thinking-block';
  details.innerHTML = `
    <summary><span class="thinking-dot active"></span><span class="thinking-label">Redeneren…</span></summary>
    <div class="thinking-block-body"></div>`;
  return details;
}

function renderFileChips(container, files, removable, onRemove){
  const strip = document.createElement('div');
  strip.className = removable ? 'file-strip' : 'msg-files';
  files.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    chip.innerHTML = `<span class="fc-name" title="${escapeHtml(f.name)}">📄 ${escapeHtml(f.name)}</span>`;
    if(removable){
      const rm = document.createElement('button');
      rm.className = 'remove';
      rm.textContent = '✕';
      rm.addEventListener('click', () => onRemove(i));
      chip.appendChild(rm);
    }
    strip.appendChild(chip);
  });
  container.appendChild(strip);
  return strip;
}

function addBubble(role, text, images, stats, thinking, opts){
  opts = opts || {};
  if(emptyState.parentElement) emptyState.remove();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  if(opts.id) wrap.dataset.id = opts.id;
  const roleLabel = role === 'user' ? 'jij' : 'llama';
  wrap.innerHTML = `<div class="role">${roleLabel}</div><div class="bubble"></div>`;
  const bubble = wrap.querySelector('.bubble');

  if(images && images.length){
    const strip = document.createElement('div');
    strip.className = 'msg-images';
    for(const im of images){
      const img = document.createElement('img');
      img.src = `data:${im.mime};base64,${im.data}`;
      strip.appendChild(img);
    }
    bubble.appendChild(strip);
  }

  if(opts.files && opts.files.length){
    renderFileChips(bubble, opts.files, false);
  }

  let thinkingBlock = null;
  if(thinking){
    thinkingBlock = createThinkingBlock();
    thinkingBlock.querySelector('.thinking-dot').classList.remove('active');
    thinkingBlock.querySelector('.thinking-label').textContent = 'Redenering';
    thinkingBlock.querySelector('.thinking-block-body').textContent = thinking;
    bubble.appendChild(thinkingBlock);
  }

  const textEl = document.createElement('div');
  textEl.className = 'msg-text';
  bubble.appendChild(textEl);

  if(role === 'assistant'){
    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'kopieer';
    copyBtn.addEventListener('click', async () => {
      try{
        await navigator.clipboard.writeText(textEl._raw || '');
        copyBtn.textContent = 'gekopieerd';
        setTimeout(() => copyBtn.textContent = 'kopieer', 1200);
      } catch{ /* clipboard-api niet beschikbaar (bv. geen https) */ }
    });
    wrap.appendChild(copyBtn);
    renderMarkdown(textEl, text);
    if(stats){
      const statsEl = document.createElement('div');
      statsEl.className = 'msg-stats';
      statsEl.textContent = `${stats.tokens} tokens · ${stats.tokens_per_sec ?? '?'} tok/s · ${stats.seconds}s`;
      bubble.appendChild(statsEl);
    }
    if(opts.isLast && opts.id){
      const regenBtn = document.createElement('button');
      regenBtn.className = 'regen-btn';
      regenBtn.textContent = '↻ regenereer';
      regenBtn.addEventListener('click', () => regenerateLast());
      wrap.appendChild(regenBtn);
    }
  } else {
    textEl.textContent = text;
    if(opts.id){
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '✎ bewerk';
      editBtn.addEventListener('click', () => startEditMessage(wrap, opts.id, text));
      wrap.appendChild(editBtn);
    }
  }

  messagesEl.appendChild(wrap);
  return { bubble, textEl, thinkingBlock, wrap };
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function scrollDown(){ messagesEl.scrollTop = messagesEl.scrollHeight; }

// --- afbeeldingen bijvoegen ---

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  for(const file of fileInput.files){
    if(pendingImages.length >= 4) break;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    pendingImages.push({ dataUrl, base64: dataUrl.split(',')[1], mime: file.type || 'image/png' });
  }
  fileInput.value = '';
  renderImageStrip();
});

function renderImageStrip(){
  imageStripEl.innerHTML = '';
  pendingImages.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'image-thumb';
    thumb.innerHTML = `<img src="${img.dataUrl}"><button class="remove" title="Verwijderen">✕</button>`;
    thumb.querySelector('.remove').addEventListener('click', () => {
      pendingImages.splice(i, 1);
      renderImageStrip();
    });
    imageStripEl.appendChild(thumb);
  });
  attachBtn.disabled = pendingImages.length >= 4;
}

// --- tekstbestanden bijvoegen ---

textAttachBtn.addEventListener('click', () => textFileInput.click());
textFileInput.addEventListener('change', async () => {
  for(const file of textFileInput.files){
    if(pendingFiles.length >= MAX_FILES) break;
    try{
      let content = await file.text();
      if(content.length > MAX_FILE_CHARS){
        content = content.slice(0, MAX_FILE_CHARS) + '\n[…afgekapt…]';
      }
      pendingFiles.push({ name: file.name, content });
    } catch{ /* onleesbaar bestand, gewoon overslaan */ }
  }
  textFileInput.value = '';
  renderFileStrip();
});

function renderFileStrip(){
  fileStripEl.innerHTML = '';
  if(pendingFiles.length === 0) return;
  renderFileChips(fileStripEl, pendingFiles, true, (i) => {
    pendingFiles.splice(i, 1);
    renderFileStrip();
  });
  textAttachBtn.disabled = pendingFiles.length >= MAX_FILES;
  urlAttachBtn.disabled = pendingFiles.length >= MAX_FILES;
}

// --- URL bijvoegen ---

urlAttachBtn.addEventListener('click', () => {
  urlErrorEl.textContent = '';
  urlInputEl.value = '';
  urlPopoverEl.classList.remove('hidden');
  urlInputEl.focus();
});

async function submitUrl(){
  const url = urlInputEl.value.trim();
  if(!url || pendingFiles.length >= MAX_FILES) return;
  urlErrorEl.textContent = '';
  urlSubmitBtn.disabled = true;
  urlSubmitBtn.textContent = 'Ophalen…';
  try{
    const r = await fetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await r.json();
    if(!r.ok) throw new Error(data.detail || 'kon URL niet ophalen');
    pendingFiles.push({ name: data.name || url, content: data.content });
    renderFileStrip();
    urlPopoverEl.classList.add('hidden');
  } catch(err){
    urlErrorEl.textContent = err.message;
  } finally {
    urlSubmitBtn.disabled = false;
    urlSubmitBtn.textContent = 'Ophalen';
  }
}
urlSubmitBtn.addEventListener('click', submitUrl);
urlInputEl.addEventListener('keydown', (e) => {
  if(e.key === 'Enter'){ e.preventDefault(); submitUrl(); }
  if(e.key === 'Escape'){ urlPopoverEl.classList.add('hidden'); }
});

// --- snelkoppelingen (/-commands) ---

function slashMatches(value){
  const m = value.match(/^\/(\S*)$/);
  if(!m) return null;
  const q = m[1].toLowerCase();
  const matches = SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q));
  return matches.length ? matches : null;
}

function renderSlashMenu(matches){
  if(!matches){
    slashMenuEl.classList.add('hidden');
    slashMenuEl.innerHTML = '';
    return;
  }
  slashSelectedIndex = Math.min(slashSelectedIndex, matches.length - 1);
  slashMenuEl.innerHTML = matches.map((c, i) =>
    `<div class="slash-item${i === slashSelectedIndex ? ' selected' : ''}" data-i="${i}">
       <span class="cmd">${c.cmd}</span><span class="desc">${c.desc}</span>
     </div>`
  ).join('');
  slashMenuEl.classList.remove('hidden');
  slashMenuEl.querySelectorAll('.slash-item').forEach(item => {
    item.addEventListener('click', () => applySlashCommand(matches[parseInt(item.dataset.i, 10)]));
  });
}

function applySlashCommand(command){
  inputEl.value = command.template;
  slashMenuEl.classList.add('hidden');
  inputEl.focus();
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
}

function currentSlashMatches(){
  return slashMatches(inputEl.value);
}

// --- streaming-respons verwerken (gedeeld door versturen, regenereren, na-bewerken) ---

async function consumeStream(resp, assistantTextEl, assistantBubble){
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';
  let thinkingAcc = '';
  let thinkingBlock = null;
  let thinkingStart = null;

  const closeThinking = () => {
    if(thinkingBlock && thinkingBlock.open){
      const secs = ((performance.now() - thinkingStart) / 1000).toFixed(1);
      thinkingBlock.querySelector('.thinking-dot').classList.remove('active');
      thinkingBlock.querySelector('.thinking-label').textContent = `Redenering (${secs}s)`;
      thinkingBlock.open = false;
    }
  };

  try{
    while(true){
      const { done, value } = await reader.read();
      if(done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // laatste, mogelijk onvolledige regel bewaren voor de volgende chunk
      for(const line of lines){
        if(!line.trim()) continue;
        const evt = JSON.parse(line);
        if(evt.type === 'thinking'){
          if(!thinkingBlock){
            thinkingStart = performance.now();
            thinkingBlock = createThinkingBlock();
            assistantBubble.insertBefore(thinkingBlock, assistantTextEl);
            thinkingBlock.open = true;
          }
          thinkingAcc += evt.text;
          thinkingBlock.querySelector('.thinking-block-body').textContent = thinkingAcc;
          scrollDown();
        } else if(evt.type === 'content'){
          closeThinking();
          acc += evt.text;
          renderMarkdown(assistantTextEl, acc);
          scrollDown();
        } else if(evt.type === 'error'){
          acc += `\n\n*[${evt.text}]*`;
          renderMarkdown(assistantTextEl, acc);
        } else if(evt.type === 'done' && evt.stats){
          const statsEl = document.createElement('div');
          statsEl.className = 'msg-stats';
          statsEl.textContent = `${evt.stats.tokens} tokens · ${evt.stats.tokens_per_sec ?? '?'} tok/s · ${evt.stats.seconds}s`;
          assistantBubble.appendChild(statsEl);
        }
      }
    }
  } finally {
    closeThinking();
  }
}

async function streamInto(fetchPromise, assistantTextEl, assistantBubble){
  isStreaming = true;
  sendBtn.classList.add('hidden');
  stopBtn.classList.add('visible');
  currentAbort = new AbortController();
  try{
    const resp = await fetchPromise(currentAbort.signal);
    await consumeStream(resp, assistantTextEl, assistantBubble);
  } catch(err){
    if(err.name === 'AbortError'){
      renderMarkdown(assistantTextEl, (assistantTextEl._raw || '') + '\n\n*[gestopt]*');
    } else {
      renderMarkdown(assistantTextEl, assistantTextEl._raw || '[Verbinding met server verbroken]');
    }
  } finally {
    assistantTextEl.classList.remove('streaming');
    isStreaming = false;
    currentAbort = null;
    sendBtn.classList.remove('hidden');
    stopBtn.classList.remove('visible');
    if(activeConv) await openConversation(activeConv);
  }
}

// --- versturen ---

async function send(){
  const text = inputEl.value.trim();
  if((!text && pendingImages.length === 0) || isStreaming) return;
  if(!activeConv && (modelSelect.disabled || !modelSelect.value)) return;

  if(!activeConv){
    const r = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        system_prompt: systemPromptEl.value.trim() || null,
        temperature: selectedTemp,
        num_ctx: numCtxEl.value === '' ? null : parseInt(numCtxEl.value, 10)
      })
    });
    const data = await r.json();
    activeConv = data.id;
    lockSettings(true);
  }

  const imagesForDisplay = pendingImages.map(p => ({ mime: p.mime, data: p.base64 }));
  const imagesToSend = pendingImages.map(p => p.base64);
  const filesToSend = pendingFiles.map(f => ({ name: f.name, content: f.content }));
  inputEl.value = '';
  inputEl.style.height = 'auto';
  addBubble('user', text, imagesForDisplay.length ? imagesForDisplay : null, null, null, {
    files: filesToSend.length ? filesToSend : null
  });
  pendingImages = [];
  pendingFiles = [];
  renderImageStrip();
  renderFileStrip();
  slashMenuEl.classList.add('hidden');

  const { textEl: assistantTextEl, bubble: assistantBubble } = addBubble('assistant', '', null, null);
  assistantTextEl.classList.add('streaming');
  scrollDown();

  await streamInto((signal) => fetch(`/api/chat/${activeConv}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text || '(afbeelding)',
      images: imagesToSend.length ? imagesToSend : null,
      files: filesToSend.length ? filesToSend : null
    }),
    signal
  }), assistantTextEl, assistantBubble);
}

// --- regenereren ---

async function regenerateLast(){
  if(isStreaming || !activeConv) return;
  const lastMsg = messagesEl.querySelector('.msg.assistant:last-child');
  if(lastMsg) lastMsg.remove();

  const { textEl: assistantTextEl, bubble: assistantBubble } = addBubble('assistant', '', null, null);
  assistantTextEl.classList.add('streaming');
  scrollDown();

  await streamInto((signal) => fetch(`/api/conversations/${activeConv}/regenerate`, {
    method: 'POST',
    signal
  }), assistantTextEl, assistantBubble);
}

// --- bericht bewerken ---

function startEditMessage(wrap, messageId, currentText){
  const bubble = wrap.querySelector('.bubble');
  const textEl = bubble.querySelector('.msg-text');
  const original = textEl.style.display;
  textEl.style.display = 'none';

  const area = document.createElement('textarea');
  area.className = 'edit-area';
  area.value = currentText;
  area.rows = Math.min(10, Math.max(2, currentText.split('\n').length));

  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  actions.innerHTML = `<button class="primary">Opslaan &amp; regenereer</button><button>Annuleren</button>`;

  bubble.insertBefore(area, textEl);
  bubble.insertBefore(actions, textEl);
  area.focus();

  actions.children[1].addEventListener('click', () => {
    area.remove();
    actions.remove();
    textEl.style.display = original;
  });

  actions.children[0].addEventListener('click', async () => {
    const newText = area.value.trim();
    if(!newText) return;
    if(!confirm('Dit verwijdert het antwoord en alles wat daarna komt in dit gesprek. Doorgaan?')) return;

    await fetch(`/api/conversations/${activeConv}/messages/${messageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newText })
    });

    // alles ná dit bericht weg uit de DOM, dan een nieuw antwoord genereren
    let sib = wrap.nextElementSibling;
    while(sib){ const next = sib.nextElementSibling; sib.remove(); sib = next; }
    textEl.textContent = newText;
    area.remove();
    actions.remove();
    textEl.style.display = original;

    const { textEl: assistantTextEl, bubble: assistantBubble } = addBubble('assistant', '', null, null);
    assistantTextEl.classList.add('streaming');
    scrollDown();

    await streamInto((signal) => fetch(`/api/conversations/${activeConv}/regenerate`, {
      method: 'POST',
      signal
    }), assistantTextEl, assistantBubble);
  });
}

function stopStreaming(){
  if(currentAbort) currentAbort.abort();
}

sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', stopStreaming);
inputEl.addEventListener('keydown', (e) => {
  const matches = currentSlashMatches();
  if(matches && !slashMenuEl.classList.contains('hidden')){
    if(e.key === 'ArrowDown'){ e.preventDefault(); slashSelectedIndex = Math.min(slashSelectedIndex + 1, matches.length - 1); renderSlashMenu(matches); return; }
    if(e.key === 'ArrowUp'){ e.preventDefault(); slashSelectedIndex = Math.max(slashSelectedIndex - 1, 0); renderSlashMenu(matches); return; }
    if(e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); applySlashCommand(matches[slashSelectedIndex]); return; }
    if(e.key === 'Escape'){ slashMenuEl.classList.add('hidden'); return; }
  }
  if(e.key === 'Enter' && !e.shiftKey){
    e.preventDefault();
    send();
  }
});
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  slashSelectedIndex = 0;
  renderSlashMenu(currentSlashMatches());
});
document.getElementById('new-chat').addEventListener('click', () => {
  deselectConversation();
  document.querySelectorAll('.conv-item.active').forEach(e => e.classList.remove('active'));
  inputEl.focus();
});

loadModels();
checkStatus();
setInterval(checkStatus, 15000);
loadConversations();

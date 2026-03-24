const fileInput = document.getElementById('fileInput');
const dropArea = document.getElementById('drop-area');
const results = document.getElementById('results');
const totalEl = document.getElementById('total');
const sendersEl = document.getElementById('senders');
const mediaEl = document.getElementById('media');
const senderTableBody = document.querySelector('#sender-table tbody');
const analyzeBtn = document.getElementById('analyzeBtn');
const fileInfo = document.getElementById('file-info');

let bufferedText = null;

fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) readFile(f);
});

['dragenter','dragover','dragleave','drop'].forEach(evt => {
  dropArea.addEventListener(evt, e => e.preventDefault());
});

dropArea.addEventListener('drop', e => {
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) readFile(f);
});

function readFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    bufferedText = reader.result;
    analyzeBtn.disabled = false;
    fileInfo.textContent = file.name || '';
  };
  reader.onerror = () => alert('Failed to read file');
  reader.readAsText(file);
}

analyzeBtn.addEventListener('click', () => {
  if (!bufferedText) return alert('No file loaded');
  processText(bufferedText);
});

function processText(text){
  const {messages, perSender, media} = parseWhatsAppExport(text);
  updateUI(messages.length, perSender, media);
}

function parseWhatsAppExport(text){
  const lines = text.split(/\r?\n/);

  // Detect message-start lines. Covers common Android/iPhone formats.
  const msgStart = /^(?:\[)?(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})[,\s\-T]+\d{1,2}:\d{2}/;

  const messages = [];
  let current = null;
  for (const line of lines){
    if (msgStart.test(line)){
      if (current) messages.push(current);
      current = {raw: line};
    } else {
      if (current) current.raw += '\n' + line;
    }
  }
  if (current) messages.push(current);

  const perSender = new Map();
  let mediaCount = 0;

  // common system-message patterns to ignore
  const systemRegex = /(messages and calls are end-to-end encrypted|messages to this chat and calls are now secured|this message was deleted|changed the subject|changed the group description|joined using this group's invite link|created group|added|removed|left|was added|was removed|were added|changed the subject|changed the group icon)/i;

  for (const m of messages){
    // try to extract sender
    // common pattern: "date, time - Sender: message"
    const split = m.raw.split(' - ');
    let rest = split.slice(1).join(' - ');
    let sender = 'Unknown';
    if (rest){
      const colonIdx = rest.indexOf(':');
      if (colonIdx > 0){
        sender = rest.slice(0, colonIdx).trim();
        m.text = rest.slice(colonIdx+1).trim();
      } else {
        m.text = rest.trim();
      }
    } else {
      // fallback: try after "] " style
      const alt = m.raw.split('] ');
      if (alt.length>1){
        const after = alt.slice(1).join('] ');
        const c = after.indexOf(':');
        if (c>0){ sender = after.slice(0,c).trim(); m.text = after.slice(c+1).trim(); }
      }
    }

    const textBody = (m.text || '').trim();

    // determine if this is a system message (no sender or one of known system phrases)
    let isSystem = false;
    if (sender === 'Unknown'){
      if (!textBody) isSystem = true;
      else if (systemRegex.test(textBody)) isSystem = true;
    }

    if (isSystem) continue; // skip counting system messages entirely

    if (!perSender.has(sender)) perSender.set(sender, {count:0, media:0});
    const cur = perSender.get(sender);
    cur.count += 1;

    if (textBody && /<Media omitted>|\<arquivo de mídia omitido\>|<arquivo de mídia omitido>/i.test(textBody)){
      mediaCount++;
      cur.media += 1;
    }
  }

  return {messages, perSender, media: mediaCount};
}

function updateUI(total, perSenderMap, media){
  results.classList.remove('hidden');
  totalEl.textContent = total;
  sendersEl.textContent = perSenderMap.size;
  mediaEl.textContent = media;

  senderTableBody.innerHTML = '';
  const rows = Array.from(perSenderMap.entries()).sort((a,b)=>b[1].count - a[1].count);
  for (const [sender,info] of rows){
    const tr = document.createElement('tr');
    const td1 = document.createElement('td'); td1.textContent = sender;
    const td2 = document.createElement('td'); td2.textContent = info.count;
    const td3 = document.createElement('td'); td3.textContent = info.media || 0;
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    senderTableBody.appendChild(tr);
  }
}

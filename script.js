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
  const result = parseWhatsAppExport(text);
  saveAndOpenResults(result);
}
function saveAndOpenResults(result){
  const {messages, perSender, media, perDay, perSenderDay} = result;
  const senders = Array.from(perSender.entries()).map(([name,info])=>({name, count: info.count, media: info.media || 0}));
  // build combined text from parsed messages, skipping obvious system messages
  const systemRegex = /(messages and calls are end-to-end encrypted|messages to this chat and calls are now secured|this message was deleted|changed the subject|changed the group description|joined using this group's invite link|created group|added|removed|left|was added|was removed|were added|changed the subject|changed the group icon)/i;
  const combined = (messages || []).map(m=>{
    const t = (m.text||'').trim();
    if (!t) return '';
    if (systemRegex.test(t)) return '';
    return t;
  }).filter(Boolean).join(' ');
  // use perDay and perSenderDay provided by parser
  const perDayList = Array.isArray(perDay) ? perDay : (perDay instanceof Map ? Array.from(perDay.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date,count])=>({date,count})) : []);
  // build per-sender daily arrays aligned to perDayList dates
  const dates = perDayList.map(x=>x.date);
  const perSenderDayList = senders.map(s => {
    const name = s.name;
    const daily = dates.map(d => {
      let count = 0;
      if (perSenderDay && perSenderDay[name] && typeof perSenderDay[name] === 'object'){
        count = perSenderDay[name][d] || 0;
      } else if (perSenderDay instanceof Map && perSenderDay.has(name)){
        const m = perSenderDay.get(name);
        count = m && m.get ? (m.get(d) || 0) : 0;
      }
      return {date:d, count};
    });
    return {name, daily};
  });

  const payload = { total: messages.length, media, senders, text: combined, perDay: perDayList, perSenderDay: perSenderDayList };
  try {
    sessionStorage.setItem('wa_results', JSON.stringify(payload));
    window.location.href = 'results.html';
  } catch (e){
    alert('Failed to store results for navigation: ' + e);
  }
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
  const perDay = new Map();
  const perSenderDay = new Map();

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

    // extract date key (YYYY-MM-DD) from the message raw start
    const dateMatch = m.raw.match(/^(?:\[)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (dateMatch){
      let d = dateMatch[1];
      if (/\d{4}-\d{2}-\d{2}/.test(d)){
        // already ISO
      } else {
        // dd/mm/yyyy or d/m/yy
        const parts = d.split('/').map(s=>s.padStart(2,'0'));
        // parts = [dd,mm,yyyy]
        let dd = parts[0];
        let mm = parts[1];
        let yy = parts[2];
        if (yy.length===2) yy = '20'+yy;
        d = `${yy}-${mm}-${dd}`;
      }
      perDay.set(d, (perDay.get(d)||0) + 1);
      // per-sender per-day
      if (!perSenderDay.has(sender)) perSenderDay.set(sender, new Map());
      const sm = perSenderDay.get(sender);
      sm.set(d, (sm.get(d)||0) + 1);
    }
  }

  return {messages, perSender, media: mediaCount, perDay, perSenderDay};
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

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
  const systemRegex = /(messages and calls are end-to-end encrypted|messages to this chat and calls are now secured|this message was deleted|changed the subject|changed the group description|joined using this group's invite link|created group|added|removed|left|was added|was removed|were added|changed the subject|changed the group icon|pinned a message)/i;
  const combined = (messages || []).map(m=>{
    const t = (m.text||'').trim();
    if (!t) return '';
    if (systemRegex.test(t)) return '';
    return t;
  }).filter(Boolean).join(' ');
  // compute per-sender message-level word stats (total words, longest message, avg words/msg)
  const perSenderMsgStats = Object.create(null);
  for (const s of senders){ perSenderMsgStats[s.name] = { totalWords:0, longest:0, messages:0 }; }
  for (const m of messages){
    const text = (m.text||'').trim();
    if (!text) continue;
    if (systemRegex.test(text))
       continue;
    const name = m.sender || 'Unknown';
    if (!perSenderMsgStats[name]) perSenderMsgStats[name] = { totalWords:0, longest:0, messages:0 };
    // count words without removing stopwords
    const cleaned = String(text).replace(/[^\p{L}\p{N}'\s]+/gu,' ');
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const wc = parts.length;
    perSenderMsgStats[name].totalWords += wc;
    perSenderMsgStats[name].messages += 1;
    if (wc > perSenderMsgStats[name].longest) perSenderMsgStats[name].longest = wc;
  }
  // attach stats to senders array
  for (const s of senders){
    const st = perSenderMsgStats[s.name] || { totalWords:0, longest:0, messages:0 };
    s.wordsTotal = st.totalWords;
    s.longest = st.longest;
    s.avgWords = st.messages ? (st.totalWords / st.messages) : 0;
  }
  // compute unique words (wordstock) per sender from senderTexts
  const wordstock = Object.create(null);
  for (const s of senders){
    wordstock[s.name] = 0;
  }
  for (const [name, text] of Object.entries((() => {
    const tmp = Object.create(null);
    for (const m of messages){
      const t = (m.text||'').trim();
      if (!t) continue;
      if (systemRegex.test(t)) continue;
      const who = m.sender || 'Unknown';
      tmp[who] = (tmp[who] || '') + ' ' + t;
    }
    return tmp;
  })())){
    try {
      const cleaned = String(text).toLowerCase().replace(/[^\p{L}\p{N}'\s]+/gu,' ');
      const parts = cleaned.split(/\s+/).filter(Boolean);
      const set = new Set(parts);
      wordstock[name] = set.size;
    } catch (e){ wordstock[name] = 0; }
  }
  for (const s of senders){ s.wordstock = wordstock[s.name] || 0; }
  // build per-sender concatenated text for participant-specific analysis
  const senderTexts = Object.create(null);
  for (const m of messages){
    const text = (m.text||'').trim();
    if (!text) continue;
    if (systemRegex.test(text)) continue;
    const s = m.sender || 'Unknown';
    senderTexts[s] = (senderTexts[s] || '') + ' ' + text;
  }
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

  // compute per-sender per-day total words (for average message length graph)
  const perSenderDayWordsMap = Object.create(null);
  for (const s of senders) perSenderDayWordsMap[s.name] = Object.create(null);
  const dateRx = /^(?:\[)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;
  for (const m of messages){
    const text = (m.text||'').trim();
    if (!text) continue;
    if (systemRegex.test(text)) continue;
    const dm = m.raw.match(dateRx);
    if (!dm) continue;
    let d = dm[1];
    if (!/\d{4}-\d{2}-\d{2}/.test(d)){
      const parts = d.split('/').map(s=>s.padStart(2,'0'));
      let dd = parts[0], mm = parts[1], yy = parts[2]; if (yy.length===2) yy = '20'+yy; d = `${yy}-${mm}-${dd}`;
    }
    const who = m.sender || 'Unknown';
    const cleaned = String(text).replace(/[^\n\p{L}\p{N}'\s]+/gu,' ');
    const wc = cleaned.split(/\s+/).filter(Boolean).length;
    perSenderDayWordsMap[who] = perSenderDayWordsMap[who] || Object.create(null);
    perSenderDayWordsMap[who][d] = (perSenderDayWordsMap[who][d]||0) + wc;
  }
  const perSenderDayWordsList = senders.map(s => ({ name: s.name, daily: dates.map(d=>({ date:d, words: perSenderDayWordsMap[s.name] ? (perSenderDayWordsMap[s.name][d]||0) : 0 })) }));

  const payload = { total: messages.length, media, senders, text: combined, perDay: perDayList, perSenderDay: perSenderDayList, perSenderDayWords: perSenderDayWordsList };
  // attach per-sender texts
  payload.senderTexts = senderTexts;

  // compute average response times per sender (ignore responses over 24 hours)
  const resp = Object.create(null);
  const limit = 24 * 3600 * 1000;
  let prev = null;
  for (const m of messages){
    if (!m || !m.sender || !m.ts) { if (!m) continue; prev = (!m.text || systemRegex.test(m.text)) ? prev : m; continue; }
    if (!m.text || systemRegex.test(m.text)) continue;
    if (prev && prev.sender && prev.ts && m.sender !== prev.sender){
      const diff = m.ts - prev.ts;
      if (diff > 0 && diff <= limit){
        resp[m.sender] = resp[m.sender] || {sum:0,count:0};
        resp[m.sender].sum += diff;
        resp[m.sender].count += 1;
      }
    }
    prev = m;
  }
  // attach avgResponse (minutes) to senders
  for (const s of senders){
    const r = resp[s.name];
    s.avgResponseMin = (r && r.count) ? Math.round((r.sum / r.count) / 60000 * 10) / 10 : 0;
  }
  // compute per-sender per-day average response times (minutes) for a time series
  const perSenderDayRespMap = Object.create(null);
  const msgsSorted = (messages || []).slice().filter(m=>m && m.ts && m.sender && m.text && !systemRegex.test(m.text)).sort((a,b)=>a.ts - b.ts);
  let p = null;
  for (const m of msgsSorted){
    if (p && p.sender && p.ts && m.sender !== p.sender){
      const diff = m.ts - p.ts;
      if (diff > 0 && diff <= limit){
        const day = new Date(m.ts).toISOString().slice(0,10);
        perSenderDayRespMap[m.sender] = perSenderDayRespMap[m.sender] || Object.create(null);
        perSenderDayRespMap[m.sender][day] = perSenderDayRespMap[m.sender][day] || { sum:0, count:0 };
        perSenderDayRespMap[m.sender][day].sum += diff;
        perSenderDayRespMap[m.sender][day].count += 1;
      }
    }
    p = m;
  }
  // convert perSenderDayRespMap to list aligned with dates
  const perSenderDayResponsesList = senders.map(s => ({ name: s.name, daily: dates.map(d => {
    const cell = perSenderDayRespMap[s.name] && perSenderDayRespMap[s.name][d];
    const avgMin = (cell && cell.count) ? Math.round((cell.sum / cell.count) / 60000 * 10) / 10 : 0;
    return { date: d, avg: avgMin };
  }) }));
  try {
    sessionStorage.setItem('wa_results', JSON.stringify(payload));
    // attach the per-day response-time series to the payload storage as well
    const stored = JSON.parse(sessionStorage.getItem('wa_results')) || {};
    stored.perSenderDayResponses = perSenderDayResponsesList;
    sessionStorage.setItem('wa_results', JSON.stringify(stored));
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
  const systemRegex = /(messages and calls are end-to-end encrypted|messages to this chat and calls are now secured|this message was deleted|changed the subject|changed the group description|joined using this group's invite link|created group|added|removed|left|was added|was removed|were added|changed the group icon|pinned a message|pinned message|unpinned a message|pinned|unpinned)/i;

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
        m.sender = sender;
      } else {
        m.text = rest.trim();
        m.sender = sender;
      }
    } else {
      // fallback: try after "] " style
      const alt = m.raw.split('] ');
      if (alt.length>1){
        const after = alt.slice(1).join('] ');
        const c = after.indexOf(':');
        if (c>0){ sender = after.slice(0,c).trim(); m.text = after.slice(c+1).trim(); }
        m.sender = sender;
      }
    }
    if(sender === 'Unknown')
      console.log(m);

    const textBody = (m.text || '').trim();

    // determine if this is a system message (no sender or one of known system phrases)
    let isSystem = false;
    if (sender === 'Unknown'){
      if (!textBody) isSystem = true;
      else if (systemRegex.test(textBody)) isSystem = true;
    }

    if (isSystem) continue; // skip counting system messages entirely

    // ensure message records have sender and text for later per-sender text aggregation
    m.sender = m.sender || sender;
    m.text = m.text || '';

    if (!perSender.has(sender)) perSender.set(sender, {count:0, media:0});
    const cur = perSender.get(sender);
    cur.count += 1;

    if (textBody && /<Media omitted>/i.test(textBody)){
      mediaCount++;
      cur.media += 1;
    }

    // extract date and time from the message raw start and store timestamp
    const dtMatch = m.raw.match(/^(?:\[)?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})[^\d]*(\d{1,2}:\d{2})/);
    if (dtMatch){
      let d = dtMatch[1];
      const time = dtMatch[2];
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
      // set a timestamp (local) for this message using the extracted time
      try {
        const iso = `${d}T${(typeof time !== 'undefined' ? time : '00:00')}:00`;
        m.ts = new Date(iso).getTime();
      } catch(e){ m.ts = null; }
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

const API = (window.location.protocol === 'file:' || (window.location.port && !['5000', '5001'].includes(window.location.port)))
  ? 'http://localhost:5001'
  : '';
const form = document.querySelector('#callForm');
const message = document.querySelector('#formMessage');
const taskList = document.querySelector('#taskList');
const simModalContainer = document.querySelector('#simModalContainer');

let loadedTasks = [];

function statusLabel(s) {
  return ({
    pending: 'Pending',
    calling: 'Calling',
    retry_scheduled: 'Retry in 10 min',
    completed: 'Completed',
    no_answer: 'No answer',
    failed: 'Failed',
    cancelled: 'Cancelled'
  })[s] || s;
}

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

async function request(path, options={}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

async function refresh() {
  try {
    // Dynamically update active backend mode (Supabase vs Demo)
    request('/health').then(health => {
      const modeText = document.querySelector('#modeText');
      const modeDot = document.querySelector('#modeDot');
      const sideTitle = document.querySelector('#sideNoteTitle');
      const sideSub = document.querySelector('#sideNoteSub');
      if (health.mode === 'supabase') {
        if (modeText) modeText.textContent = health.liveCallsEnabled ? 'LIVE SUPABASE' : 'SUPABASE CONNECTED';
        if (modeDot) modeDot.style.background = '#10b981';
        if (sideTitle) sideTitle.textContent = 'Supabase PostgreSQL';
        if (sideSub) sideSub.textContent = 'Persistent cloud storage';
      } else {
        if (modeText) modeText.textContent = health.liveCallsEnabled ? 'LIVE CALLS ACTIVE' : 'SAFE DEMO MODE';
        if (modeDot) modeDot.style.background = '#e5a33b';
        if (sideTitle) sideTitle.textContent = 'Development mode';
        if (sideSub) sideSub.textContent = 'In-memory demo storage';
      }
    }).catch(() => {});

    const { tasks = [] } = await request('/api/calls');
    loadedTasks = tasks;
    document.querySelector('#totalCount').textContent = tasks.length;
    document.querySelector('#completedCount').textContent = tasks.filter(t => t.status === 'completed').length;
    document.querySelector('#retryCount').textContent = tasks.filter(t => t.status === 'retry_scheduled').length;
    document.querySelector('#failedCount').textContent = tasks.filter(t => ['failed', 'no_answer'].includes(t.status)).length;

    if (!tasks.length) {
      taskList.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><b>No call tasks yet</b><span>Create your first task to see it here.</span></div>';
      return;
    }

    taskList.innerHTML = tasks.map(t => `
      <div class="task-item">
        <div class="task-top">
          <div>
            <div class="task-name">${escapeHtml(t.contact_name)}</div>
            <div class="task-phone">${escapeHtml(t.phone_number)}</div>
          </div>
          <span class="pill ${escapeHtml(t.status)}">${escapeHtml(statusLabel(t.status))}</span>
        </div>
        <div class="task-instruction">${escapeHtml(t.instruction)}</div>
        <div class="task-actions">
          <span class="task-date">${new Date(t.created_at).toLocaleString()}</span>
          <div class="task-actions-right">
            ${['pending', 'retry_scheduled', 'no_answer', 'failed'].includes(t.status) ? `
              <button class="whatsapp-btn" data-whatsapp="${escapeHtml(t.id)}">📲 WhatsApp Call</button>
              <button class="dial-btn" data-dial="${escapeHtml(t.id)}">📱 Call Phone</button>
              <button class="simulate-btn" data-simulate="${escapeHtml(t.id)}">💬 Simulate</button>
              <button class="cancel-btn" data-cancel="${escapeHtml(t.id)}">Cancel</button>
            ` : ''}
          </div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    message.textContent = `Backend unavailable: ${e.message}`;
    message.className = 'form-message error';
  }
}

// Speak text using Web Speech API
function speakText(text, language = 'en') {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === 'hi' ? 'hi-IN' : 'en-US';
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('Speech synthesis error:', e);
  }
}

// Call Simulator logic
async function openSimulator(taskId) {
  const task = loadedTasks.find(t => t.id === taskId);
  if (!task) return alert('Task not found.');

  let durationSeconds = 0;
  let timerInterval = null;
  let transcript = [];
  let plan = null;
  let voiceEnabled = true;

  simModalContainer.innerHTML = `
    <div class="modal-backdrop" id="simBackdrop">
      <div class="sim-modal" role="dialog" aria-modal="true">
        <div class="sim-header">
          <div class="sim-caller-info">
            <div class="sim-avatar">AI</div>
            <div>
              <div class="sim-caller-name">Call with ${escapeHtml(task.contact_name)}</div>
              <div class="sim-caller-status">
                <span class="sim-status-pulse"></span>
                <span id="simStatusText">Connecting via Gemini AI…</span>
              </div>
            </div>
          </div>
          <div class="sim-timer" id="simTimer">00:00</div>
        </div>

        <div class="sim-messages" id="simMessages">
          <div class="sim-bubble assistant">
            <small>CALLMATE AI</small>
            <i>Preparing conversation plan with Gemini AI…</i>
          </div>
        </div>

        <div class="sim-quick-replies" id="simQuickReplies"></div>

        <form class="sim-input-row" id="simInputForm">
          <input id="simReplyInput" placeholder="Type your response as ${escapeHtml(task.contact_name)}…" autocomplete="off" disabled>
          <button class="sim-send-btn" type="submit" id="simSendBtn" disabled>Send</button>
        </form>

        <div class="sim-footer-bar">
          <label class="sim-voice-toggle">
            <input type="checkbox" id="simVoiceCheckbox" checked>
            <span>Voice audio (TTS)</span>
          </label>
          <button class="sim-end-btn" id="simEndBtn">
            <span>✕</span> End Call
          </button>
        </div>
      </div>
    </div>
  `;

  const messagesDiv = document.querySelector('#simMessages');
  const timerDiv = document.querySelector('#simTimer');
  const statusText = document.querySelector('#simStatusText');
  const quickRepliesDiv = document.querySelector('#simQuickReplies');
  const replyInput = document.querySelector('#simReplyInput');
  const sendBtn = document.querySelector('#simSendBtn');
  const inputForm = document.querySelector('#simInputForm');
  const endBtn = document.querySelector('#simEndBtn');
  const voiceCheckbox = document.querySelector('#simVoiceCheckbox');

  voiceCheckbox.addEventListener('change', e => {
    voiceEnabled = e.target.checked;
    if (!voiceEnabled && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  });

  // Start call timer
  timerInterval = setInterval(() => {
    durationSeconds++;
    const m = String(Math.floor(durationSeconds / 60)).padStart(2, '0');
    const s = String(durationSeconds % 60).padStart(2, '0');
    timerDiv.textContent = `${m}:${s}`;
  }, 1000);

  function appendBubble(speaker, text) {
    const isAssistant = speaker === 'assistant';
    const div = document.createElement('div');
    div.className = `sim-bubble ${speaker}`;
    div.innerHTML = `<small>${isAssistant ? 'CALLMATE AI' : escapeHtml(task.contact_name.toUpperCase())}</small>${escapeHtml(text)}`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    if (isAssistant && voiceEnabled) {
      speakText(text, task.language);
    }
  }

  function renderQuickChips(chips) {
    quickRepliesDiv.innerHTML = chips.map(c => `<button class="sim-chip" type="button">${escapeHtml(c)}</button>`).join('');
  }

  async function handleUserSend(userText) {
    if (!userText || !plan) return;
    replyInput.value = '';
    replyInput.disabled = true;
    sendBtn.disabled = true;

    appendBubble('recipient', userText);
    transcript.push({ speaker: 'recipient', text: userText });

    statusText.textContent = 'CallMate AI is responding…';

    try {
      const { reply } = await request('/api/assistant/reply', {
        method: 'POST',
        body: JSON.stringify({
          language: task.language,
          recipientName: task.contact_name,
          objective: plan.objective,
          keyPoints: plan.key_points,
          transcript,
          recipientMessage: userText
        })
      });

      appendBubble('assistant', reply);
      transcript.push({ speaker: 'assistant', text: reply });
      statusText.textContent = 'Connected (Call in progress)';
    } catch (err) {
      appendBubble('assistant', `[Error: ${err.message}]`);
      statusText.textContent = 'Error in AI generation';
    } finally {
      replyInput.disabled = false;
      sendBtn.disabled = false;
      replyInput.focus();
    }
  }

  // Handle End Call
  async function cleanupAndClose(complete = false) {
    clearInterval(timerInterval);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (complete) {
      try {
        await request(`/api/calls/${task.id}/complete`, { method: 'POST' });
      } catch (e) {
        console.warn('Failed to mark task completed:', e);
      }
      await refresh();
    }
    simModalContainer.innerHTML = '';
  }

  endBtn.addEventListener('click', () => cleanupAndClose(true));

  quickRepliesDiv.addEventListener('click', e => {
    if (e.target.classList.contains('sim-chip')) {
      handleUserSend(e.target.textContent);
    }
  });

  inputForm.addEventListener('submit', e => {
    e.preventDefault();
    const txt = replyInput.value.trim();
    if (txt) handleUserSend(txt);
  });

  // Prepare call plan via Gemini
  try {
    const res = await request('/api/assistant/prepare', {
      method: 'POST',
      body: JSON.stringify({
        contactName: task.contact_name,
        instruction: task.instruction,
        language: task.language
      })
    });

    plan = res.plan;
    messagesDiv.innerHTML = '';
    appendBubble('assistant', plan.opening_message);
    transcript.push({ speaker: 'assistant', text: plan.opening_message });

    statusText.textContent = 'Connected (Call in progress)';
    replyInput.disabled = false;
    sendBtn.disabled = false;
    replyInput.focus();

    // Context-sensitive quick chips
    if (task.language === 'hi') {
      renderQuickChips([
        'हाँ बोलिए, मैं सुन रहा हूँ।',
        'मैं अभी थोड़ा व्यस्त हूँ, बाद में बात करें?',
        'ठीक है, धन्यवाद।',
        'क्या आप दोबारा बता सकते हैं?'
      ]);
    } else {
      renderQuickChips([
        'Yes, go ahead please.',
        'I am busy right now, can you call later?',
        'Got it, thank you!',
        'Could you repeat that?'
      ]);
    }
  } catch (err) {
    messagesDiv.innerHTML = `<div class="sim-bubble assistant"><small>SYSTEM</small>Failed to prepare call: ${escapeHtml(err.message)}</div>`;
    statusText.textContent = 'Failed to connect';
  }
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  message.textContent = 'Creating task…';
  message.className = 'form-message';
  try {
    const payload = {
      contactName: document.querySelector('#contactName').value.trim(),
      phoneNumber: document.querySelector('#phoneNumber').value.trim().replace(/[\s()-]/g, ''),
      instruction: document.querySelector('#instruction').value.trim(),
      language: document.querySelector('#language').value,
      recipientConsentConfirmed: document.querySelector('#consent').checked,
      maxAttempts: 2
    };
    const result = await request('/api/calls', { method: 'POST', body: JSON.stringify(payload) });
    message.textContent = result.mode === 'supabase'
      ? 'Task saved to Supabase PostgreSQL database. No live call placed.'
      : (result.mode === 'demo' ? 'Task saved in demo mode. No phone call was placed.' : 'Task queued.');
    form.reset();
    await refresh();
  } catch (err) {
    message.textContent = err.message;
    message.className = 'form-message error';
  }
});

taskList.addEventListener('click', async e => {
  const whatsappId = e.target.dataset.whatsapp;
  if (whatsappId) {
    const task = loadedTasks.find(t => t.id === whatsappId);
    if (!task) return;
    const callUrl = `${window.location.origin}/call/${task.id}`;
    const cleanPhone = task.phone_number.replace(/[^0-9]/g, '');
    const greetingText = task.language === 'hi'
      ? `नमस्ते ${task.contact_name}! कॉलमेट एआई की तरफ़ से आपके लिए एक आवश्यक वॉइस कॉल है ("${task.instruction}")।\n\n👉 कॉल उठाने के लिए यहाँ क्लिक करें:\n${callUrl}`
      : `Hello ${task.contact_name}! You have an incoming AI voice call from CallMate regarding: "${task.instruction}".\n\n👉 Tap here to answer the voice call:\n${callUrl}`;
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(greetingText)}`;
    window.open(waUrl, '_blank');
    return;
  }

  const dialId = e.target.dataset.dial;
  if (dialId) {
    const task = loadedTasks.find(t => t.id === dialId);
    const targetName = task ? `${task.contact_name} (${task.phone_number})` : 'recipient';
    if (!confirm(`Place live phone call now to ${targetName}?`)) return;
    const btn = e.target;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Calling…';
    try {
      const res = await request(`/api/calls/${dialId}/dial`, { method: 'POST' });
      alert(`Call initiated! Twilio Call SID: ${res.sid}\nYour phone will ring in a few seconds.`);
      await refresh();
    } catch (err) {
      alert(`Could not place call: ${err.message}`);
      btn.disabled = false;
      btn.textContent = origText;
      await refresh();
    }
    return;
  }

  const cancelId = e.target.dataset.cancel;
  if (cancelId) {
    if (!confirm('Cancel this pending task?')) return;
    try {
      await request(`/api/calls/${cancelId}/cancel`, { method: 'POST' });
      await refresh();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  const simulateId = e.target.dataset.simulate;
  if (simulateId) {
    openSimulator(simulateId);
  }
});

document.querySelector('#refreshBtn').addEventListener('click', refresh);

const prepareAiBtn = document.querySelector('#prepareAiBtn');
const aiStatus = document.querySelector('#aiStatus');
const aiPlan = document.querySelector('#aiPlan');

prepareAiBtn.addEventListener('click', async () => {
  const contactName = document.querySelector('#contactName').value.trim();
  const instruction = document.querySelector('#instruction').value.trim();
  const language = document.querySelector('#language').value;
  if (!contactName || instruction.length < 3) {
    aiStatus.textContent = 'Enter the recipient name and call instruction first.';
    return;
  }
  prepareAiBtn.disabled = true;
  aiStatus.textContent = 'CallMate AI is preparing the call brief…';
  aiPlan.hidden = true;
  try {
    const { plan } = await request('/api/assistant/prepare', {
      method: 'POST',
      body: JSON.stringify({ contactName, instruction, language })
    });
    aiPlan.innerHTML = `<b>AI-prepared call brief</b>
      <p><strong>Goal:</strong> ${escapeHtml(plan.objective)}</p>
      <p><strong>Opening:</strong> ${escapeHtml(plan.opening_message)}</p>
      <p><strong>Key points:</strong> ${escapeHtml(plan.key_points.join(' · ') || 'None')}</p>
      <p><strong>If asked something unknown:</strong> ${escapeHtml(plan.if_unknown)}</p>
      ${plan.clarification_needed ? `<p><strong>Clarification needed:</strong> ${escapeHtml(plan.clarification_question)}</p>` : ''}`;
    aiPlan.hidden = false;
    aiStatus.textContent = 'Prepared by Gemini AI. Review it before creating a task; no call has been placed.';
  } catch (error) {
    aiStatus.textContent = error.message;
  } finally {
    prepareAiBtn.disabled = false;
  }
});

refresh();

// ─────────────────────────────────────────────────────────────
// background.js
// Alt+Shift+Z: grab Meet captions → copy to clipboard (non-streaming)
// streamer.js: push AI response chunks → relay WebSocket (streaming)
// ─────────────────────────────────────────────────────────────

const EXPIRY_MS = 10 * 60 * 60 * 1000; // 10 hours

// ── Relay config — replace with your deployed Railway URL ────
const RELAY_WS_URL = 'wss://relay.vhagar.online';
const RELAY_SECRET = '60o5Ihbg8ODRLaAiWx7mwcsQtBEzGe4Y'; // must match server RELAY_SECRET env var

// ── Auth check ───────────────────────────────────────────────

async function isAuthorized() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authTime'], ({ authTime }) => {
      resolve(authTime && (Date.now() - authTime) < EXPIRY_MS);
    });
  });
}

// ── Relay WebSocket connection ────────────────────────────────

let relayWs = null;
let relayConnecting = false;
let relayReconnectTimer = null;

function connectRelay() {
  if (relayWs && (relayWs.readyState === WebSocket.OPEN || relayWs.readyState === WebSocket.CONNECTING)) return;
  if (relayConnecting) return;
  relayConnecting = true;

  const url = `${RELAY_WS_URL}?role=publisher&secret=${encodeURIComponent(RELAY_SECRET)}`;
  relayWs = new WebSocket(url);

  relayWs.onopen = () => {
    relayConnecting = false;
    clearTimeout(relayReconnectTimer);
    console.log('[MCA] Relay connected');
  };

  relayWs.onclose = () => {
    relayConnecting = false;
    relayWs = null;
    // Reconnect after 5s
    relayReconnectTimer = setTimeout(connectRelay, 5000);
  };

  relayWs.onerror = () => {
    relayConnecting = false;
  };
}

function relayReady() {
  return relayWs && relayWs.readyState === WebSocket.OPEN;
}

function relaySend(msg) {
  if (!relayReady()) {
    connectRelay();
    return;
  }
  relayWs.send(JSON.stringify(msg));
}

// Start relay connection immediately
connectRelay();

// ── Messages from streamer.js ─────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RELAY_PING') {
    sendResponse({ connected: relayReady() });
    return true;
  }
  if (message.type === 'RELAY_STREAM_START') {
    relaySend({ type: 'stream-start' });
  } else if (message.type === 'RELAY_STREAM_CHUNK') {
    relaySend({ type: 'stream-chunk', html: message.html });
  } else if (message.type === 'RELAY_STREAM_END') {
    relaySend({ type: 'stream-end' });
  } else if (message.type === 'RELAY_MANUAL') {
    // From the manual clipboard capture path
    relaySend({ type: 'manual-content', html: message.html, replace: message.replace });
  }
});

// ── Caption capture command (Alt+Shift+Z) ────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-caption') return;

  if (!(await isAuthorized())) {
    chrome.action.openPopup?.();
    console.warn('[MCA] Not authorized — open the extension popup to unlock.');
    return;
  }

  // ── Step 1: Find the Meet tab ─────────────────────────────
  const [meetTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let targetTab = meetTab;
  if (!meetTab?.url?.includes('meet.google.com')) {
    const meetTabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (!meetTabs.length) return;
    targetTab = meetTabs[0];
  }

  const tabId = targetTab.id;

  // ── Step 2: Inject content script if needed ───────────────
  let response;
  try {
    response = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE' });
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      response = await chrome.tabs.sendMessage(tabId, { type: 'CAPTURE' });
    } catch (e2) {
      console.warn('[MCA] Could not reach content script:', e2.message);
      return;
    }
  }

  if (!response?.ok) {
    console.warn('[MCA]', response?.error || 'No caption text found');
    return;
  }

  const prompt = response.text;

  // ── Step 3: Write to clipboard ────────────────────────────
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (text) => {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    },
    args: [prompt],
  });

  console.log('[MCA] Caption copied to clipboard, AHK can now paste.');
});

// ── Manual content relay (Alt+Q → append, Alt+W → replace) ──
// AHK sends Alt+Shift+M or Alt+Shift+R to trigger these.
// The extension reads the clipboard and forwards to the relay.

async function handleManualRelay(replace) {
  if (!(await isAuthorized())) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => navigator.clipboard.readText(),
  }).catch(() => null);

  const text = results?.[0]?.result;
  if (!text) return;

  const html = text
    .split('\n\n')
    .filter(Boolean)
    .map(para => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');

  relaySend({ type: 'manual-content', html, replace });
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'relay-manual') handleManualRelay(false);
  if (command === 'relay-manual-replace') handleManualRelay(true);
});

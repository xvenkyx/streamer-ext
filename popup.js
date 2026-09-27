const PASSWORD = 'bingomadangles';
const EXPIRY_MS = 10 * 60 * 60 * 1000; // 10 hours

const statusEl   = document.getElementById('status');
const titleEl    = document.getElementById('title');
const pwdEl      = document.getElementById('pwd');
const settingsEl = document.getElementById('settings');
const dividerEl  = document.getElementById('settings-divider');
const relayEl    = document.getElementById('relay-status');
const streamToggle = document.getElementById('streaming-toggle');

// ── Auth state on open ────────────────────────────────────────

chrome.storage.local.get(['authTime', 'streamingEnabled'], ({ authTime, streamingEnabled }) => {
  const now = Date.now();
  if (authTime && (now - authTime) < EXPIRY_MS) {
    showUnlocked(now - authTime);
  }

  // Default streaming to ON if never set
  if (streamingEnabled === undefined) {
    chrome.storage.local.set({ streamingEnabled: true });
    streamToggle.checked = true;
  } else {
    streamToggle.checked = streamingEnabled;
  }
});

function showUnlocked(elapsed) {
  const hoursLeft = ((EXPIRY_MS - elapsed) / 3600000).toFixed(1);
  titleEl.textContent = 'Extension is active';
  pwdEl.style.display = 'none';
  document.querySelector('button.primary').style.display = 'none';
  statusEl.className = 'ok';
  statusEl.textContent = `Unlocked — ${hoursLeft}h remaining`;
  settingsEl.style.display = 'block';
  dividerEl.style.display = 'block';
  checkRelayStatus();
}

// ── Password submit ───────────────────────────────────────────

pwdEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

function submit() {
  const val = pwdEl.value.trim();
  if (val === PASSWORD) {
    const now = Date.now();
    chrome.storage.local.set({ authTime: now });
    statusEl.className = 'ok';
    statusEl.textContent = 'Unlocked for 10 hours!';
    pwdEl.value = '';
    showUnlocked(0);
  } else {
    statusEl.className = 'err';
    statusEl.textContent = 'Wrong password.';
  }
}

// ── Streaming toggle ──────────────────────────────────────────

streamToggle.addEventListener('change', () => {
  chrome.storage.local.set({ streamingEnabled: streamToggle.checked });
});

// ── Relay status check ────────────────────────────────────────

function checkRelayStatus() {
  // Ask background for relay status via a quick ping
  chrome.runtime.sendMessage({ type: 'RELAY_PING' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      relayEl.className = '';
      relayEl.textContent = 'Relay: unknown';
      return;
    }
    if (response.connected) {
      relayEl.className = 'ok';
      relayEl.textContent = 'Relay: connected ✓';
    } else {
      relayEl.className = 'err';
      relayEl.textContent = 'Relay: disconnected';
    }
  });
}

(function () {
  if (window.__streamerActive) return;
  window.__streamerActive = true;

  const HOST = location.hostname;
  const isChatGPT = HOST.includes('chatgpt.com');
  const isClaude  = HOST.includes('claude.ai');

  let observer         = null;
  let currentTarget    = null;
  let streamStartSent  = false;
  let debounceTimer    = null;
  let endTimer         = null;
  let pollTimer        = null;

  // ── Selectors ─────────────────────────────────────────────────

  function getStreamingContainer() {
    if (isChatGPT) {
      // GPT is actively streaming when the stop button is visible
      if (!document.querySelector('[data-testid="stop-button"]')) return null;
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (!msgs.length) return null;
      const last = msgs[msgs.length - 1];
      return last.querySelector('.markdown') || last;
    }

    if (isClaude) {
      const streaming = document.querySelector('[data-is-streaming="true"]');
      if (streaming) return streaming.querySelector('.standard-markdown') || streaming;
      // Also catch the stop-response button as a fallback signal
      if (document.querySelector('[aria-label="Stop Response"]')) {
        const all = document.querySelectorAll('[data-is-streaming]');
        if (all.length) {
          const last = all[all.length - 1];
          return last.querySelector('.standard-markdown') || last;
        }
      }
      return null;
    }

    return null;
  }

  function getLastContainer() {
    if (isChatGPT) {
      const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
      if (!msgs.length) return null;
      const last = msgs[msgs.length - 1];
      return last.querySelector('.markdown') || last;
    }
    if (isClaude) {
      const all = document.querySelectorAll('[data-is-streaming]');
      if (!all.length) return null;
      const last = all[all.length - 1];
      return last.querySelector('.standard-markdown') || last;
    }
    return null;
  }

  function isStreaming() {
    if (isChatGPT) return !!document.querySelector('[data-testid="stop-button"]');
    if (isClaude)  return !!document.querySelector('[data-is-streaming="true"]') ||
                          !!document.querySelector('[aria-label="Stop Response"]');
    return false;
  }

  // ── Messaging ──────────────────────────────────────────────────

  function sendToBackground(msg) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }

  function sendChunk(html) {
    if (!streamStartSent) {
      sendToBackground({ type: 'RELAY_STREAM_START' });
      streamStartSent = true;
    }
    sendToBackground({ type: 'RELAY_STREAM_CHUNK', html });
  }

  function sendEnd() {
    if (streamStartSent) sendToBackground({ type: 'RELAY_STREAM_END' });
    streamStartSent = false;
    currentTarget   = null;
  }

  // ── Observer ───────────────────────────────────────────────────

  function attachObserver(target) {
    if (observer) observer.disconnect();
    currentTarget = target;

    // Send the current content immediately on attach so we never miss the start
    sendChunk(currentTarget.innerHTML);

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      clearTimeout(endTimer);

      if (!currentTarget) return;
      sendChunk(currentTarget.innerHTML);

      debounceTimer = setTimeout(() => {
        if (!isStreaming()) {
          endTimer = setTimeout(sendEnd, 600);
        }
      }, 200);
    });

    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // ── Poll ───────────────────────────────────────────────────────
  // Runs at 300ms — fast enough to catch stream start within one tick

  function poll() {
    const streaming = getStreamingContainer();

    if (streaming && streaming !== currentTarget) {
      // New streaming container — attach immediately
      streamStartSent = false;
      attachObserver(streaming);
    } else if (!currentTarget && !streaming) {
      // Nothing streaming — reset so next response gets picked up fresh
      // (only reset if we already finished a response)
    }

    pollTimer = setTimeout(poll, 300);
  }

  // ── Init ───────────────────────────────────────────────────────

  function init() {
    chrome.storage.local.get(['streamingEnabled'], ({ streamingEnabled }) => {
      if (streamingEnabled === false) return;
      poll();
    });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if ('streamingEnabled' in changes) {
      if (changes.streamingEnabled.newValue === false) {
        clearTimeout(pollTimer);
        if (observer) { observer.disconnect(); observer = null; }
        currentTarget   = null;
        streamStartSent = false;
      } else {
        poll();
      }
    }
  });

  init();
})();
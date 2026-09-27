// ─────────────────────────────────────────────────────────────
// content.js — runs inside the Google Meet tab
// Waits for a "CAPTURE" message from background,
// reads the live caption text, sends it back
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'CAPTURE') return;

  const text = getCaptionText();

  if (!text) {
    sendResponse({ ok: false, error: 'No caption text found. Are captions turned on (CC button)?' });
    return;
  }

  sendResponse({ ok: true, text });
});


// ─────────────────────────────────────────────────────────────
// Find the live caption text in the Meet DOM
// ─────────────────────────────────────────────────────────────
function getCaptionText() {
  const UI_NOISE = new Set(['Font size', 'Font color', 'Open caption settings']);

  function extractFromContainer(container) {
    const lines = [...container.querySelectorAll('div')]
      .map(d => d.children.length === 0 ? d.innerText?.trim() : null)
      .filter(Boolean)
      .filter(l => !UI_NOISE.has(l));
    const deduped = lines.filter((l, i) => l !== lines[i - 1]);
    const text = deduped.join(' ').trim();
    if (text.length > 3) return text;
    const raw = container.innerText?.trim();
    return (raw && raw.length > 3) ? raw : null;
  }

  // Strategy 1 — stable semantic selector (aria-label="Captions")
  const captionsRegion = document.querySelector('div[role="region"][aria-label="Captions"]');
  if (captionsRegion) {
    const text = extractFromContainer(captionsRegion);
    if (text) return text;
  }

  // Strategy 2 — jsname-based selectors
  for (const sel of ['[jsname="tgaKEf"]', '[jsname="YSxPC"]', '[jsname="GCOgmd"]']) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 3) return text;
  }

  // Strategy 3 — class-based fallback
  const container = document.querySelector('div.a4cQT');
  if (container) {
    const text = extractFromContainer(container);
    if (text) return text;
  }

  return null;
}

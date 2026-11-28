export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Only touch the DOM when the text actually changed. */
export function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

/**
 * Fill a progress bar (the inner div of a .bar) to `fraction`. It's drawn with
 * a transform, not a width, and without a transition, so a bar that moves
 * every second costs no layout and doesn't keep the page animating between ticks.
 */
export function setBar(el: HTMLElement, fraction: number) {
  const f = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  const v = `scaleX(${f.toFixed(3)})`;
  if (el.style.transform !== v) el.style.transform = v;
}

export function setDisabled(el: HTMLButtonElement, v: boolean) {
  if (el.disabled !== v) el.disabled = v;
}

/** Two-tap confirm built into the button (no confirm() dialog, which some webviews block). */
export function confirmTap(btn: HTMLButtonElement, prompt: string): boolean {
  if (btn.dataset.armed === '1') {
    delete btn.dataset.armed;
    btn.textContent = btn.dataset.label ?? btn.textContent;
    return true;
  }
  btn.dataset.label ??= btn.textContent ?? '';
  btn.dataset.armed = '1';
  btn.textContent = prompt;
  setTimeout(() => {
    if (btn.dataset.armed === '1') {
      delete btn.dataset.armed;
      btn.textContent = btn.dataset.label ?? '';
    }
  }, 4000);
  return false;
}

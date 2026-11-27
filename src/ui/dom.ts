export const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

/** Only touch the DOM when the text actually changed. */
export function setText(el: HTMLElement, text: string) {
  if (el.textContent !== text) el.textContent = text;
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

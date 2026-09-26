/** Rendered without Vue when the env is invalid, so a misconfigured deploy never shows a blank page. */
export function renderConfigError(problems: readonly string[]): void {
  const root = document.getElementById('app');
  if (!root) return;
  const box = document.createElement('div');
  box.style.cssText =
    'font:14px/1.5 system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:24px';
  const title = document.createElement('h1');
  title.textContent = 'Genesis is not configured';
  title.style.cssText = 'font-size:18px;font-weight:600;margin:0 0 8px';
  const hint = document.createElement('p');
  hint.textContent =
    'Set these variables (see frontend/.env.example), then restart the dev server or rebuild:';
  const list = document.createElement('ul');
  for (const problem of problems) {
    const item = document.createElement('li');
    item.textContent = problem;
    list.append(item);
  }
  box.append(title, hint, list);
  root.replaceChildren(box);
}

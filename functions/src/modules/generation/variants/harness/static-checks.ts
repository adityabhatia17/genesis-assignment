import { parse } from 'css-tree';
import type { ProjectFile } from './inline-project.js';

export interface StaticReport {
  /** 0–8. Deterministic stand-in for the visual part the judge does not own. */
  visualDet: number;
  /** 0–10. */
  a11y: number;
  /** 0–4. The deterministic half of clarity. */
  clarityDet: number;
  /** 0–10. */
  robustness: number;
}

const JARGON = /\b(null|undefined|NaN|exception|stack trace|TypeError|function\s*\()/i;

function cssText(files: readonly ProjectFile[]): string {
  return files.filter((f) => f.path.endsWith('.css') || f.path.endsWith('.html')).map((f) => f.content).join('\n');
}

function stylesheetLooksStyled(css: string): number {
  let points = 0;
  if (/\b(padding|margin|gap)\s*:/.test(css)) points += 2;
  if (/\b(font-family|font-size)\s*:/.test(css)) points += 2;
  if (/@media\b/.test(css) || /overflow-x\s*:/.test(css)) points += 2;
  if (/\b(display\s*:\s*(flex|grid)|border-radius)\b/.test(css)) points += 2;
  try {
    parse(css, { parseAtrulePrelude: false, positions: false });
  } catch {
    return Math.min(points, 4);
  }
  return points;
}

export function staticChecks(files: readonly ProjectFile[], runsClean: boolean): StaticReport {
  const css = cssText(files);
  const html = files.find((f) => f.path === 'index.html')?.content ?? '';
  const visualDet = Math.min(8, stylesheetLooksStyled(css));
  const hasH1 = /<h1[\s>]/i.test(html);
  const buttonsLabeled = !/<button[^>]*>\s*<\/button>/i.test(html);
  const a11y = (hasH1 ? 4 : 0) + (buttonsLabeled ? 3 : 0) + (css.length > 0 ? 3 : 0);
  const words = html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
  const avg = words.length ? words.reduce((n, w) => n + w.length, 0) / words.length : 0;
  const clarityDet = (JARGON.test(html) ? 0 : 2) + (avg > 0 && avg < 12 ? 2 : 0);
  const robustness = (runsClean ? 4 : 0) + (files.some((f) => f.path.endsWith('.js')) ? 3 : 1) + 3;
  return {
    visualDet,
    a11y: Math.min(10, a11y),
    clarityDet: Math.min(4, clarityDet),
    robustness: Math.min(10, robustness),
  };
}

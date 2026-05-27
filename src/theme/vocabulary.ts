/**
 * Vocabulary template substitution.
 *
 * Templates use `{{key}}` placeholders. `substitute(template, vocab)`
 * replaces every key whose vocab entry exists; missing keys leave
 * the placeholder literally so the playwright leak-scan test fails
 * loudly (rather than silently rendering "" or the key name).
 *
 * Values are HTML-escaped on substitution. Narrative DOM rendering
 * already uses textContent, but values can leak into attribute or
 * style contexts in the future — escaping here is cheap insurance.
 */

export type Vocab = Readonly<Record<string, string>>;

const TOKEN_RE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

export function substitute(template: string, vocab: Vocab): string {
  return template.replace(TOKEN_RE, (match, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(vocab, key)) return match;
    const raw = vocab[key];
    return escapeHtml(raw === undefined ? '' : String(raw));
  });
}

export function findMissingTokens(template: string, vocab: Vocab): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  // Re-create a non-global regex iteration since we mutate lastIndex via exec.
  const re = new RegExp(TOKEN_RE.source, 'g');
  while ((m = re.exec(template))) {
    const key = m[1]!;
    if (!Object.prototype.hasOwnProperty.call(vocab, key)) out.add(key);
  }
  return Array.from(out);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

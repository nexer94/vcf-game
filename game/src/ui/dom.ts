/**
 * Tiny DOM builder (no framework). Text children are set via textContent,
 * so content is never parsed as HTML.
 */
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === 'class') node.className = String(v);
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** <button type="button"> with a click handler. */
export function button(label: string | Node, onClick: () => void, attrs: Attrs | null = null): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs }, label);
  b.addEventListener('click', onClick);
  return b;
}

/** External documentation link (new tab, no referrer). */
export function docLink(label: string, url: string): HTMLAnchorElement {
  return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'doc-link' }, label);
}

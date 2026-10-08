/**
 * Minimal markdown rendering for EOS packets/minutes (Brief 2D) — same
 * regex approach as the chat's Message.tsx, gray palette. Content here is
 * staff/agent-authored, not end-user input.
 */

export function toHtml(md: string): string {
  // Quotes too: link URLs land inside href="…", and the text here can be
  // model output steered by pasted content (Knowledge Capture notes).
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  html = html
    .replace(/^### (.+)$/gm, '<h4 class="mt-3 mb-1 text-sm font-semibold text-charcoal-900">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-3 mb-1 text-base font-semibold text-charcoal-900">$1</h3>')
    .replace(/\[([^\]]+)\]\((\/(?:[^)\s&]|&amp;)+|https?:\/\/(?:[^)\s&]|&amp;)+)\)/g, '<a class="text-blue-600 hover:underline" href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-charcoal-900">$1</strong>')
    .replace(/_(.+?)_/g, '<em class="text-charcoal-500 italic">$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc leading-snug">$1</li>')
    .replace(/\n\n/g, '</p><p class="mt-1.5">')
    .replace(/\n/g, '<br/>')
    .replace(/<\/li><br\/>(<li|<\/p>)/g, '</li>$1')
    .replace(/(<\/h[34]>)<br\/>/g, '$1');
  return `<p>${html}</p>`;
}

export default function MarkdownLite({ md, className }: { md: string; className?: string }) {
  return (
    <div
      className={className ?? 'text-sm text-charcoal-600'}
      dangerouslySetInnerHTML={{ __html: toHtml(md) }}
    />
  );
}

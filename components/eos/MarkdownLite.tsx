/**
 * Minimal markdown rendering for EOS packets/minutes (Brief 2D) — same
 * regex approach as the chat's Message.tsx, gray palette. Content here is
 * staff/agent-authored, not end-user input.
 */

function toHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html
    .replace(/^### (.+)$/gm, '<h4 class="mt-3 mb-1 text-sm font-semibold text-gray-900">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="mt-3 mb-1 text-base font-semibold text-gray-900">$1</h3>')
    .replace(/\[([^\]]+)\]\((\/[^)\s]+|https?:[^)\s]+)\)/g, '<a class="text-blue-600 hover:underline" href="$2">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    .replace(/_(.+?)_/g, '<em class="text-gray-500 italic">$1</em>')
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
      className={className ?? 'text-sm text-gray-600'}
      dangerouslySetInnerHTML={{ __html: toHtml(md) }}
    />
  );
}

/**
 * Minimal XSS-safe Markdown renderer (AFC-670, minutes body).
 *
 * The minutes body is stored as Markdown text and rendered styled on the
 * detail page. There is no Markdown dependency in the workspace, and adding
 * one for a single field would widen the supply chain for no reason — so
 * this renderer covers exactly the toolbar set on `/minutes/new`
 * (headings, bold, italic, underline, strike, lists, quote, code, table,
 * link) and nothing else.
 *
 * Safety rule: the source is HTML-escaped FIRST, before any Markdown
 * construct is recognised. Every tag in the output is emitted by this
 * module, never copied from the input, so raw HTML in the source (including
 * `<script>`, event attributes, and `javascript:` links) can only ever
 * render as visible text.
 *
 * Dependency-free and erasable-types-only, so the web contract suite can
 * exercise it without a build step.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Segment {
  text: string
  code: boolean
  block: boolean
}

/** Split the source into plain-text and code segments (fenced + inline). */
function splitCode(source: string): Segment[] {
  const segments: Segment[] = []
  const fence = /```[^\n]*\n([\s\S]*?)(?:```|$)/g
  let last = 0
  let match: RegExpExecArray | null
  const pushInline = (text: string): void => {
    const inline = /(`+)([^`]+?)\1/g
    let at = 0
    let inner: RegExpExecArray | null
    while ((inner = inline.exec(text)) !== null) {
      if (inner.index > at)
        segments.push({ text: text.slice(at, inner.index), code: false, block: false })
      segments.push({ text: inner[2] ?? '', code: true, block: false })
      at = inner.index + inner[0].length
    }
    if (at < text.length)
      segments.push({ text: text.slice(at), code: false, block: false })
  }
  while ((match = fence.exec(source)) !== null) {
    if (match.index > last) pushInline(source.slice(last, match.index))
    segments.push({ text: (match[1] ?? '').replace(/\n$/, ''), code: true, block: true })
    last = match.index + match[0].length
  }
  if (last < source.length) pushInline(source.slice(last))
  return segments
}

const LINK_SCHEME = /^(https?:\/\/|mailto:)/i

/**
 * Single left-to-right pass over the escaped source. One pass matters: the
 * tags this module emits contain `_` and `*` (e.g. target="_blank"), so a
 * second emphasis pass would read inside already-emitted markup. Here the
 * scanner only ever sees the original escaped text, and replacements are
 * never rescanned.
 */
const INLINE_PATTERN =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*<>\n]+)\*\*|\+\+([^+<>\n]+)\+\+|~~([^~<>\n]+)~~|(^|[^*\w])\*([^*\n<>]+)\*|(^|[^\w])_([^_\n<>]+)_/g

function renderInline(escaped: string): string {
  return escaped.replace(
    INLINE_PATTERN,
    (
      whole: string,
      label?: string,
      href?: string,
      bold?: string,
      underline?: string,
      strike?: string,
      starPrefix?: string,
      star?: string,
      underPrefix?: string,
      under?: string,
    ) => {
      if (label !== undefined && href !== undefined) {
        return LINK_SCHEME.test(href)
          ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : `${label} (${href})`
      }
      if (bold !== undefined) return `<strong>${bold}</strong>`
      if (underline !== undefined) return `<u>${underline}</u>`
      if (strike !== undefined) return `<del>${strike}</del>`
      if (star !== undefined) return `${starPrefix ?? ''}<em>${star}</em>`
      if (under !== undefined) return `${underPrefix ?? ''}<em>${under}</em>`
      return whole
    },
  )
}

function isTableSeparator(line: string): boolean {
  const cells = line
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0)
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))
}

function renderTable(lines: string[]): string {
  const rows = lines.map((line) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim()),
  )
  const head = (rows[0] ?? []).map((cell) => `<th>${renderInline(cell)}</th>`).join('')
  const body = rows
    .slice(2)
    .map(
      (row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}

/** Render one plain-text segment (already HTML-escaped) to block HTML. */
function renderBlocks(escaped: string): string {
  const lines = escaped.split('\n')
  // noUncheckedIndexedAccess: every line read goes through here.
  const at = (idx: number): string => lines[idx] ?? ''
  const html: string[] = []
  let i = 0
  const flushParagraph = (group: string[]): void => {
    if (group.length > 0) html.push(`<p>${group.map(renderInline).join('<br>')}</p>`)
  }
  let paragraph: string[] = []
  while (i < lines.length) {
    const line = at(i)
    const trimmed = line.trim()
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushParagraph(paragraph)
      paragraph = []
      const level = (heading[1] ?? '#').length
      html.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`)
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph(paragraph)
      paragraph = []
      html.push('<hr>')
      i += 1
      continue
    }
    if (trimmed.startsWith('&gt;')) {
      flushParagraph(paragraph)
      paragraph = []
      const quoted: string[] = []
      while (i < lines.length && at(i).trim().startsWith('&gt;')) {
        quoted.push(
          at(i)
            .trim()
            .replace(/^&gt;\s?/, ''),
        )
        i += 1
      }
      html.push(`<blockquote>${quoted.map(renderInline).join('<br>')}</blockquote>`)
      continue
    }
    if (/^(-|\*)\s+/.test(trimmed)) {
      flushParagraph(paragraph)
      paragraph = []
      const items: string[] = []
      while (i < lines.length && /^(-|\*)\s+/.test(at(i).trim())) {
        items.push(
          at(i)
            .trim()
            .replace(/^(-|\*)\s+/, ''),
        )
        i += 1
      }
      html.push(
        `<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`,
      )
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(paragraph)
      paragraph = []
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(at(i).trim())) {
        items.push(
          at(i)
            .trim()
            .replace(/^\d+\.\s+/, ''),
        )
        i += 1
      }
      html.push(
        `<ol>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`,
      )
      continue
    }
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(at(i + 1))) {
      flushParagraph(paragraph)
      paragraph = []
      const tableLines: string[] = [line, at(i + 1)]
      i += 2
      while (i < lines.length && at(i).includes('|') && at(i).trim().length > 0) {
        tableLines.push(at(i))
        i += 1
      }
      html.push(renderTable(tableLines))
      continue
    }
    if (trimmed.length === 0) {
      flushParagraph(paragraph)
      paragraph = []
      i += 1
      continue
    }
    paragraph.push(line.trim())
    i += 1
  }
  flushParagraph(paragraph)
  return html.join('')
}

/**
 * Render Markdown to HTML. Output tags are exactly: h1–h3, p, br, ul, ol,
 * li, blockquote, strong, em, u, del, a (http/https/mailto only), code,
 * pre, table, thead, tbody, tr, th, td, hr. Everything else — including any
 * HTML the author typed — is escaped text.
 */
export function renderMarkdownSafe(source: string): string {
  const segments = splitCode(source)
  return segments
    .map((segment) => {
      if (segment.code) {
        const safe = escapeHtml(segment.text)
        return segment.block ? `<pre><code>${safe}</code></pre>` : `<code>${safe}</code>`
      }
      return renderBlocks(escapeHtml(segment.text))
    })
    .join('')
}

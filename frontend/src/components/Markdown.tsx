import { memo, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { COLORS, FONTS } from '../theme'

/**
 * Dark-theme markdown renderer used for assistant (and thinking) message
 * bodies. Supports GitHub-flavored markdown (tables, strikethrough, task
 * lists, autolinks) and syntax-highlighted fenced code via highlight.js.
 *
 * Kept memoized so a long assistant message doesn't re-parse the full
 * markdown tree on every streamed token — react-markdown itself is
 * reasonably fast but over a multi-KB response the parser overhead adds
 * up. ``memo`` ensures we only re-render when the text or className
 * actually changes.
 */
function MarkdownImpl({
  children,
  className,
  style,
}: {
  children: string
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={className} style={{ ...wrapperStyle, ...style }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownImpl)

const wrapperStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.6,
  color: COLORS.text,
  wordBreak: 'break-word',
}

// react-markdown will pass the raw <tag> + attributes through; we only
// need to override the tags whose defaults don't fit the dark theme.

const paragraphStyle: CSSProperties = {
  margin: '0 0 12px',
}

const headingStyles: Record<string, CSSProperties> = {
  h1: { fontSize: 22, fontWeight: 700, margin: '20px 0 10px', letterSpacing: -0.01 },
  h2: { fontSize: 18, fontWeight: 700, margin: '18px 0 8px', letterSpacing: -0.01 },
  h3: { fontSize: 16, fontWeight: 600, margin: '16px 0 6px' },
  h4: { fontSize: 14, fontWeight: 600, margin: '14px 0 6px' },
  h5: { fontSize: 13, fontWeight: 600, margin: '12px 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 },
  h6: { fontSize: 12, fontWeight: 600, margin: '12px 0 4px', color: COLORS.textMuted },
}

const listStyle: CSSProperties = {
  margin: '0 0 12px',
  paddingLeft: 24,
}

const listItemStyle: CSSProperties = {
  margin: '2px 0',
}

const inlineCodeStyle: CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: '0.88em',
  background: COLORS.codeBg,
  color: COLORS.codeText,
  padding: '1px 6px',
  borderRadius: 4,
  border: `1px solid ${COLORS.borderSubtle}`,
}

const preStyle: CSSProperties = {
  fontFamily: FONTS.mono,
  fontSize: 13,
  background: COLORS.codeBg,
  color: COLORS.codeText,
  padding: '12px 14px',
  borderRadius: 8,
  border: `1px solid ${COLORS.border}`,
  overflow: 'auto',
  margin: '10px 0 14px',
  lineHeight: 1.5,
}

const blockquoteStyle: CSSProperties = {
  margin: '10px 0',
  padding: '4px 12px',
  borderLeft: `3px solid ${COLORS.borderStrong}`,
  color: COLORS.textMuted,
  fontStyle: 'italic',
}

const tableWrapperStyle: CSSProperties = {
  overflowX: 'auto',
  margin: '10px 0 14px',
}

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: 13,
}

const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  background: COLORS.bgCard,
  borderBottom: `1px solid ${COLORS.borderStrong}`,
  fontWeight: 600,
}

const tdStyle: CSSProperties = {
  padding: '6px 10px',
  borderBottom: `1px solid ${COLORS.border}`,
}

const hrStyle: CSSProperties = {
  border: 0,
  borderTop: `1px solid ${COLORS.border}`,
  margin: '18px 0',
}

const linkStyle: CSSProperties = {
  color: COLORS.blue,
  textDecoration: 'none',
  borderBottom: `1px dotted ${COLORS.blueDim}`,
}

// react-markdown hands component overrides a superset of the native
// element's props plus an AST ``node`` we don't want to forward to the
// DOM. This is a minimal shape that covers everything we touch — the
// ``Components`` cast below enforces per-element compatibility.
type NodeProps = {
  node?: unknown
  children?: ReactNode
  className?: string
  href?: string
  [key: string]: unknown
}

const components: Components = {
  p: (props) => {
    const { children, ...rest } = props as NodeProps
    return (
      <p style={paragraphStyle} {...passthrough(rest)}>
        {children}
      </p>
    )
  },
  h1: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h1 style={headingStyles.h1} {...passthrough(rest)}>{children}</h1>
  },
  h2: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h2 style={headingStyles.h2} {...passthrough(rest)}>{children}</h2>
  },
  h3: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h3 style={headingStyles.h3} {...passthrough(rest)}>{children}</h3>
  },
  h4: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h4 style={headingStyles.h4} {...passthrough(rest)}>{children}</h4>
  },
  h5: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h5 style={headingStyles.h5} {...passthrough(rest)}>{children}</h5>
  },
  h6: (props) => {
    const { children, ...rest } = props as NodeProps
    return <h6 style={headingStyles.h6} {...passthrough(rest)}>{children}</h6>
  },
  ul: (props) => {
    const { children, ...rest } = props as NodeProps
    return <ul style={listStyle} {...passthrough(rest)}>{children}</ul>
  },
  ol: (props) => {
    const { children, ...rest } = props as NodeProps
    return <ol style={listStyle} {...passthrough(rest)}>{children}</ol>
  },
  li: (props) => {
    const { children, ...rest } = props as NodeProps
    return <li style={listItemStyle} {...passthrough(rest)}>{children}</li>
  },
  blockquote: (props) => {
    const { children, ...rest } = props as NodeProps
    return (
      <blockquote style={blockquoteStyle} {...passthrough(rest)}>
        {children}
      </blockquote>
    )
  },
  hr: () => <hr style={hrStyle} />,
  a: (props) => {
    const { children, href, ...rest } = props as NodeProps
    return (
      <a
        style={linkStyle}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...passthrough(rest)}
      >
        {children}
      </a>
    )
  },
  table: (props) => {
    const { children, ...rest } = props as NodeProps
    return (
      <div style={tableWrapperStyle}>
        <table style={tableStyle} {...passthrough(rest)}>{children}</table>
      </div>
    )
  },
  th: (props) => {
    const { children, ...rest } = props as NodeProps
    return <th style={thStyle} {...passthrough(rest)}>{children}</th>
  },
  td: (props) => {
    const { children, ...rest } = props as NodeProps
    return <td style={tdStyle} {...passthrough(rest)}>{children}</td>
  },
  // Fenced code blocks arrive as <pre><code class="language-xyz">...</code></pre>.
  // rehype-highlight decorates the <code> children with highlight.js classes;
  // we apply the dark block style on the <pre> and hand the hljs classes
  // through on the nested <code>. Inline code (no wrapping <pre>) is styled
  // below in the ``code`` override.
  pre: (props) => {
    const { children, ...rest } = props as NodeProps
    return <pre style={preStyle} {...passthrough(rest)}>{children}</pre>
  },
  code: (props) => {
    const { children, className, ...rest } = props as NodeProps
    const isFenced = typeof className === 'string' && /\bhljs\b/.test(className)
    if (isFenced) {
      return (
        <code className={className} {...passthrough(rest)}>
          {children}
        </code>
      )
    }
    return (
      <code
        style={inlineCodeStyle}
        className={className}
        {...passthrough(rest)}
      >
        {children}
      </code>
    )
  },
}

// react-markdown hands us the ``node`` prop on every component override; it's
// an AST representation we don't want to forward to DOM elements.
function passthrough(props: NodeProps): Record<string, unknown> {
  const { node: _node, ...rest } = props
  return rest
}

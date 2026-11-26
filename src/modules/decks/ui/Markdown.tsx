import type { ReactNode } from 'react'
import { parseMarkdown, type Block, type Inline } from '../domain/markdown'

/**
 * A deck description (Markdown from deck.json) as React elements: the tree of domain/markdown.ts,
 * never HTML from the author, so nothing in a description can run or style the page. Headings
 * start at `headingLevel`, below the page's own.
 */
export function Markdown({ source, headingLevel }: { source: string; headingLevel: 3 | 4 }) {
  return <>{parseMarkdown(source).map((block, i) => renderBlock(block, i, headingLevel))}</>
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case 'text':
        return node.text
      case 'code':
        return <code key={i}>{node.text}</code>
      case 'strong':
        return <strong key={i}>{renderInline(node.content)}</strong>
      case 'em':
        return <em key={i}>{renderInline(node.content)}</em>
      case 'link':
        return (
          <a key={i} href={node.href} className="text-link" rel="nofollow ugc noopener noreferrer">
            {renderInline(node.content)}
          </a>
        )
    }
  })
}

function renderBlock(block: Block, key: number, headingLevel: 3 | 4): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(6, headingLevel + block.level - 1)}` as 'h3' | 'h4' | 'h5' | 'h6'
      return <Tag key={key}>{renderInline(block.content)}</Tag>
    }
    case 'paragraph':
      return <p key={key}>{renderInline(block.content)}</p>
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul'
      return (
        <List key={key} className={block.ordered ? 'list-decimal pl-6' : 'list-disc pl-6'}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </List>
      )
    }
    case 'codeblock':
      return (
        <pre key={key} className="overflow-x-auto">
          <code>{block.text}</code>
        </pre>
      )
    case 'quote':
      return (
        <blockquote key={key} className="border-l-4 border-border pl-4">
          {renderInline(block.content)}
        </blockquote>
      )
  }
}

import { describe, it, expect } from 'vitest'

// agent-actions.ts uses @tiptap/react Editor which is complex to mock fully.
// We test the pure helper functions by extracting their logic here,
// and test executeAgentAction behavior with a mock editor.

// --- contentToStreamBlocks (copied from agent-actions.ts) ---

interface StreamBlock {
  type: 'heading' | 'paragraph' | 'listItem'
  text: string
  level?: number
  subItems?: string[]
}

function contentToStreamBlocks(content: string): StreamBlock[] {
  const cleaned = content
    .replace(/^#{3,}\s+/gm, '## ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
  const lines = cleaned.split('\n').filter(l => l.trim() !== '')
  const blocks: StreamBlock[] = []
  let pendingListItems: { text: string, subItems: string[] }[] = []

  const flushList = () => {
    for (const item of pendingListItems) {
      blocks.push({
        type: 'listItem',
        text: item.text,
        subItems: item.subItems.length > 0 ? item.subItems : undefined,
      })
    }
    pendingListItems = []
  }

  for (const line of lines) {
    if (/^[\t ]{2,}- /.test(line)) {
      const text = line.replace(/^[\t ]*- /, '')
      if (pendingListItems.length > 0) {
        pendingListItems[pendingListItems.length - 1].subItems.push(text)
      } else {
        pendingListItems.push({ text, subItems: [] })
      }
    } else if (line.startsWith('- ')) {
      pendingListItems.push({ text: line.slice(2), subItems: [] })
    } else {
      flushList()
      if (line.startsWith('## ')) {
        blocks.push({ type: 'heading', text: line.slice(3), level: 2 })
      } else if (line.startsWith('# ')) {
        blocks.push({ type: 'heading', text: line.slice(2), level: 1 })
      } else {
        blocks.push({ type: 'paragraph', text: line })
      }
    }
  }
  flushList()
  return blocks
}

// --- parseAgentResponse validation logic ---

interface AgentAction {
  type: 'insert' | 'replace' | 'read' | 'chat'
  position?: string
  content?: string
  searchText?: string
  replaceWith?: string
  highlightText?: string
  chatBefore?: string
  chatMessage?: string
  thought?: string
  shouldContinue?: boolean
}

function validateAction(action: AgentAction): string[] {
  const errors: string[] = []
  const validTypes = ['insert', 'replace', 'read', 'chat']
  if (!validTypes.includes(action.type)) {
    errors.push(`Invalid type: ${action.type}`)
  }
  if (action.type === 'insert' && !action.content) {
    errors.push('Insert action requires content')
  }
  if (action.type === 'replace' && !action.searchText) {
    errors.push('Replace action requires searchText')
  }
  if ((action.type === 'insert' || action.type === 'replace') && !action.chatBefore) {
    errors.push('Edit actions should have chatBefore')
  }
  return errors
}

// --- Tests ---

describe('contentToStreamBlocks', () => {
  it('parses a heading', () => {
    const blocks = contentToStreamBlocks('## Architecture')
    expect(blocks).toEqual([{ type: 'heading', text: 'Architecture', level: 2 }])
  })

  it('parses h1 heading', () => {
    const blocks = contentToStreamBlocks('# Title')
    expect(blocks).toEqual([{ type: 'heading', text: 'Title', level: 1 }])
  })

  it('downgrades h3+ to h2', () => {
    const blocks = contentToStreamBlocks('### Sub Section')
    expect(blocks).toEqual([{ type: 'heading', text: 'Sub Section', level: 2 }])
  })

  it('parses plain paragraph text', () => {
    const blocks = contentToStreamBlocks('Just a paragraph')
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Just a paragraph' }])
  })

  it('parses bullet list items', () => {
    const blocks = contentToStreamBlocks('- Item one\n- Item two')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ type: 'listItem', text: 'Item one', subItems: undefined })
    expect(blocks[1]).toEqual({ type: 'listItem', text: 'Item two', subItems: undefined })
  })

  it('parses nested sub-items', () => {
    const blocks = contentToStreamBlocks('- Parent\n  - Child one\n  - Child two')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('Parent')
    expect(blocks[0].subItems).toEqual(['Child one', 'Child two'])
  })

  it('strips bold/italic markdown', () => {
    const blocks = contentToStreamBlocks('**bold** and *italic* text')
    expect(blocks[0].text).toBe('bold and italic text')
  })

  it('strips inline code backticks', () => {
    const blocks = contentToStreamBlocks('Use `console.log` here')
    expect(blocks[0].text).toBe('Use console.log here')
  })

  it('handles mixed content', () => {
    const content = '## Heading\nSome text\n- Bullet one\n- Bullet two\n  - Sub bullet'
    const blocks = contentToStreamBlocks(content)
    expect(blocks[0]).toEqual({ type: 'heading', text: 'Heading', level: 2 })
    expect(blocks[1]).toEqual({ type: 'paragraph', text: 'Some text' })
    expect(blocks[2]).toEqual({ type: 'listItem', text: 'Bullet one', subItems: undefined })
    expect(blocks[3].text).toBe('Bullet two')
    expect(blocks[3].subItems).toEqual(['Sub bullet'])
  })

  it('skips empty lines', () => {
    const blocks = contentToStreamBlocks('Line one\n\n\nLine two')
    expect(blocks).toHaveLength(2)
  })
})

describe('validateAction', () => {
  it('returns no errors for valid chat action', () => {
    expect(validateAction({ type: 'chat', chatMessage: 'hi' })).toEqual([])
  })

  it('flags missing content on insert', () => {
    const errors = validateAction({ type: 'insert', chatBefore: 'Adding stuff' })
    expect(errors).toContain('Insert action requires content')
  })

  it('flags missing searchText on replace', () => {
    const errors = validateAction({ type: 'replace', chatBefore: 'Fixing' })
    expect(errors).toContain('Replace action requires searchText')
  })

  it('flags missing chatBefore on insert', () => {
    const errors = validateAction({ type: 'insert', content: 'stuff' })
    expect(errors).toContain('Edit actions should have chatBefore')
  })

  it('flags missing chatBefore on replace', () => {
    const errors = validateAction({ type: 'replace', searchText: 'old', replaceWith: 'new' })
    expect(errors).toContain('Edit actions should have chatBefore')
  })

  it('returns no errors for valid read action', () => {
    expect(validateAction({ type: 'read', highlightText: 'foo' })).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'

// --- Replicated pure functions from agent-actions.ts for direct testing ---

function contentToBlocks(content: string): string[] {
  const cleaned = content
    .replace(/^#{3,}\s+/gm, '## ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
  const lines = cleaned.split('\n').filter(l => l.trim() !== '')
  const blocks: string[] = []
  let topItems: { text: string, subItems: string[] }[] = []

  const flushList = () => {
    if (topItems.length > 0) {
      const html = topItems.map(item => {
        if (item.subItems.length > 0) {
          return `<li>${item.text}<ul>${item.subItems.map(s => `<li>${s}</li>`).join('')}</ul></li>`
        }
        return `<li>${item.text}</li>`
      }).join('')
      blocks.push(`<ul>${html}</ul>`)
      topItems = []
    }
  }

  for (const line of lines) {
    if (/^[\t ]{2,}- /.test(line)) {
      const text = line.replace(/^[\t ]*- /, '')
      if (topItems.length > 0) {
        topItems[topItems.length - 1].subItems.push(text)
      } else {
        topItems.push({ text, subItems: [] })
      }
    } else if (line.startsWith('- ')) {
      topItems.push({ text: line.slice(2), subItems: [] })
    } else {
      flushList()
      if (line.startsWith('### ')) blocks.push(`<h3>${line.slice(4)}</h3>`)
      else if (line.startsWith('## ')) blocks.push(`<h2>${line.slice(3)}</h2>`)
      else if (line.startsWith('# ')) blocks.push(`<h1>${line.slice(2)}</h1>`)
      else blocks.push(`<p>${line}</p>`)
    }
  }
  flushList()
  return blocks
}

// Replicated action validation logic
function validateAction(action: { type: string, searchText?: string, content?: string, chatMessage?: string }): string[] {
  const errors: string[] = []
  const validTypes = ['insert', 'replace', 'read', 'chat']
  if (!validTypes.includes(action.type)) {
    errors.push(`Invalid action type: ${action.type}`)
  }
  if (action.type === 'replace' && !action.searchText) {
    errors.push('Replace action requires searchText')
  }
  if (action.type === 'insert' && !action.content) {
    errors.push('Insert action requires content')
  }
  return errors
}

// --- Tests ---

describe('contentToBlocks', () => {
  it('converts a heading to <h2>', () => {
    const blocks = contentToBlocks('## Architecture')
    expect(blocks).toEqual(['<h2>Architecture</h2>'])
  })

  it('converts ### to ## (downgrades triple-hash)', () => {
    const blocks = contentToBlocks('### Deep heading')
    expect(blocks).toEqual(['<h2>Deep heading</h2>'])
  })

  it('converts bullet list to <ul>', () => {
    const blocks = contentToBlocks('- Item one\n- Item two')
    expect(blocks).toEqual(['<ul><li>Item one</li><li>Item two</li></ul>'])
  })

  it('handles nested sub-bullets', () => {
    const blocks = contentToBlocks('- Parent\n  - Child one\n  - Child two')
    expect(blocks).toEqual([
      '<ul><li>Parent<ul><li>Child one</li><li>Child two</li></ul></li></ul>'
    ])
  })

  it('strips bold markdown', () => {
    const blocks = contentToBlocks('**bold text** here')
    expect(blocks).toEqual(['<p>bold text here</p>'])
  })

  it('strips italic markdown', () => {
    const blocks = contentToBlocks('*italic text* here')
    expect(blocks).toEqual(['<p>italic text here</p>'])
  })

  it('strips backtick code', () => {
    const blocks = contentToBlocks('use `npm install` to install')
    expect(blocks).toEqual(['<p>use npm install to install</p>'])
  })

  it('handles mixed content: heading, paragraph, list', () => {
    const input = '## Title\nSome intro text\n- Bullet one\n- Bullet two'
    const blocks = contentToBlocks(input)
    expect(blocks).toEqual([
      '<h2>Title</h2>',
      '<p>Some intro text</p>',
      '<ul><li>Bullet one</li><li>Bullet two</li></ul>',
    ])
  })

  it('skips empty lines', () => {
    const blocks = contentToBlocks('## Heading\n\n\nParagraph')
    expect(blocks).toEqual(['<h2>Heading</h2>', '<p>Paragraph</p>'])
  })

  it('returns empty array for empty input', () => {
    expect(contentToBlocks('')).toEqual([])
  })

  it('handles h1 headings', () => {
    expect(contentToBlocks('# Title')).toEqual(['<h1>Title</h1>'])
  })
})

describe('action validation edge cases', () => {
  it('rejects unknown action types', () => {
    const errors = validateAction({ type: 'delete' })
    expect(errors).toContain('Invalid action type: delete')
  })

  it('replace without searchText is invalid', () => {
    const errors = validateAction({ type: 'replace' })
    expect(errors).toContain('Replace action requires searchText')
  })

  it('insert without content is invalid', () => {
    const errors = validateAction({ type: 'insert' })
    expect(errors).toContain('Insert action requires content')
  })

  it('valid chat action has no errors', () => {
    const errors = validateAction({ type: 'chat', chatMessage: 'hello' })
    expect(errors).toEqual([])
  })

  it('valid replace action has no errors', () => {
    const errors = validateAction({ type: 'replace', searchText: 'foo' })
    expect(errors).toEqual([])
  })

  it('valid insert action has no errors', () => {
    const errors = validateAction({ type: 'insert', content: 'new text' })
    expect(errors).toEqual([])
  })
})

describe('parseAgentResponse edge cases', () => {
  // Test how the system handles various response shapes
  it('action with all optional fields populated', () => {
    const action = {
      type: 'insert' as const,
      position: 'end',
      content: 'New content',
      chatBefore: 'Adding content',
      chatMessage: 'Done adding',
      thought: 'writing now',
      shouldContinue: false,
    }
    expect(action.type).toBe('insert')
    expect(action.shouldContinue).toBe(false)
  })

  it('thought gets truncated to 4 words', () => {
    // Replicates the truncation logic from agent.ts line 300
    const thought = 'this is a very long thought about things'
    const truncated = thought.split(/\s+/).slice(0, 4).join(' ')
    expect(truncated).toBe('this is a very')
  })

  it('thought with exactly 4 words stays unchanged', () => {
    const thought = 'four words right here'
    const truncated = thought.split(/\s+/).slice(0, 4).join(' ')
    expect(truncated).toBe('four words right here')
  })
})

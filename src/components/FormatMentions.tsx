import { memo } from 'react'

// Cache compiled regexes per name-set to avoid re-creating on every render
const mentionPatternCache = new Map<string, RegExp>()
function getMentionPattern(names: string[]): RegExp {
  const key = names.join(',')
  let pattern = mentionPatternCache.get(key)
  if (!pattern) {
    pattern = new RegExp(`(@?(?:${names.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi')
    mentionPatternCache.set(key, pattern)
  }
  return pattern
}

export const FormatMentions = memo(({ text, names }: { text: string, names?: string[] }) => {
  const allNames = names && names.length > 0 ? [...names, 'Sarah'] : ['Aiden', 'Nova', 'Lex', 'Mira', 'Sarah']
  const pattern = getMentionPattern(allNames)
  pattern.lastIndex = 0
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) => {
        const bare = part.replace(/^@/, '')
        const normalized = bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase()
        pattern.lastIndex = 0
        if (pattern.test(part)) {
          pattern.lastIndex = 0
          return (
            <span key={i} className="mention-tag">
              @{normalized}
            </span>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
})

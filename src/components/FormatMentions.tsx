import { memo } from 'react'

export const FormatMentions = memo(({ text, names }: { text: string, names?: string[] }) => {
  const allNames = names && names.length > 0 ? [...names, 'Sarah'] : ['Aiden', 'Nova', 'Lex', 'Mira', 'Sarah']
  const pattern = new RegExp(`(@?(?:${allNames.join('|')}))(?=\\s|$|[.,!?;:])`, 'gi')
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

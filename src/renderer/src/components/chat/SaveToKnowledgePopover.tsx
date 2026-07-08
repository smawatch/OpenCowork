import { BookOpen } from 'lucide-react'
import { useChatActions } from '@renderer/hooks/use-chat-actions'

interface Props {
  sessionId?: string | null
}

export function SaveToKnowledgePopover({ sessionId }: Props): React.JSX.Element {
  const { sendMessage } = useChatActions()

  const handleClick = () => {
    if (!sessionId) return
    const text = '保存我刚才的对话加入到知识库'
    sendMessage(text, undefined, undefined, sessionId)
  }

  return (
    <button
      type="button"
      className="flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
      title="保存到知识库"
      onClick={handleClick}
    >
      <BookOpen className="size-3.5" />
      <span>保存到知识库</span>
    </button>
  )
}

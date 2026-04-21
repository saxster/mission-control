import { describe, expect, it } from 'vitest'
import { buildChatConversationIndex } from '@/store/chat-derived'

describe('buildChatConversationIndex', () => {
  it('indexes messages by conversation and groups them by display date', () => {
    const baseTs = Math.floor(new Date('2026-04-10T09:00:00Z').getTime() / 1000)
    const index = buildChatConversationIndex([
      {
        id: 1,
        conversation_id: 'alpha',
        from_agent: 'human',
        to_agent: 'agent',
        content: 'hello',
        message_type: 'text',
        created_at: baseTs,
      },
      {
        id: 2,
        conversation_id: 'alpha',
        from_agent: 'agent',
        to_agent: 'human',
        content: 'hi',
        message_type: 'text',
        created_at: baseTs + 60,
      },
      {
        id: 3,
        conversation_id: 'beta',
        from_agent: 'human',
        to_agent: 'agent',
        content: 'other',
        message_type: 'text',
        created_at: baseTs + 86_400,
      },
    ])

    expect(index.messagesByConversation.alpha).toHaveLength(2)
    expect(index.messagesByConversation.beta).toHaveLength(1)
    expect(index.groupsByConversation.alpha).toHaveLength(1)
    expect(index.groupsByConversation.alpha[0].messages.map((message) => message.id)).toEqual([1, 2])
  })
})

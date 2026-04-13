'use client'

import type { ChatMessage } from './index'

export interface ChatMessageGroup {
  date: string
  messages: ChatMessage[]
}

export function formatDateGroup(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export function groupMessagesByDate(messages: ChatMessage[]): ChatMessageGroup[] {
  const groups: ChatMessageGroup[] = []
  let currentDate = ''

  for (const msg of messages) {
    const dateStr = formatDateGroup(msg.created_at)
    if (dateStr !== currentDate) {
      currentDate = dateStr
      groups.push({ date: dateStr, messages: [] })
    }
    groups[groups.length - 1].messages.push(msg)
  }

  return groups
}

export interface ChatConversationIndex {
  messagesByConversation: Record<string, ChatMessage[]>
  groupsByConversation: Record<string, ChatMessageGroup[]>
}

export function buildChatConversationIndex(messages: ChatMessage[]): ChatConversationIndex {
  const messagesByConversation: Record<string, ChatMessage[]> = {}

  for (const message of messages) {
    const existing = messagesByConversation[message.conversation_id]
    if (existing) {
      existing.push(message)
    } else {
      messagesByConversation[message.conversation_id] = [message]
    }
  }

  const groupsByConversation: Record<string, ChatMessageGroup[]> = {}
  for (const [conversationId, conversationMessages] of Object.entries(messagesByConversation)) {
    groupsByConversation[conversationId] = groupMessagesByDate(conversationMessages)
  }

  return { messagesByConversation, groupsByConversation }
}

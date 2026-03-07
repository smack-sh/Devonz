import { map } from 'nanostores';

export const chatStore = map({
  started: false,
  aborted: false,
  showChat: true,
  pendingMessage: null as string | null,
});

// Helper to set a pending message that will be picked up by the chat input
export function setPendingChatMessage(message: string) {
  chatStore.setKey('pendingMessage', message);
}

// Helper to clear the pending message after it's been consumed
export function clearPendingChatMessage() {
  chatStore.setKey('pendingMessage', null);
}

export const MOBILE_CHAT_LOAD_TIMEOUT_MS = 12_000;

export const MOBILE_CHAT_EMPTY_TEXT =
  "No messages yet — send one to start the live feed.";

export const MOBILE_CHAT_LOAD_TIMEOUT_TEXT = "Couldn't load this chat.";

export function shouldShowChatLoadingSpinner(options: {
  messagesLoading: boolean;
  messageCount: number;
  chatLoadFailed: boolean;
}): boolean {
  return (
    options.messagesLoading &&
    options.messageCount === 0 &&
    !options.chatLoadFailed
  );
}

export function shouldShowChatEmptyState(options: {
  messagesLoading: boolean;
  chatLoadFailed: boolean;
  messageCount: number;
}): boolean {
  return (
    !options.messagesLoading &&
    !options.chatLoadFailed &&
    options.messageCount === 0
  );
}

export function shouldShowChatLoadFailure(options: {
  chatLoadFailed: boolean;
  messageCount: number;
}): boolean {
  return options.chatLoadFailed && options.messageCount === 0;
}

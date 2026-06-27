let forceReplaceNextChat = false;

export function setForceReplaceNextChat(value: boolean): void {
  forceReplaceNextChat = value;
}

export function consumeForceReplaceNextChat(): boolean {
  const value = forceReplaceNextChat;
  forceReplaceNextChat = false;
  return value;
}

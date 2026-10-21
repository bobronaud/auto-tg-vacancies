// All Telegram Web K DOM knowledge lives here. When the web client changes, fix this file first.
export const SEL = {
  // Logged-in app shell
  chatList: "#column-left .chatlist-chat",
  // Auth pages (CSS-module class names are hashed, so match by prefix / text)
  qrCanvas: "canvas[class*='qrCanvas']",
  // Secondary button on the QR login page; appears before the QR canvas is rendered
  loginScreenButton: /log in by phone number/i,
  // Chat
  bubblesScrollable: ".bubbles .scrollable",
  bubble: ".bubble[data-mid]",
  incomingBubble: ".bubble.is-in[data-mid]",
  messageText: ".message",
  messageNoise: ".time, .reactions, .reply-markup, .bubble-name-forwarded, .reply",
  inlineButton: ".reply-markup-button",
  replyKeyboardButton: ".reply-keyboard .btn",
  composer: ".input-message-input[contenteditable='true']",
  chatTitle: ".chat-info .peer-title",
} as const;

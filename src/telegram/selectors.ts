// All Telegram Web K DOM knowledge lives here. When the web client changes, fix this file first.
export const SEL = {
  // Logged-in app shell
  chatList: "#column-left .chatlist-chat",
  // Auth pages (CSS-module class names are hashed, so match by prefix / text)
  qrCanvas: "canvas[class*='qrCanvas']",
  // Secondary button on the QR login page; appears before the QR canvas is rendered
  loginScreenButton: /log in by phone number/i,
  // Chat. K keeps the previous chat in the DOM during transitions, so everything is scoped to `.chat.active`.
  // Sponsored posts have negative mids and `.is-sponsored`.
  bubblesScrollable: ".chat.active .bubbles .scrollable",
  bubble: ".chat.active .bubble[data-mid]:not(.is-sponsored):not(.service)",
  incomingBubble: ".chat.active .bubble.is-in[data-mid]:not(.is-sponsored):not(.service)",
  messageText: ".message",
  messageNoise: ".time, .reactions, .reply-markup, .bubble-name-forwarded, .reply",
  inlineButton: ".reply-markup-button",
  replyKeyboardButton: ".reply-keyboard .btn",
  composer: ".chat.active .input-message-input[contenteditable='true']",
  outgoingBubble: ".chat.active .bubble.is-out[data-mid]",
  attachButton: ".chat.active .attach-file",
  menuItem: ".btn-menu-item",
  popup: ".popup.active",
  popupCaption: ".popup.active .input-message-input[contenteditable='true']",
  popupSend: ".popup.active .simple-message-input-confirm",
  popupButton: ".popup.active button",
  chatTitle: ".chat-info .peer-title",
} as const;

// Not part of SEL: SEL is passed into page.evaluate and must stay serializable.
export const activeChatPeer = (peerId: number) => `.chat.active [data-peer-id="${peerId}"]`;

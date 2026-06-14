/** Per-customer configuration for the shared Nettsmed chat widget. */
export type ChatWidgetColors = {
  primary: string; // launcher bg, user bubble, send btn, ink text
  primaryHover: string; // avatar bg, link, hover
  accent: string; // status dot, ping, data-bar, check
  headerGradientFrom: string;
  headerGradientTo: string;
  messageBg: string;
  border: string;
  quickPromptBorder: string;
  disabledSendBg: string;
  mutedLabel: string;
  placeholder: string;
  footerText: string;
  errorBg: string;
  errorBorder: string;
  errorText: string;
};

export type ChatWidgetConfig = {
  // identity / copy
  assistantName: string;
  orgName: string;
  avatarLetter: string;
  tagline: string;
  greeting: string;
  quickPromptsHeading: string;
  quickPrompts: string[];
  inputPlaceholder: string;
  footer: string;
  launcherLabel: string;
  errorMessage: string;
  retryLabel: string;
  // aria
  openAriaLabel: string;
  closeAriaLabel: string;
  sendAriaLabel: string;
  leadSavingLabel: string;
  // lead/contact tool wiring
  leadToolName: string; // matches `tool-${leadToolName}`
  leadEventName: string; // GA event name on successful lead
  // theming
  colors: ChatWidgetColors;
  // behavior
  apiPath?: string; // default "/api/chat"
  linkTarget?: "_blank" | "_top"; // default "_blank"
};

export type BridgeClient = {
  request: (action: string, payload?: unknown) => Promise<unknown>;
};

export type ClawdIds = Record<string, string>

declare module 'claude-code' {
  interface PluginState {
    'agent-roster': { ids: Shaped<ClawdIds> }
  }
}

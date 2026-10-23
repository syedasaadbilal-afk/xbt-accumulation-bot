import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.4:0',
  releaseNotes: {
    en_US:
      'New Larsson tab: daily XBT/BTC chart with the Larsson lines and regime colours, plus paper trades (signal price vs actual order-book price, 0.25 XBT per paper order). Paper only; no orders are placed.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

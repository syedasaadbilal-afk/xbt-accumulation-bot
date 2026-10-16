import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.1:0',
  releaseNotes: {
    en_US:
      'Drawdown-scaled DCA: buys more chunks per interval the further XBT/BTC trades below its 4h moving average, with a per-band budget. Fixed price tiers remain available.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

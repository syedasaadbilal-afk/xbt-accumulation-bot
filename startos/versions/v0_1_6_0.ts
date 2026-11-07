import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_6_0 = VersionInfo.of({
  version: '0.1.6:0',
  releaseNotes: {
    en_US:
      'Order size can now be set in BTC instead of XBT: each order spends a fixed amount of BTC, so more XBT is bought at lower prices. The Config tab has a BTC or XBT switch next to Order size; existing settings stay in XBT.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

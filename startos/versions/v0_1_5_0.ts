import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_5_0 = VersionInfo.of({
  version: '0.1.5:0',
  releaseNotes: {
    en_US:
      'Accumulation tab: new tiles for average cost (BTC per XBT) and last price versus average cost.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

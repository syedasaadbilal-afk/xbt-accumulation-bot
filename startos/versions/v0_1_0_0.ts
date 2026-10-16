import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_0_0 = VersionInfo.of({
  version: '0.1.0:0',
  releaseNotes: {
    en_US: 'Initial release: tiered XBT/BTC accumulation on Neoxa Exchange with one limit order open at a time.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

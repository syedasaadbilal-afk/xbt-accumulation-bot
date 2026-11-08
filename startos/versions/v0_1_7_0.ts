import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_7_0 = VersionInfo.of({
  version: '0.1.7:0',
  releaseNotes: {
    en_US:
      'Fix: after a partly filled order, the next order is now only the unfilled remainder of the chunk, not a whole new chunk.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.8:0',
  releaseNotes: {
    en_US:
      'When the price moves up into a shallower band, buying now stays blocked until the deeper band interval that already bought has ended. Moving down into a deeper band still buys right away.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.2:0',
  releaseNotes: {
    en_US: 'Network errors now show the real cause (DNS, timeout, refused) instead of "fetch failed"; 20 s request timeout.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

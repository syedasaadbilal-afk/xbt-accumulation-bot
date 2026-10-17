import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_2_0 = VersionInfo.of({
  version: '0.1.2:0',
  releaseNotes: {
    en_US: 'Clearer network errors; overall budget cap with overlapping band shares; add/remove DCA bands.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})

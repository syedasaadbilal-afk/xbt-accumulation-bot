import { i18n } from './i18n'
import { sdk } from './sdk'
import { uiPort } from './utils'

export const main = sdk.setupMain(async ({ effects }) => {
  console.info(i18n('Starting XBT Accumulation Bot'))

  return sdk.Daemons.of(effects).addDaemon('primary', {
    subcontainer: await sdk.SubContainer.of(
      effects,
      { imageId: 'xbt' },
      sdk.Mounts.of().mountVolume({
        volumeId: 'main',
        subpath: null,
        // Matches the Dockerfile's VOLUME ["/data"] - keep these in sync.
        mountpoint: '/data',
        readonly: false,
      }),
      'xbt-sub',
    ),
    exec: {
      command: ['node', '--experimental-sqlite', '--loader', 'ts-node/esm', 'src/index.ts'],
      cwd: '/app/packages/daemon',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: String(uiPort),
        XBT_DB_PATH: '/data/xbt.sqlite',
      },
    },
    ready: {
      display: i18n('Dashboard'),
      fn: () =>
        sdk.healthCheck.checkPortListening(effects, uiPort, {
          successMessage: i18n('The dashboard is ready'),
          errorMessage: i18n('The dashboard is not ready'),
        }),
    },
    requires: [],
  })
})

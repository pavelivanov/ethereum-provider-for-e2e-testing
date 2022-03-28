import { PlaywrightTestConfig } from '@playwright/test'


const config: PlaywrightTestConfig = {
  globalTimeout: 5 * 60 * 1000,
  use: {
    headless: false,
    viewport: {
      width: 1280,
      height: 720,
    },
    ignoreHTTPSErrors: true,
    launchOptions: {
      slowMo: 500,
    },
  },
}

export default config

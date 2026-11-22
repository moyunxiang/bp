import { defineConfig } from '@playwright/test';

// 端到端冒烟测试：针对构建产物（vite preview），用本机 Chrome，桌面宽度。

// 本机若设置了 HTTP(S)_PROXY，访问本地预览服务会被代理拦截，这里把本地地址排除掉
for (const k of ['NO_PROXY', 'no_proxy']) process.env[k] = [process.env[k], '127.0.0.1', 'localhost'].filter(Boolean).join(',');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

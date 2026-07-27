import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // 성능 리팩토링 2단계(perf: 엔진 utilityProcess 분리) — main 엔트리
    // (index.ts, 기본 lib 엔트리)에 더해 engineWorker.ts를 별도 산출물
    // (out/main/engineWorker.js)로도 빌드한다. `utilityProcess.fork()`는
    // 실제 파일 경로를 요구해 index.js 안에 번들되면 안 된다 — rollupOptions.input을
    // 명시하는 순간 electron-vite의 기본 lib 모드(단일 엔트리)는 꺼지므로,
    // 여기서 두 엔트리를 직접 나열한다(electron-vite-config-preset이 format=cjs·
    // external 처리는 그대로 적용).
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          engineWorker: resolve('src/main/engineWorker.ts')
        },
        output: {
          entryFileNames: '[name].js'
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})

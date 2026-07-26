import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // P3: src/main/scheduler.ts는 타이머·콜백을 전부 주입받아 electron 없이
    // 테스트 가능하다(engine 순수성 규칙은 src/engine/에만 적용 — main은 원래
    // electron을 import해도 되지만, scheduler.ts 자체는 하지 않는다).
    include: [
      'src/engine/**/*.{test,spec}.ts',
      'src/main/**/*.{test,spec}.ts',
      // P4 자동 업데이트: embed-appimage-update-info.mjs의 순수 파서 유닛 테스트.
      'scripts/**/*.{test,spec}.ts'
    ]
  }
})

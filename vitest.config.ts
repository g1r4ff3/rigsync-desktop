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
      'scripts/**/*.{test,spec}.ts',
      // R8: Candidates 화면 role-aware 문구(copy.ts)의 순수 로직 유닛 테스트.
      // renderer는 jsdom/testing-library가 없어(설치돼 있지 않음) 컴포넌트
      // 렌더 테스트는 못 하지만, 문구 분기 자체는 컴포넌트와 무관한 순수
      // 함수라 environment: 'node' 그대로 테스트할 수 있다(.tsx는 여전히 제외).
      'src/renderer/**/*.{test,spec}.ts'
    ]
  }
})

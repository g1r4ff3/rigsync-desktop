/**
 * R6: capability 8종을 한 번에 캡처하는 공용 헬퍼(additive-only, 결정 ③) —
 * DiffView의 "capture-first" 흐름과 Candidates(SyncItemsView)의 "보류 중 변경
 * 반영" 배너 둘 다 정확히 같은 동작(전 capability capture)이 필요해서 한
 * 곳으로 뺐다. 실패 시 각 IPC 호출의 에러를 그대로 던진다 — 호출부가
 * try/catch로 처리한다.
 */
export async function captureAll(): Promise<void> {
  await Promise.all([
    window.api.engine.captureDotfiles({ dryRun: false }),
    window.api.engine.capturePackages({ dryRun: false }),
    window.api.engine.captureAppimage({ dryRun: false }),
    window.api.engine.captureSettings({ dryRun: false }),
    window.api.engine.captureServices({ dryRun: false }),
    window.api.engine.captureScheduled({ dryRun: false }),
    window.api.engine.captureTools({ dryRun: false }),
    window.api.engine.captureRepos({ dryRun: false })
  ])
}

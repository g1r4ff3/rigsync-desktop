/**
 * doctor 표의 "더 이상 점검 안 함" 액션 — 구 repo `_ignore_set(cfg,"checks","names")`
 * 와 같은 ignore.toml 슬롯을 쓴다(gui.py 주석 "이 항목을 제외 목록(ignore)에
 * 추가해 doctor 점검에서..."). 동기화 항목 화면의 `toggleSyncItemIgnore`와 같은
 * `setIgnored` 재사용 — 새 메커니즘 아님.
 */
import type { RigsyncContext } from '../context'
import { setIgnored } from '../ignore'

export function ignoreDoctorCheck(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  name: string,
  ignored: boolean
): void {
  setIgnored(ctx, 'checks', 'names', name, ignored)
}

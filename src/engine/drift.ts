/**
 * drift 요약 + 재알림 억제 판단 — P3 트레이 상주 감시자의 "판단" 절반
 * (분업: 판단은 엔진, 배선은 main — `src/main/scheduler.ts` 참조).
 *
 * `summarizeDrift`는 순수 함수다: capability별로 이미 계산된 diff 결과에서
 * "drift 항목"에 해당하는 문자열 목록(예: apt.toInstall, dotfiles.toLink)을
 * 넘겨받아 카운트 + 내용 해시로 요약한다. **어떤 diff 필드가 drift로 치는지
 * 판단은 main(`src/main/driftCheck.ts`)의 책임**이다 — 이 파일은 capability별
 * DTO 모양을 전혀 모른다(engine 순수성과 별개로, "무엇이 drift인가"는 이미
 * 각 capability의 diff 함수가 정의해 놓은 것을 main이 그대로 조립할 뿐이라
 * 여기서 다시 판단할 이유가 없다).
 *
 * 해시는 카운트가 아니라 **항목 내용 자체**를 반영한다 — 예를 들어 어제
 * "apt 2개 미설치(git, curl)"와 오늘 "apt 2개 미설치(docker, vim)"는 카운트는
 * 같지만 명백히 다른 drift이므로 재알림 대상이어야 한다(카운트만 해시하면 이
 * 케이스를 "동일 drift"로 오판해 재알림을 누락한다).
 */
import { createHash } from 'node:crypto'

/** capability 이름 -> 그 capability의 drift 항목(사람이 읽을 키/설명) 목록. */
export type DriftInput = Readonly<Record<string, readonly string[]>>

export interface DriftSummary {
  readonly checkedAt: string
  readonly total: number
  readonly byCapability: Readonly<Record<string, number>>
  /** `byCapability`가 아니라 항목 내용 전체에 대한 안정적 직렬화 기반 해시. */
  readonly hash: string
}

function stableSerialize(input: DriftInput): string {
  const capabilities = Object.keys(input).sort()
  const rows = capabilities
    .map((cap) => [cap, [...input[cap]].sort()] as const)
    .filter(([, items]) => items.length > 0)
  return JSON.stringify(rows)
}

function contentHash(input: DriftInput): string {
  return createHash('sha256').update(stableSerialize(input)).digest('hex')
}

export function summarizeDrift(input: DriftInput, checkedAt: string): DriftSummary {
  const byCapability: Record<string, number> = {}
  let total = 0
  for (const [capability, items] of Object.entries(input)) {
    if (items.length === 0) continue
    byCapability[capability] = items.length
    total += items.length
  }
  return { checkedAt, total, byCapability, hash: contentHash(input) }
}

/**
 * 재알림 억제 정책(코디네이터 확정): drift **없음→있음** 전이, 또는 drift가
 * 있는 상태에서 **내용이 바뀌었을 때만** true. 같은 drift가 계속 남아있는
 * 상황(가장 흔한 케이스 — 사용자가 아직 Apply를 안 누름)에서 체크 주기마다
 * 반복 알림하지 않는다.
 */
export function shouldNotify(prev: DriftSummary | null, curr: DriftSummary): boolean {
  if (curr.total === 0) return false
  if (!prev || prev.total === 0) return true
  return prev.hash !== curr.hash
}

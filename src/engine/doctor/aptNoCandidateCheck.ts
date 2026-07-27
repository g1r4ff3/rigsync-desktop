/**
 * apt 저장소 후보 없음 검사 — 관리(managed, manifest에 선언된) apt 패키지 중
 * 어떤 저장소도 후보(candidate)를 제공하지 않는 것을 찾는다. 실사용 사고
 * (2026-07-27): 저장소 없는 로컬 .deb(gcm·rustdesk)가 apt 관리 목록에 들어가
 * follower Apply가 "Unable to locate package"로 실패했다(manifest는 정정
 * 완료) — 이 클래스를 기계 검출해 재발을 막는다.
 *
 * `apt-cache policy` 후보(`Candidate:`)가 "(none)"이면(apt는 패키지 이름을
 * 알지만 어떤 소스에도 없음 — 로컬 .deb가 전형) 또는 스탠자 자체가 없으면
 * (apt-cache가 이름 자체를 모름) 둘 다 "이 머신에 이 이름을 설치해줄 저장소가
 * 없다"는 같은 결론이라 하나의 finding으로 합친다.
 *
 * 원료는 `AptProvider.policyPackagesRaw`(planApt의 dpkg-외-충돌 경고,
 * classify.ts의 분류 원료와 같은 provider 메서드) — 새 spawn을 최소화하려고
 * 관리 목록 이름 전부를 배치 1회로 조회하고, 파싱은 planApt이 이미 쓰는
 * `parsePolicyCandidates`(apt.ts)를 재사용한다(새 파서를 만들지 않는다).
 */
import { parsePolicyCandidates } from '../capabilities/packages/apt'
import { readEffectivePackages } from '../capabilities/packages/io'
import type { AptProvider } from '../capabilities/packages/providerTypes'
import type { RigsyncContext } from '../context'

const NO_CANDIDATE_MARKER = '(none)'

export interface AptNoCandidateFinding {
  readonly packageName: string
}

export interface AptNoCandidateCheckResult {
  readonly findings: readonly AptNoCandidateFinding[]
  readonly warnings: readonly string[]
}

export async function checkAptNoCandidate(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  provider: Pick<AptProvider, 'isAvailable' | 'policyPackagesRaw'>
): Promise<AptNoCandidateCheckResult> {
  if (!provider.isAvailable()) return { findings: [], warnings: [] }

  const managed = readEffectivePackages(ctx).apt?.packages ?? []
  if (managed.length === 0) return { findings: [], warnings: [] }

  // 배치 1회 호출(다른 apt 원료 조회들과 동일 원칙) -- aptQueryCache가 이미
  // 캐싱하는 policySourcesRaw/prioritiesRaw와 달리 policyPackagesRaw는
  // 조회 이름 집합에 의존해 캐시 재사용이 어려워 여기서 직접 조회한다.
  const candidates = parsePolicyCandidates(await provider.policyPackagesRaw(managed))

  const findings: AptNoCandidateFinding[] = managed
    .filter((name) => {
      const candidate = candidates.get(name)
      return candidate === undefined || candidate === NO_CANDIDATE_MARKER
    })
    .map((packageName) => ({ packageName }))

  const warnings = findings.map(
    (f) =>
      `${f.packageName}: 어떤 저장소도 이 패키지를 제공하지 않음 -- follower Apply가 실패합니다. ` +
      '로컬 .deb였다면 Flatpak/binaries로 라우팅 재검토(docs/package-policy.md)'
  )

  return { findings, warnings }
}

/**
 * apt/flatpak 단건 등록 리졸버 — WS4("창고 모델 1차") `registry.ts`가 호출한다.
 * `capture.ts`의 전체 재캡처 루프와 달리, 이미 이 머신에 설치된 항목 하나를
 * manifest common 계층에 추가(upsert)만 한다(라이브 재조회 → common
 * read-modify-write, appimage `capture.ts`의 `resolveAppimageUpdateSource`
 * 선례와 같은 분리 원칙).
 */
import type { RigsyncContext } from '../../context'
import { parsePolicyPackages } from './classify'
import { readCommonPackages, writeCommonAptSection, writeCommonFlatpakSection } from './io'
import type { AptProvider, FlatpakProvider } from './providerTypes'

/**
 * apt-mark showmanual에는 잡히지만(패키지가 이 머신에 설치돼 있음) 실제
 * apt 저장소 출처가 없는 경우(로컬 .deb를 dpkg -i로 직접 설치) — follower가
 * `apt-get install`을 시도하면 "Unable to locate package"로 실패한다(선례:
 * gcm·rustdesk). 저장소 존재를 확인해 등록 시점에 거부한다.
 */
export class AptRepositoryNotFoundError extends Error {
  constructor(readonly packageName: string) {
    super(`${packageName}: 저장소에 없는 패키지 — Flatpak/binaries 경로 검토`)
    this.name = 'AptRepositoryNotFoundError'
  }
}

/**
 * apt 패키지 단건 등록. `apt-cache policy <name>` 원문을 classify.ts의
 * `parsePolicyPackages`로 파싱한다(third-party 판정과 동일한 파싱 경로 —
 * AptProvider 인터페이스에 새 메서드를 추가하지 않는다) — 이 함수는 "설치본"
 * 스탠자(`***`)의 소스 라인 중 `/var/lib/dpkg/status`(dpkg 자체, 저장소가
 * 아니다)를 제외한 것만 돌려주므로, 결과가 빈 배열이면 이 패키지를 재현할
 * 실제 apt 저장소가 없다는 뜻이다.
 */
export async function registerAptPackage(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: AptProvider,
  name: string
): Promise<void> {
  const sources = parsePolicyPackages(await provider.policyPackagesRaw([name])).get(name) ?? []
  if (sources.length === 0) {
    throw new AptRepositoryNotFoundError(name)
  }

  const existing = readCommonPackages(ctx).apt ?? {}
  const packages = existing.packages ?? []
  if (packages.includes(name)) return
  writeCommonAptSection(ctx, { ...existing, packages: [...packages, name].sort() })
}

export class FlatpakAppNotInstalledError extends Error {
  constructor(readonly applicationId: string) {
    super(`${applicationId}: 이 머신에 설치돼 있지 않아 origin을 확인할 수 없음`)
    this.name = 'FlatpakAppNotInstalledError'
  }
}

/**
 * flatpak 앱 단건 등록 — `flatpak list`가 이미 알려주는 origin remote를
 * 그대로 읽어 manifest에 upsert한다(추측·재해석 없음).
 */
export async function registerFlatpakApp(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  provider: FlatpakProvider,
  applicationId: string
): Promise<void> {
  const row = (await provider.apps()).find((a) => a.application === applicationId)
  if (!row) {
    throw new FlatpakAppNotInstalledError(applicationId)
  }

  const existing = readCommonPackages(ctx).flatpak ?? {}
  const apps = existing.app ?? []
  const nextApps = apps.some((a) => a.application === applicationId)
    ? apps.map((a) => (a.application === applicationId ? row : a))
    : [...apps, row]
  writeCommonFlatpakSection(ctx, { ...existing, app: nextApps })
}

/**
 * INV-1 중복 설치 검출 — 정책 §1.3: "하나의 앱은 정확히 하나의 계층에만
 * 존재한다. 중복 설치(apt+snap+flatpak)는 동기화 앱이 검출하고 경고해야
 * 한다." FORWARD.md §7 결정: v1은 **보수적 휴리스틱**(소문자 이름 포함
 * 매칭) + ignore로 개별 경고를 끌 수 있게.
 *
 * 순수 판정 로직(`detectDuplicateApps`)과 라이브 조회 배선(`detectDuplicates`)
 * 을 분리했다 — 판정 알고리즘 자체는 fake 데이터로 결정적으로 테스트한다.
 */
import { readAptBaseline } from './capabilities/packages/aptBaseline'
import type { GearLeverProvider } from './capabilities/appimage/providerTypes'
import type { PackageProviders } from './capabilities/packages/providerTypes'
import type { RigsyncContext } from './context'
import { readIgnoreSet } from './ignore'

export type DuplicateCapability = 'apt' | 'snap' | 'flatpak' | 'appimage'

export interface DuplicateSourceItem {
  readonly capability: DuplicateCapability
  /** 매칭에 쓰는 원문 라벨(패키지명/app ID/desktop_id 등) — 그대로 화면에 보여준다. */
  readonly label: string
}

export interface DuplicateWarning {
  /** 대표 이름(그룹의 첫 항목을 소문자화) — ignore 토글 키로도 쓴다. */
  readonly name: string
  readonly layers: readonly DuplicateSourceItem[]
  readonly ignored: boolean
}

/** 너무 짧은 이름끼리는(예: "at") 포함 매칭이 대부분 오탐이라 최소 길이를 둔다. */
const MIN_MATCH_LENGTH = 3

function namesOverlap(a: string, b: string): boolean {
  const na = a.toLowerCase()
  const nb = b.toLowerCase()
  if (na.length < MIN_MATCH_LENGTH || nb.length < MIN_MATCH_LENGTH) return false
  return na.includes(nb) || nb.includes(na)
}

/**
 * 순수 판정 함수 — 이름이 서로 겹치는(포함 관계인) **서로 다른 계층**의
 * 항목들을 그룹핑한다. 같은 계층 안의 항목끼리는 비교하지 않는다(예: apt
 * 안에서 "git"과 "git-lfs"가 우연히 겹쳐도 그건 중복 설치가 아니다).
 */
export function detectDuplicateApps(
  items: readonly DuplicateSourceItem[],
  ignoreNames: ReadonlySet<string> = new Set()
): DuplicateWarning[] {
  const warnings: DuplicateWarning[] = []
  const consumed = new Set<number>()

  for (let i = 0; i < items.length; i++) {
    if (consumed.has(i)) continue
    const group: DuplicateSourceItem[] = [items[i]]
    const groupIndexes = [i]
    for (let j = i + 1; j < items.length; j++) {
      if (consumed.has(j)) continue
      if (items[i].capability === items[j].capability) continue
      if (namesOverlap(items[i].label, items[j].label)) {
        group.push(items[j])
        groupIndexes.push(j)
      }
    }
    if (group.length > 1) {
      for (const idx of groupIndexes) consumed.add(idx)
      const name = group[0].label.toLowerCase()
      warnings.push({ name, layers: group, ignored: ignoreNames.has(name) })
    }
  }

  return warnings
}

/** 라이브 조회 배선 — apt(baseline 제외)/snap/flatpak/appimage 전부 모아 판정한다. */
export async function detectDuplicates(
  ctx: RigsyncContext,
  providers: PackageProviders,
  gearLeverProvider: GearLeverProvider
): Promise<DuplicateWarning[]> {
  const items: DuplicateSourceItem[] = []

  if (providers.apt.isAvailable()) {
    const baseline = readAptBaseline(ctx)
    for (const name of providers.apt.manualInstalled()) {
      if (baseline.has(name)) continue
      items.push({ capability: 'apt', label: name })
    }
  }
  if (providers.snap.isAvailable()) {
    for (const row of providers.snap.list()) {
      items.push({ capability: 'snap', label: row.name })
    }
  }
  if (providers.flatpak.isAvailable()) {
    for (const app of providers.flatpak.apps()) {
      items.push({ capability: 'flatpak', label: app.application })
    }
  }
  if (gearLeverProvider.isAvailable()) {
    for (const row of gearLeverProvider.listInstalled()) {
      items.push({ capability: 'appimage', label: row.desktopId })
    }
  }

  const ignoreNames = readIgnoreSet(ctx, 'duplicates', 'names')
  return detectDuplicateApps(items, ignoreNames)
}

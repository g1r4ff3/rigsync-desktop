/**
 * apt 무상태(stateless) 분류 — refactor-spec-v0.2 §1 본체. baseline 스냅샷
 * (`apt-baseline.txt`)을 은퇴시키고, "배포판 기본분인가"를 **매 조회 시
 * 계산**한다(스펙 판단 원칙 1: "속성은 계산하고, 이력은 기록하지 않는다").
 * 상태 파일이 없으므로 어느 머신에서나 같은 입력이면 같은 분류가 나온다 —
 * follower에 baseline 파일이 없어 필터가 통째로 죽던 사고 부류가 원천 봉쇄된다.
 *
 * 분류 규칙 (스펙 §1.2 확정 설계, 위에서부터 먼저 맞는 규칙 적용):
 * 1. 설치본의 저장소 출처가 전부 Ubuntu가 아니면(서드파티 repo) → 사용자 설치.
 * 2. 설치된 배포판 메타패키지의 의존+추천 폐포에 있으면 → 배포판 기본.
 * 3. priority ∈ {required, important, standard} → 배포판 기본. 그 외 → 사용자 설치.
 *
 * 규칙 1의 "출처 없음"(로컬 .deb 설치 — 소스 라인이 dpkg status뿐)은 서드파티
 * 확정으로 치지 않고 규칙 2·3으로 흘려보낸다 — 아카이브에서 사라진 구버전
 * Ubuntu 패키지가 "사용자"로 오판되는 걸 폐포·priority가 잡아줄 수 있고,
 * 로컬 .deb(claude-desktop류)는 어차피 폐포에도 priority 셋에도 없어 규칙 4
 * (기본값 사용자)로 정확히 떨어진다. 실측 검증(연구실 머신 2026-07-27):
 * manual 159 → 배포판 28 / 사용자 131, zotero·zsh·wezterm·code·claude-desktop·
 * cmake·zsync 전부 사용자, ubuntu-wallpapers·wpasupplicant 폐포로 배포판.
 *
 * 파싱은 전부 순수 함수 — provider는 명령 원문(stdout)만 돌려준다
 * (`parseAptRemoveDryRun` 전례). 한 번의 `classifyAptPackages` 호출이 원료
 * 4종을 각 1회씩만 조회한다(조회당 캐시 — 호출부는 작업당 1회 호출).
 */
import type { AptProvider } from './providerTypes'

export type AptPackageClass = 'user' | 'distro'

/** 설치돼 있으면 폐포의 뿌리가 되는 배포판 메타패키지 (스펙 §1.2 규칙 2). */
export const DISTRO_METAPACKAGE_RE =
  /^(ubuntu|kubuntu|xubuntu|lubuntu)-(minimal|standard|desktop|desktop-minimal)$/

/** priority가 이 셋에 들면 배포판 기본 (스펙 §1.2 규칙 3). */
const DISTRO_PRIORITIES: ReadonlySet<string> = new Set(['required', 'important', 'standard'])

/**
 * `apt-cache policy`(인자 없음) 원문 → 정규화된 소스 라인 → `o=` 출처 라벨.
 * 소스 라인 정규화 = priority 숫자와 들여쓰기를 뗀 나머지
 * (예: "http://archive.ubuntu.com/ubuntu noble/main amd64 Packages") —
 * 패키지별 policy 출력의 소스 라인과 문자열이 정확히 일치해 조인 키가 된다.
 * `o=`가 아예 없는 release 라인(실측: zotero repo `release n=./,c=`)은 빈
 * 문자열로 남는다 — "Ubuntu 아님"으로 정확히 분류된다.
 */
export function parsePolicySources(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  let current: string | null = null
  for (const line of raw.split('\n')) {
    const src = /^ (\d+) (.+)$/.exec(line)
    if (src) {
      current = src[2].trim()
      continue
    }
    const rel = /^\s+release (.+)$/.exec(line)
    if (rel && current) {
      const o = /(?:^|,)o=([^,]*)/.exec(rel[1])
      map.set(current, o ? o[1] : '')
    }
  }
  return map
}

/**
 * `apt-cache policy <names…>` 원문 → 패키지 → **설치본**(`***` 버전)의 소스
 * 라인 목록. `/var/lib/dpkg/status`(설치 기록 자체)는 출처가 아니므로 뺀다 —
 * 그래서 로컬 .deb 설치본은 빈 목록이 된다.
 */
export function parsePolicyPackages(raw: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let pkg: string | null = null
  let inInstalled = false
  for (const line of raw.split('\n')) {
    const head = /^(\S+):$/.exec(line)
    if (head) {
      pkg = head[1]
      map.set(pkg, [])
      inInstalled = false
      continue
    }
    if (/^ \*\*\* /.test(line)) {
      inInstalled = true
      continue
    }
    if (/^ {5}\S/.test(line)) {
      // 설치본이 아닌 다른 버전 스탠자 시작 -- 설치본 구간 종료.
      inInstalled = false
      continue
    }
    const src = /^ {8}\d+ (.+)$/.exec(line)
    if (src && inInstalled && pkg) {
      const s = src[1].trim()
      if (!s.startsWith('/var/lib/dpkg/status')) map.get(pkg)?.push(s)
    }
  }
  return map
}

/**
 * `apt-cache depends --recurse --installed …` 원문 → 폐포 멤버 집합.
 * 들여쓰기 없는 줄이 스탠자 헤더 = 폐포 멤버 (의존 라인·대안 제공자는 전부
 * 들여쓰기됨 — 실측 포맷 확인 2026-07-27).
 */
export function parseDependsClosure(raw: string): Set<string> {
  const set = new Set<string>()
  for (const line of raw.split('\n')) {
    if (/^\S/.test(line)) set.add(line.trim())
  }
  return set
}

/**
 * `dpkg-query -W -f='${Package}\t${Priority}\t${db:Status-Status}\n'` 원문 →
 * **설치 상태인** 패키지 → priority. 아키텍처 접미(`:amd64`)는 뗀다 —
 * `apt-mark showmanual`의 이름과 맞추기 위해. removed-but-config(rc) 항목은
 * Status-Status가 'installed'가 아니라 자연히 걸러진다.
 */
export function parseInstalledPriorities(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const m = /^(\S+)\t(\S*)\t(\S+)$/.exec(line)
    if (m && m[3] === 'installed') map.set(m[1].split(':')[0], m[2])
  }
  return map
}

/**
 * `names` 각각을 user/distro로 분류한다. provider 원료 4종을 각 1회 배치
 * 조회(이 호출 안에서만 재사용 — 상태 파일·프로세스 수명 캐시 없음).
 * 원료 조회가 전부 빈 문자열이면(테스트 fake 기본값·apt 이상) 모든 이름이
 * 규칙 4(기본값 사용자)로 떨어진다 — "보이지 않는 필터링 금지"(스펙 판단
 * 원칙 2)의 안전한 실패 방향: 숨기는 쪽이 아니라 다 보여주는 쪽으로 실패한다.
 */
export async function classifyAptPackages(
  provider: AptProvider,
  names: readonly string[]
): Promise<Map<string, AptPackageClass>> {
  const result = new Map<string, AptPackageClass>()
  if (names.length === 0) return result

  const priorities = parseInstalledPriorities(await provider.prioritiesRaw())
  const metapackages = [...priorities.keys()].filter((p) => DISTRO_METAPACKAGE_RE.test(p)).sort()
  const closure = parseDependsClosure(await provider.dependsClosureRaw(metapackages))
  const sourceOrigins = parsePolicySources(await provider.policySourcesRaw())
  const packageSources = parsePolicyPackages(await provider.policyPackagesRaw(names))

  for (const name of names) {
    const sources = packageSources.get(name) ?? []
    const thirdParty = sources.length > 0 && sources.every((s) => sourceOrigins.get(s) !== 'Ubuntu')
    if (thirdParty) {
      result.set(name, 'user')
    } else if (closure.has(name)) {
      result.set(name, 'distro')
    } else if (DISTRO_PRIORITIES.has(priorities.get(name) ?? '')) {
      result.set(name, 'distro')
    } else {
      result.set(name, 'user')
    }
  }
  return result
}

/**
 * apt 레이어 — 구 repo `capture_apt`/`diff_apt`/`plan_apt` 행동을 옮긴 것
 * (코드 복사 아님). 설치 목록·source·keyring 읽기는 전부 `AptProvider`
 * 인터페이스를 거친다(P2a 결정 ⑥ — 시스템 조회 격리).
 *
 * install/restore 액션은 전부 sudo가 필요해 `privileged: true`다(결정 ②) —
 * P2b(권한 상승 통합) 전까지 executor가 실행하지 않고 skipped 처리한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { readAptIncludeSet, readIgnoreSet } from '../../ignore'
import type { PlanAction } from '../../plan'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { classifyAptPackagesCached } from './aptQueryCache'
import { readCommonPackages, readEffectivePackages, writeCommonAptSection } from './io'
import type { AptProvider } from './providerTypes'
import type {
  AptCaptureReport,
  AptDiffReport,
  AptRemoveDependencyReport,
  AptSection,
  AptSourceEntry
} from './types'

const SIGNED_BY_DEB822 = /^Signed-By:\s*(.+)$/i
const SIGNED_BY_ONELINE = /signed-by=([^\]\s]+)/

/**
 * deb822 .sources(또는 one-line) 텍스트에서 Signed-By가 가리키는 절대 키링
 * 경로를 뽑는다. 키 자체가 인라인 ASCII-armored 블록으로 박혀 있으면(복사할
 * 별도 파일이 없으므로) 빈 문자열을 반환한다 — 구 repo `_find_keyring_ref` 이식.
 */
export function findKeyringRef(text: string): string {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const deb822 = SIGNED_BY_DEB822.exec(line)
    if (deb822) {
      const value = deb822[1].trim().replace(/^"|"$/g, '')
      if (value.startsWith('-----BEGIN PGP')) return ''
      return value
    }
    const oneline = SIGNED_BY_ONELINE.exec(line)
    if (oneline) return oneline[1].trim()
  }
  return ''
}

const LIVE_SOURCES_DIR = '/etc/apt/sources.list.d'

/**
 * `apt-cache policy <names…>` 원문 → 패키지 → `Candidate:` 버전 문자열.
 * `classify.ts`의 `parsePolicyPackages`와 같은 스탠자 헤더(`^(\S+):$`)를
 * 재사용하지만, 뽑는 필드가 다르므로(설치본 소스 목록이 아니라 후보 버전)
 * 별도 함수로 둔다 — 목적은 dpkg 비소속 충돌 경고 문구의 "(후보 <버전>)".
 */
export function parsePolicyCandidates(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  let pkg: string | null = null
  for (const line of raw.split('\n')) {
    const head = /^(\S+):$/.exec(line)
    if (head) {
      pkg = head[1]
      continue
    }
    const cand = /^\s{2}Candidate:\s*(.+)$/.exec(line)
    if (cand && pkg) map.set(pkg, cand[1].trim())
  }
  return map
}

export interface AptNonDpkgConflict {
  readonly name: string
  readonly absPath: string
}

/**
 * 설치 예정 패키지명과 동일한 이름의 실행파일이 PATH에 이미 있고 dpkg
 * 밖(비관리)인 경우를 찾는다 — 실증 사례(rclone 공식 스크립트로 /usr/bin에
 * 깔린 v1.74.4가 apt 설치로 아무 고지 없이 아카이브 구버전에 덮일 뻔한 사고)
 * 재발 방지의 일반 장치.
 *
 * **한계** — 패키지명과 실행파일명이 같다고 가정한다(예: `ripgrep` 패키지의
 * 실행파일은 `rg`라 이 검사가 못 잡는다). 이 한계를 감추지 않는다: 경고
 * 문구·이 주석 모두에 명시.
 *
 * 기존 설치본의 버전을 알아내려고 그 실행파일을 실행하지 않는다(신뢰할 수
 * 없는 바이너리 실행은 안전 위험) — 정적 사실(경로 존재·dpkg 미소속)만 본다.
 * apt 후보 버전은 별도로 `apt-cache policy`(신뢰된 시스템 조회)에서 얻는다.
 *
 * PATH 해석은 셸 규칙과 동일하게 **앞 디렉터리가 이긴다** — 각 이름당 첫
 * 히트에서 멈춘다.
 */
export async function findNonDpkgConflicts(
  provider: Pick<AptProvider, 'fileExists' | 'dpkgOwnsPaths'>,
  names: readonly string[],
  pathDirs: readonly string[]
): Promise<AptNonDpkgConflict[]> {
  // 1단계: 이름당 PATH 첫 히트만 고른다(fs.stat뿐 -- subprocess 없음).
  const firstHits: { readonly name: string; readonly absPath: string }[] = []
  for (const name of names) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, name)
      if (!provider.fileExists(candidate)) continue
      firstHits.push({ name, absPath: candidate })
      break
    }
  }
  // 2단계: dpkg 소속 여부를 후보 전부에 대해 한 번에 배치 조회한다
  // (실측 2026-07-27: 이름당 개별 `dpkg -S`는 프로세스 기동 비용이 누적된다).
  const owned = await provider.dpkgOwnsPaths(firstHits.map((h) => h.absPath))
  return firstHits
    .filter((h) => !owned.has(h.absPath))
    .map((h) => ({ name: h.name, absPath: h.absPath }))
}

/**
 * PATH 디렉터리 목록 — **프로세스 PATH**(`process.env.PATH`)를 쓴다(사용자
 * 로그인 셸의 PATH가 아니다). rigsync 앱이 실제로 관측 가능한 유일한
 * PATH이고("앱이 아는 사실만 말한다"), 로그인 셸이 `.bashrc`/`.zshrc`에서
 * PATH를 다르게 구성했다면 이 검사가 그 차이를 볼 수 없다는 한계는 경고
 * 문구가 아니라 helpCopy(Doctor 쪽)에 명시한다.
 */
function currentPathDirs(): string[] {
  return (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
}

function sourcesStoreDir(ctx: Pick<RigsyncContext, 'manifestDir'>): string {
  return path.join(ctx.manifestDir, 'packages', 'apt', 'sources')
}

function keyringsStoreDir(ctx: Pick<RigsyncContext, 'manifestDir'>): string {
  return path.join(ctx.manifestDir, 'packages', 'apt', 'keyrings')
}

export interface CaptureAptOptions {
  readonly dryRun: boolean
}

export async function captureApt(
  ctx: RigsyncContext,
  provider: AptProvider,
  options: CaptureAptOptions
): Promise<AptCaptureReport> {
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      manualInstalled: 0,
      packagesInManifest: 0,
      packagesAdded: 0,
      sourcesCaptured: 0,
      keyringsCaptured: 0,
      notes: ['apt-mark not found on PATH -- skipping']
    }
  }

  const manualAll = await provider.manualInstalled()
  const notes: string[] = []

  // 무상태 분류(refactor-spec-v0.2 §1) -- "배포판 기본분인가"를 상태 파일
  // 없이 매 조회 계산한다. 사용자 판정 + include 예외만 자동 추가 대상
  // (기존 additive-only·ignore 규약은 그대로).
  const classification = await classifyAptPackagesCached(provider, manualAll)
  const include = readAptIncludeSet(ctx)
  const manual = manualAll.filter((p) => classification.get(p) === 'user' || include.has(p))
  const distroFiltered = manualAll.length - manual.length
  if (distroFiltered > 0) {
    notes.push(
      `배포판 기본 판정 ${distroFiltered}개는 자동 추가 대상에서 제외 -- ` +
        'Candidates의 "배포판 기본" 그룹에서 확인·포함(include) 가능'
    )
  }

  // 구 apt-baseline.txt 은퇴(스펙 §1 마이그레이션) -- 발견되면 삭제하고 알린다.
  // 스냅샷 시점 이력이 분류를 대신하던 파일이라 남겨두면 혼동만 남는다.
  const legacyBaseline = path.join(
    ctx.homeDir,
    '.local',
    'share',
    'rigsync-desktop',
    'apt-baseline.txt'
  )
  if (fs.existsSync(legacyBaseline)) {
    if (!options.dryRun) fs.rmSync(legacyBaseline)
    notes.push('구 apt-baseline.txt 발견 -- 무상태 분류로 대체되어 삭제함 (기준선 스냅샷 은퇴)')
  }

  const existing = readCommonPackages(ctx).apt ?? {}
  const existingPackages = existing.packages ?? []
  const ignorePackages = readIgnoreSet(ctx, 'apt', 'packages')
  const ignoreSources = readIgnoreSet(ctx, 'apt', 'sources')

  // ignore는 additive-only의 유일한 예외: 이미 manifest에 있었어도 제거된다.
  const newPackages = Array.from(new Set([...existingPackages, ...manual]))
    .filter((p) => !ignorePackages.has(p))
    .sort()

  const existingSources = new Map<string, AptSourceEntry>(
    (existing.sources ?? []).filter((s) => !ignoreSources.has(s.name)).map((s) => [s.name, s])
  )

  const captured: AptSourceEntry[] = []
  let nSources = 0
  let nKeyrings = 0

  for (const file of provider.listSourceFiles()) {
    if (ignoreSources.has(file.name)) continue

    let keyringDest = ''
    const ref = findKeyringRef(file.content)
    if (ref) {
      keyringDest = ref
      if (!options.dryRun) {
        if (provider.fileExists(ref)) {
          const bytes = provider.readFileBytes(ref)
          if (bytes) {
            fs.mkdirSync(keyringsStoreDir(ctx), { recursive: true })
            fs.writeFileSync(path.join(keyringsStoreDir(ctx), path.basename(ref)), bytes)
            nKeyrings += 1
          } else {
            notes.push(`keyring ${ref}: unreadable`)
          }
        } else {
          notes.push(`keyring ${ref}: referenced but not found`)
        }
      }
    }

    if (!options.dryRun) {
      fs.mkdirSync(sourcesStoreDir(ctx), { recursive: true })
      fs.writeFileSync(path.join(sourcesStoreDir(ctx), file.name), file.content)
    }
    nSources += 1
    captured.push({
      name: file.name,
      file: `packages/apt/sources/${file.name}`,
      keyringDest
    })
  }

  const mergedSources = new Map(existingSources)
  for (const s of captured) mergedSources.set(s.name, s)

  const aptSection: AptSection = {
    packages: newPackages,
    ...(mergedSources.size > 0 ? { sources: [...mergedSources.values()] } : {})
  }

  if (!options.dryRun) {
    writeCommonAptSection(ctx, aptSection)
  }

  return {
    skipped: false,
    manualInstalled: manualAll.length,
    packagesInManifest: newPackages.length,
    packagesAdded: newPackages.filter((p) => !existingPackages.includes(p)).length,
    sourcesCaptured: nSources,
    keyringsCaptured: nKeyrings,
    notes
  }
}

export async function diffApt(ctx: RigsyncContext, provider: AptProvider): Promise<AptDiffReport> {
  if (!provider.isAvailable()) {
    return {
      skipped: true,
      toInstall: [],
      uncaptured: [],
      sourcesMissing: [],
      sourcesContentChanged: []
    }
  }

  const manualAll = await provider.manualInstalled()
  const classification = await classifyAptPackagesCached(provider, manualAll)
  const include = readAptIncludeSet(ctx)
  const manifest = readEffectivePackages(ctx).apt ?? {}
  const ignorePackages = readIgnoreSet(ctx, 'apt', 'packages')
  const ignoreSources = readIgnoreSet(ctx, 'apt', 'sources')

  const manifestPackages = new Set((manifest.packages ?? []).filter((p) => !ignorePackages.has(p)))

  // toInstall은 분류와 무관하게 "설치돼 있는가"만 본다 -- 구 baseline 구현은
  // 기준선 차집합과 비교해서, manifest에 있으면서 기준선에도 든 설치본이
  // 영원히 "설치 예정"으로 보이는 함정이 있었다(무상태 재설계에서 제거).
  const installed = new Set(manualAll)
  const toInstall = [...manifestPackages].filter((p) => !installed.has(p)).sort()
  // 후보(uncaptured)는 capture와 같은 규칙: 사용자 판정 + include 예외만.
  const uncaptured = manualAll
    .filter((p) => classification.get(p) === 'user' || include.has(p))
    .filter((p) => !ignorePackages.has(p) && !manifestPackages.has(p))
    .sort()

  const sourcesMissing: string[] = []
  const sourcesContentChanged: string[] = []
  for (const s of manifest.sources ?? []) {
    if (ignoreSources.has(s.name)) continue
    const livePath = path.join(LIVE_SOURCES_DIR, s.name)
    if (!provider.fileExists(livePath)) {
      sourcesMissing.push(s.name)
      continue
    }
    const storedPath = path.join(ctx.manifestDir, s.file)
    if (fs.existsSync(storedPath)) {
      const liveBytes = provider.readFileBytes(livePath)
      const storedBytes = fs.readFileSync(storedPath)
      if (liveBytes && !liveBytes.equals(storedBytes)) {
        sourcesContentChanged.push(s.name)
      }
    }
    if (s.keyringDest && !provider.fileExists(s.keyringDest)) {
      sourcesMissing.push(`${s.name} (keyring)`)
    }
  }

  return { skipped: false, toInstall, uncaptured, sourcesMissing, sourcesContentChanged }
}

export async function planApt(
  ctx: RigsyncContext,
  provider: AptProvider,
  diff: AptDiffReport
): Promise<PlanAction[]> {
  if (diff.skipped) return []
  // v0.1.7 순서 수정(신선한 머신 첫 apply 실사고): install은 sources 복원·
  // keyring 복원·apt-get update **뒤**에 와야 한다 — 앞에 두면 PPA/서드파티
  // repo에서 와야 할 패키지가 Ubuntu 기본 아카이브의 구버전으로 설치되거나
  // 실패하고, pkexec 배치는 첫 실패에서 멈추므로 sources 복원까지 연쇄
  // 미실행이 된다(lab-main 프로비저닝에서 실제 발생). 정책 §6의 순서 보장
  // (sources 변경 → update → install)을 plan 순서로 구현한다.
  const actions: PlanAction[] = []

  const manifest = readEffectivePackages(ctx).apt ?? {}
  let anySourceChange = false
  for (const s of manifest.sources ?? []) {
    const storedPath = path.join(ctx.manifestDir, s.file)
    if (!fs.existsSync(storedPath)) continue
    const livePath = path.join(LIVE_SOURCES_DIR, s.name)
    const liveExists = provider.fileExists(livePath)
    const liveBytes = liveExists ? provider.readFileBytes(livePath) : null
    const storedBytes = fs.readFileSync(storedPath)
    if (!liveExists || !liveBytes || !liveBytes.equals(storedBytes)) {
      anySourceChange = true
      const cmd = ['sudo', 'cp', storedPath, livePath]
      actions.push({
        capability: 'packages',
        summary: `restore apt source ${s.name}`,
        commands: [cmd.join(' ')],
        privileged: true,
        run: notExecutedUntilP2b
      })
    }
    if (s.keyringDest) {
      const storedKeyring = path.join(keyringsStoreDir(ctx), path.basename(s.keyringDest))
      if (fs.existsSync(storedKeyring) && !provider.fileExists(s.keyringDest)) {
        anySourceChange = true
        const cmd = ['sudo', 'cp', storedKeyring, s.keyringDest]
        actions.push({
          capability: 'packages',
          summary: `restore keyring ${path.basename(s.keyringDest)}`,
          commands: [cmd.join(' ')],
          privileged: true,
          run: notExecutedUntilP2b
        })
      }
    }
  }
  if (anySourceChange) {
    actions.push({
      capability: 'packages',
      summary: 'apt-get update (sources changed)',
      commands: ['sudo apt-get update'],
      privileged: true,
      run: notExecutedUntilP2b
    })
  }

  if (diff.toInstall.length > 0) {
    const cmd = ['sudo', 'apt-get', 'install', '-y', ...diff.toInstall]
    const commands = [cmd.join(' ')]

    // 실증 사고 재발 방지(위 findNonDpkgConflicts 주석 참조) -- 설치 대상과
    // 동일 이름의 dpkg 밖 실행파일이 PATH에 이미 있으면 사전 경고 줄을
    // commands 미리보기에 덧붙인다. Candidate 버전은 충돌이 실제로 있을
    // 때만 조회한다(불필요한 apt-cache 호출을 피한다).
    const conflicts = await findNonDpkgConflicts(provider, diff.toInstall, currentPathDirs())
    if (conflicts.length > 0) {
      const candidates = parsePolicyCandidates(
        await provider.policyPackagesRaw(conflicts.map((c) => c.name))
      )
      for (const c of conflicts) {
        const version = candidates.get(c.name) ?? '알 수 없음'
        commands.push(
          `# 경고: ${c.absPath}에 dpkg 밖 설치본이 이미 있음 — apt 설치(후보 ${version})가 ` +
            '이를 덮어쓰거나 PATH에서 가려질 수 있습니다. 기존 설치 방식을 확인하세요 ' +
            '(binaries capability가 정답일 수 있음 — docs/package-policy.md)'
        )
      }
    }

    actions.push({
      capability: 'packages',
      summary: `install ${diff.toInstall.length} apt package(s)`,
      commands,
      privileged: true,
      run: notExecutedUntilP2b
    })
  }

  return actions
}

/**
 * privileged 액션은 PlanExecutor가 실행 전에 걸러 skipped 처리하므로 이 함수
 * 본문은 정상 경로에서는 절대 호출되지 않는다 — 방어적 자리표시자.
 */
async function notExecutedUntilP2b(): Promise<{ ok: boolean; detail: string }> {
  throw new Error(
    'privileged apt actions are not executed until P2b (privilege elevation integration)'
  )
}

const REMOVE_HEADER = 'The following packages will be REMOVED:'

/**
 * `apt-get remove --dry-run` 원문(stdout+stderr)에서 "The following packages
 * will be REMOVED:" 섹션만 뽑는다 — 안전 불변식 5 필수 조건("함께 제거될
 * 목록을 그대로 노출"). apt는 이 헤더 앞에 "…are no longer required"(autoremove
 * 후보) 섹션을 먼저 낼 수 있어 그 줄들은 건너뛰고, REMOVED 섹션 시작 뒤로는
 * 들여쓰기된(공백으로 시작하는) 줄만 계속 읽다가 들여쓰기 없는 줄(요약 줄
 * "0 upgraded, …")을 만나면 멈춘다 — 실기 확인(2026-07-26, `apt-get remove
 * --dry-run curl`)한 실제 출력 포맷을 그대로 반영한다. 헤더를 못 찾으면(예:
 * 의존성 충돌로 apt가 에러만 내는 경우) 빈 목록을 돌려준다 — 에러로 던지지
 * 않고 "경고 없음"으로 조용히 처리한다(호출부가 요청 목록 자체를 신뢰).
 */
export function parseAptRemoveDryRun(
  output: string,
  requested: readonly string[]
): AptRemoveDependencyReport {
  const lines = output.split('\n')
  const headerIdx = lines.findIndex((l) => l.trim() === REMOVE_HEADER)
  const willRemove: string[] = []
  if (headerIdx !== -1) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i]
      if (!/^\s+\S/.test(line)) break
      willRemove.push(...line.trim().split(/\s+/).filter(Boolean))
    }
  }
  const requestedSet = new Set(requested)
  const uniqueWillRemove = [...new Set(willRemove)].sort()
  const extra = uniqueWillRemove.filter((p) => !requestedSet.has(p))
  return { requested: [...requested], willRemove: uniqueWillRemove, extra }
}

/**
 * privileged 제거 액션도 install과 동일하게 P2b(권한 상승 통합) 전까지
 * PlanExecutor가 skipped 처리한다 — 방어적 자리표시자.
 */
async function notExecutedUntilP2bRemove(): Promise<{ ok: boolean; detail: string }> {
  throw new Error(
    'privileged apt remove actions are not executed until P2b (privilege elevation integration)'
  )
}

/**
 * apt uninstall 계획 — 안전 불변식 5: manifest에 선언된(managed) 패키지는
 * 거부하고, ignore(일시중지)되지 않은 패키지도 거부한다. 유효 대상은
 * 여러 개라도 **한 번의 `apt-get remove`로 묶는다**(코디네이터 지시 —
 * 개별 호출은 인증·시간 낭비). `--auto-remove`/`purge`는 절대 붙이지 않아
 * 범위를 넓히지 않는다. 의존성 경고(`dependencies`)는 항상 계산해서
 * 돌려준다 — dry-run 자체는 root 없이도 안전(실기 확인, provider 주석 참조).
 */
export async function planAptUninstall(
  ctx: RigsyncContext,
  provider: AptProvider,
  requestedNames: readonly string[]
): Promise<CapabilityUninstallResult & { readonly dependencies?: AptRemoveDependencyReport }> {
  if (!provider.isAvailable()) {
    return {
      actions: [],
      excluded: requestedNames.map((key) => ({
        capability: 'apt',
        key,
        reason: 'apt-mark를 찾을 수 없음(apt 미사용 환경)'
      }))
    }
  }

  const manifest = readEffectivePackages(ctx).apt ?? {}
  const managedSet = new Set(manifest.packages ?? [])
  const ignore = readIgnoreSet(ctx, 'apt', 'packages')
  const classification = await classifyAptPackagesCached(provider, requestedNames)
  const installedSet = new Set(await provider.manualInstalled())

  const excluded: UninstallExclusion[] = []
  const validNames: string[] = []

  for (const name of requestedNames) {
    if (managedSet.has(name)) {
      excluded.push({
        capability: 'apt',
        key: name,
        reason: 'manifest에 선언된(managed) 항목은 삭제 대상이 아님 — 먼저 일시중지(ignore)하세요'
      })
      continue
    }
    if (!ignore.has(name)) {
      excluded.push({
        capability: 'apt',
        key: name,
        reason: '일시중지(ignore)되지 않은 항목은 삭제 대상이 아님'
      })
      continue
    }
    if (!installedSet.has(name) || classification.get(name) === 'distro') {
      excluded.push({
        capability: 'apt',
        key: name,
        reason: '이 머신에 설치돼 있지 않음(또는 배포판 기본 패키지)'
      })
      continue
    }
    validNames.push(name)
  }

  if (validNames.length === 0) {
    return { actions: [], excluded }
  }

  const sortedNames = [...validNames].sort()
  const dependencies = parseAptRemoveDryRun(await provider.removeDryRun(sortedNames), sortedNames)

  const cmd = ['sudo', 'apt-get', 'remove', '-y', ...sortedNames]
  const action: PlanAction = {
    capability: 'packages',
    summary: `remove ${sortedNames.length} apt package(s)`,
    commands: [cmd.join(' ')],
    privileged: true,
    run: notExecutedUntilP2bRemove
  }

  return { actions: [action], excluded, dependencies }
}

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
import { readIgnoreSet } from '../../ignore'
import type { PlanAction } from '../../plan'
import type { CapabilityUninstallResult, UninstallExclusion } from '../../uninstall/types'
import { aptBaselineExists, readAptBaseline, writeAptBaseline } from './aptBaseline'
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

  const manualAll = provider.manualInstalled()
  const notes: string[] = []

  // 첫 capture -- 지금 상태 전체를 "배포판 기본분" 기준선으로 스냅샷한다
  // (정책 §8-B 답). 이후부터는 이 기준선과의 차집합만 사용자가 추가한
  // 패키지로 본다.
  let baseline = readAptBaseline(ctx)
  if (!aptBaselineExists(ctx)) {
    if (!options.dryRun) {
      writeAptBaseline(ctx, manualAll)
    }
    baseline = new Set(manualAll)
    notes.push(
      `apt baseline 스냅샷: 배포판 기본분 ${manualAll.length}개 기록 -- 다음 capture부터 차집합만 후보`
    )
  }
  const manual = manualAll.filter((p) => !baseline.has(p))

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

  const baseline = readAptBaseline(ctx)
  const manual = new Set(provider.manualInstalled().filter((p) => !baseline.has(p)))
  const manifest = readEffectivePackages(ctx).apt ?? {}
  const ignorePackages = readIgnoreSet(ctx, 'apt', 'packages')
  const ignoreSources = readIgnoreSet(ctx, 'apt', 'sources')

  const manifestPackages = new Set((manifest.packages ?? []).filter((p) => !ignorePackages.has(p)))
  for (const p of ignorePackages) manual.delete(p)

  const toInstall = [...manifestPackages].filter((p) => !manual.has(p)).sort()
  const uncaptured = [...manual].filter((p) => !manifestPackages.has(p)).sort()

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

export function planApt(
  ctx: RigsyncContext,
  provider: AptProvider,
  diff: AptDiffReport
): PlanAction[] {
  if (diff.skipped) return []
  const actions: PlanAction[] = []

  if (diff.toInstall.length > 0) {
    const cmd = ['sudo', 'apt-get', 'install', '-y', ...diff.toInstall]
    actions.push({
      capability: 'packages',
      summary: `install ${diff.toInstall.length} apt package(s)`,
      commands: [cmd.join(' ')],
      privileged: true,
      run: notExecutedUntilP2b
    })
  }

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
export function planAptUninstall(
  ctx: RigsyncContext,
  provider: AptProvider,
  requestedNames: readonly string[]
): CapabilityUninstallResult & { readonly dependencies?: AptRemoveDependencyReport } {
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
  const baseline = readAptBaseline(ctx)
  const installedSet = new Set(provider.manualInstalled())

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
    if (!installedSet.has(name) || baseline.has(name)) {
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
  const dependencies = parseAptRemoveDryRun(provider.removeDryRun(sortedNames), sortedNames)

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

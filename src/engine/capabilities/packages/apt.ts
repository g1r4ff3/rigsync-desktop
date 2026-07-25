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
import { readCommonPackages, readEffectivePackages, writeCommonAptSection } from './io'
import type { AptProvider } from './providerTypes'
import type { AptCaptureReport, AptDiffReport, AptSection, AptSourceEntry } from './types'

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

  const manual = provider.manualInstalled()
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
  const notes: string[] = []

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
    manualInstalled: manual.length,
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

  const manual = new Set(provider.manualInstalled())
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

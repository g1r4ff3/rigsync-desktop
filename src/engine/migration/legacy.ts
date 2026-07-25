/**
 * 구 `~/repos/rigsync` manifest → 새 스키마 마이그레이션. **구 repo는 어떤
 * 경우에도 쓰지 않는다** — 이 파일의 모든 fs 호출은 `legacyRepoPath` 아래에서
 * `readFileSync`/`existsSync`/`readdirSync`만 쓴다(쓰기는 전부 `ctx.manifestDir`
 * 아래로만).
 *
 * 구 스키마 ↔ 새 스키마 필드 대응은 대부분 1:1이다(구 repo 실측,
 * `~/repos/rigsync/manifest/common/*.toml`) — TOML 필드 이름까지 같은 경우가
 * 많아 재작성이 거의 필요 없다. 예외 3가지:
 * 1. **apt keyring_dest → keyringDest** (snake_case -> camelCase, 값은 동일)
 * 2. **snap** — 정책 §7 비목표(동기화 대상 아님). 변환하지 않고 개수만 보고.
 * 3. **appimage** — 구 url_template 모델은 T3(Gear Lever desktop_id 기반)와
 *    구조가 근본적으로 달라 자동 변환 불가. 앱 이름만 "수동 통합 필요"로 보고.
 *
 * 파일 스토어 경로도 규칙만 다르고 내용은 그대로 복사한다(예: dconf는
 * `files/dconf/<slug>.ini` -> `settings/dconf/<slug>.ini`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { PACKAGES_LAYER } from '../capabilities/packages/constants'
import { REPOS_LAYER } from '../capabilities/repos/constants'
import { SCHEDULED_STORE_REL_PATH } from '../capabilities/scheduled/constants'
import { SERVICES_LAYER } from '../capabilities/services/constants'
import { SETTINGS_LAYER } from '../capabilities/settings/constants'
import { TOOLS_LAYER } from '../capabilities/tools/constants'
import type { RigsyncContext } from '../context'
import { CHECKS_LAYER } from '../doctor/report'
import { IGNORE_LAYER } from '../ignore'
import {
  commonLayerPath,
  hostLayerPath,
  readCommonLayer,
  writeManifestFile,
  type ManifestDocument
} from '../manifest'
import type { LegacyMigrationItem, LegacyMigrationSummary } from './types'

export interface MigrateLegacyOptions {
  readonly dryRun: boolean
}

// --------------------------------------------------------------------------
// 구 repo 경로 헬퍼 (읽기 전용)
// --------------------------------------------------------------------------

function legacyCommonPath(legacyRepoPath: string, layer: string): string {
  return path.join(legacyRepoPath, 'manifest', 'common', `${layer}.toml`)
}

function legacyHostsDir(legacyRepoPath: string): string {
  return path.join(legacyRepoPath, 'manifest', 'hosts')
}

function legacyFilesDir(legacyRepoPath: string): string {
  return path.join(legacyRepoPath, 'manifest', 'files')
}

function legacyDotfilesStoreDir(legacyRepoPath: string): string {
  return path.join(legacyRepoPath, 'dotfiles')
}

function readLegacyToml(absPath: string): ManifestDocument {
  if (!fs.existsSync(absPath)) return {}
  return parseToml(fs.readFileSync(absPath, 'utf-8')) as ManifestDocument
}

/** 구 repo `manifest/hosts/`의 하위 디렉터리 이름들(README.md 등 파일 제외). */
function listLegacyHosts(legacyRepoPath: string): string[] {
  const dir = legacyHostsDir(legacyRepoPath)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

function copyFileIfNeeded(dryRun: boolean, src: string, dst: string): boolean {
  if (!fs.existsSync(src)) return false
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
  return true
}

// --------------------------------------------------------------------------
// capability별 마이그레이션
// --------------------------------------------------------------------------

interface Ctx {
  readonly ctx: RigsyncContext
  readonly legacyRepoPath: string
  readonly dryRun: boolean
}

function migrateDotfiles(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'dotfiles')) as {
    entry?: Array<{ home: string; store: string; type: string; link?: boolean; mode?: string }>
  }
  const entries = legacy.entry ?? []
  if (entries.length === 0) {
    return { capability: 'dotfiles', action: 'skipped', detail: '구 manifest에 entry 없음' }
  }
  let copied = 0
  for (const e of entries) {
    // store는 "dotfiles/<relpath>" 형태로 두 스키마가 동일 -- 구 repo_path
    // 기준, 새 ctx.manifestDir 기준으로 루트만 바뀐다.
    const src = path.join(
      legacyDotfilesStoreDir(c.legacyRepoPath),
      e.store.replace(/^dotfiles\//, '')
    )
    const dst = path.join(c.ctx.manifestDir, e.store)
    if (e.type === 'dir') {
      if (fs.existsSync(src)) {
        if (!c.dryRun) fs.cpSync(src, dst, { recursive: true })
        copied += 1
      }
    } else if (copyFileIfNeeded(c.dryRun, src, dst)) {
      copied += 1
    }
  }
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, DOTFILES_LAYER), { entry: entries })
  }
  return {
    capability: 'dotfiles',
    action: 'migrated',
    detail: `entry ${entries.length}개, 스토어 파일/디렉터리 ${copied}개 복사`
  }
}

function migrateApt(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'apt')) as {
    packages?: string[]
    sources?: Array<{ name: string; file: string; keyring_dest?: string }>
  }
  const packages = legacy.packages ?? []
  const sources = legacy.sources ?? []
  if (packages.length === 0 && sources.length === 0) {
    return { capability: 'apt', action: 'skipped', detail: '구 manifest에 apt 항목 없음' }
  }

  let nKeyrings = 0
  const newSources = sources.map((s) => {
    const srcFile = path.join(legacyFilesDir(c.legacyRepoPath), s.file)
    const dstFile = path.join(c.ctx.manifestDir, 'packages', 'apt', 'sources', s.name)
    copyFileIfNeeded(c.dryRun, srcFile, dstFile)
    const keyringDest = s.keyring_dest ?? ''
    if (keyringDest) {
      const keyringBasename = path.basename(keyringDest)
      const srcKeyring = path.join(
        legacyFilesDir(c.legacyRepoPath),
        'apt',
        'keyrings',
        keyringBasename
      )
      const dstKeyring = path.join(
        c.ctx.manifestDir,
        'packages',
        'apt',
        'keyrings',
        keyringBasename
      )
      if (copyFileIfNeeded(c.dryRun, srcKeyring, dstKeyring)) nKeyrings += 1
    }
    return {
      name: s.name,
      file: `packages/apt/sources/${s.name}`,
      keyringDest
    }
  })

  if (!c.dryRun) {
    const doc = readCommonLayer(c.ctx, PACKAGES_LAYER)
    writeManifestFile(commonLayerPath(c.ctx, PACKAGES_LAYER), {
      ...doc,
      apt: { packages, ...(newSources.length > 0 ? { sources: newSources } : {}) }
    })
  }
  return {
    capability: 'apt',
    action: 'migrated',
    detail: `packages ${packages.length}개, sources ${sources.length}개, keyrings ${nKeyrings}개`
  }
}

function migrateSnap(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'snap')) as {
    snap?: Array<{ name: string }>
  }
  const items = legacy.snap ?? []
  return {
    capability: 'snap',
    action: 'reported-only',
    detail:
      items.length === 0
        ? '구 manifest에 snap 항목 없음'
        : `${items.length}개(${items.map((s) => s.name).join(', ')}) -- 정책 §7: snap은 동기화 대상이 아니라 변환하지 않음(검출 전용)`
  }
}

function migrateFlatpak(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'flatpak')) as {
    remote?: Array<{ name: string; url: string }>
    app?: Array<{ application: string; origin: string; installation: string }>
  }
  const remotes = legacy.remote ?? []
  const apps = legacy.app ?? []
  if (remotes.length === 0 && apps.length === 0) {
    return { capability: 'flatpak', action: 'skipped', detail: '구 manifest에 flatpak 항목 없음' }
  }
  if (!c.dryRun) {
    const doc = readCommonLayer(c.ctx, PACKAGES_LAYER)
    writeManifestFile(commonLayerPath(c.ctx, PACKAGES_LAYER), {
      ...doc,
      flatpak: {
        ...(remotes.length > 0 ? { remote: remotes } : {}),
        ...(apps.length > 0 ? { app: apps } : {})
      }
    })
  }
  return {
    capability: 'flatpak',
    action: 'migrated',
    detail: `remotes ${remotes.length}개, apps ${apps.length}개 (권한 오버라이드는 P2c 신규 기능이라 구 manifest에 없음 -- 새 capture가 채운다)`
  }
}

function migrateSettings(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'dconf')) as {
    path?: Array<{ path: string; file: string }>
  }
  const entries = legacy.path ?? []
  if (entries.length === 0) {
    return { capability: 'settings', action: 'skipped', detail: '구 manifest에 dconf 항목 없음' }
  }
  const newEntries = entries.map((e) => {
    const slug = path.basename(e.file, '.ini')
    const src = path.join(legacyFilesDir(c.legacyRepoPath), e.file)
    const dst = path.join(c.ctx.manifestDir, 'settings', 'dconf', `${slug}.ini`)
    copyFileIfNeeded(c.dryRun, src, dst)
    return { path: e.path, file: `settings/dconf/${slug}.ini` }
  })
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, SETTINGS_LAYER), { path: newEntries })
  }
  return { capability: 'settings', action: 'migrated', detail: `dconf 경로 ${entries.length}개` }
}

function migrateServices(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'services')) as {
    unit?: Array<{ name: string; file: string; enabled: boolean }>
  }
  const units = legacy.unit ?? []
  if (units.length === 0) {
    return { capability: 'services', action: 'skipped', detail: '구 manifest에 유닛 없음' }
  }
  const newUnits = units.map((u) => {
    const src = path.join(legacyFilesDir(c.legacyRepoPath), u.file)
    const dst = path.join(c.ctx.manifestDir, 'services', 'systemd-user', u.name)
    copyFileIfNeeded(c.dryRun, src, dst)
    return { name: u.name, file: `services/systemd-user/${u.name}`, enabled: u.enabled }
  })
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, SERVICES_LAYER), { unit: newUnits })
  }
  return { capability: 'services', action: 'migrated', detail: `유닛 ${units.length}개` }
}

function migrateScheduled(c: Ctx): LegacyMigrationItem {
  const src = path.join(legacyFilesDir(c.legacyRepoPath), 'crontab.txt')
  if (!fs.existsSync(src)) {
    return { capability: 'scheduled', action: 'skipped', detail: '구 crontab.txt 없음' }
  }
  const dst = path.join(c.ctx.manifestDir, SCHEDULED_STORE_REL_PATH)
  copyFileIfNeeded(c.dryRun, src, dst)
  return {
    capability: 'scheduled',
    action: 'migrated',
    detail: 'crontab.txt 복사(파일 단위, 매니페스트 테이블 없음)'
  }
}

function migrateTools(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'tools')) as {
    packages?: string[]
    node?: { version: string; manager: string }
  }
  const packages = legacy.packages ?? []
  if (packages.length === 0 && !legacy.node) {
    return { capability: 'tools', action: 'skipped', detail: '구 manifest에 tools 항목 없음' }
  }
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, TOOLS_LAYER), {
      packages,
      ...(legacy.node ? { node: legacy.node } : {})
    })
  }
  return {
    capability: 'tools',
    action: 'migrated',
    detail: `packages ${packages.length}개${legacy.node ? `, node ${legacy.node.version}` : ''}`
  }
}

function migrateRepos(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'repos')) as {
    repo?: Array<{ path: string; url: string; branch: string }>
  }
  const repos = legacy.repo ?? []
  if (repos.length === 0) {
    return { capability: 'repos', action: 'skipped', detail: '구 manifest에 repo 없음' }
  }
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, REPOS_LAYER), { repo: repos })
  }
  return { capability: 'repos', action: 'migrated', detail: `repo ${repos.length}개` }
}

function migrateAppimage(c: Ctx): LegacyMigrationItem {
  const legacy = readLegacyToml(legacyCommonPath(c.legacyRepoPath, 'appimage')) as {
    app?: Array<{ name: string; url_template?: string; version?: string }>
  }
  const apps = legacy.app ?? []
  if (apps.length === 0) {
    return { capability: 'appimage', action: 'skipped', detail: '구 manifest에 appimage 항목 없음' }
  }
  const names = apps.map((a) => a.name).join(', ')
  return {
    capability: 'appimage',
    action: 'reported-only',
    detail: `${apps.length}개(${names}) -- 구 url_template 모델은 T3(Gear Lever desktop_id 기반)와 구조가 달라 자동 변환 불가. Gear Lever로 수동 통합 후 새 capture로 채우세요.`
  }
}

function migrateChecksLayer(
  c: Ctx,
  tomlPath: string,
  target: string,
  label: string
): LegacyMigrationItem {
  const legacy = readLegacyToml(tomlPath) as {
    check?: Array<{ name: string; type: string; target: string; hint?: string }>
  }
  const checks = legacy.check ?? []
  if (checks.length === 0) {
    return { capability: label, action: 'skipped', detail: '구 manifest에 check 없음' }
  }
  if (!c.dryRun) {
    writeManifestFile(target, { check: checks })
  }
  return { capability: label, action: 'migrated', detail: `check ${checks.length}개` }
}

function migrateIgnore(c: Ctx): LegacyMigrationItem {
  const legacyPath = legacyCommonPath(c.legacyRepoPath, 'ignore')
  const legacy = readLegacyToml(legacyPath)
  if (Object.keys(legacy).length === 0) {
    return { capability: 'ignore', action: 'skipped', detail: '구 ignore.toml 없음/비어있음' }
  }
  // 스키마가 두 repo에서 구조적으로 동일하다({capability: {kind: string[]}}) --
  // capability/kind 이름까지 실측 일치(apt/packages,sources · snap/packages ·
  // flatpak/apps · repos/paths · tools/packages · checks/names) 하므로
  // 재작성 없이 그대로 옮긴다.
  if (!c.dryRun) {
    writeManifestFile(commonLayerPath(c.ctx, IGNORE_LAYER), legacy)
  }
  return {
    capability: 'ignore',
    action: 'migrated',
    detail: `capability ${Object.keys(legacy).length}개 (스키마 동일 -- 그대로 복사)`
  }
}

/**
 * host 오버레이 -- 구 repo `manifest/hosts/<host>/*.toml`을 새
 * `<manifestDir>/hosts/<host>/*.toml`로 옮긴다. **호스트 디렉터리 이름은
 * 그대로 보존**한다(새 machineId로의 리네임은 사용자 판단 — 온보딩 위저드가
 * 새 머신 이름을 이 마이그레이션과 별개로 정하므로 자동 매핑하면 오히려
 * 위험하다).
 */
function migrateHostOverlays(c: Ctx): LegacyMigrationItem {
  const hosts = listLegacyHosts(c.legacyRepoPath)
  if (hosts.length === 0) {
    return { capability: 'hosts', action: 'skipped', detail: '구 manifest에 host 오버레이 없음' }
  }
  let totalFiles = 0
  for (const host of hosts) {
    const hostDir = path.join(legacyHostsDir(c.legacyRepoPath), host)
    for (const file of fs.readdirSync(hostDir)) {
      if (!file.endsWith('.toml')) continue
      const layer = file.replace(/\.toml$/, '')
      const doc = readLegacyToml(path.join(hostDir, file))
      if (!c.dryRun) {
        writeManifestFile(hostLayerPath({ ...c.ctx, machineId: host }, layer), doc)
      }
      totalFiles += 1
    }
  }
  return {
    capability: 'hosts',
    action: 'migrated',
    detail: `호스트 ${hosts.length}개(${hosts.join(', ')}), 레이어 파일 ${totalFiles}개 -- 디렉터리 이름 그대로 보존`
  }
}

export async function migrateLegacyManifest(
  ctx: RigsyncContext,
  legacyRepoPath: string,
  options: MigrateLegacyOptions
): Promise<LegacyMigrationSummary> {
  const warnings: string[] = []
  if (!fs.existsSync(path.join(legacyRepoPath, 'manifest'))) {
    return {
      dryRun: options.dryRun,
      legacyRepoPath,
      items: [],
      warnings: [
        `${legacyRepoPath}/manifest 디렉터리가 없음 -- 구 rigsync repo 경로가 맞는지 확인하세요`
      ]
    }
  }

  const c: Ctx = { ctx, legacyRepoPath, dryRun: options.dryRun }
  const items: LegacyMigrationItem[] = [
    migrateDotfiles(c),
    migrateApt(c),
    migrateSnap(c),
    migrateFlatpak(c),
    migrateSettings(c),
    migrateServices(c),
    migrateScheduled(c),
    migrateTools(c),
    migrateRepos(c),
    migrateAppimage(c),
    migrateChecksLayer(
      c,
      legacyCommonPath(legacyRepoPath, 'checks'),
      commonLayerPath(ctx, CHECKS_LAYER),
      'checks'
    ),
    migrateIgnore(c),
    migrateHostOverlays(c)
  ]

  return { dryRun: options.dryRun, legacyRepoPath, items, warnings }
}

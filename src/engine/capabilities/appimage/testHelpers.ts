/**
 * appimage 테스트 전용 fake provider — Vitest include 패턴에 안 걸리므로
 * 테스트 파일이 아니다. **실제 flatpak/gearlever 호출·GitHub API·다운로드는
 * 여기 어디에도 없다** (P2c 검증 기준 — "gearlever provider는 실제 CLI 호출
 * 없이 fake로 테스트").
 */
import type {
  AppimageSystemCheckProvider,
  AssetResolver,
  DownloadResult,
  Downloader,
  GearLeverAppConfig,
  GearLeverCommandResult,
  GearLeverInstalledRow,
  GearLeverProvider,
  ReleaseAsset
} from './providerTypes'
import { gearleverConfigHash } from './ini'
import type { UpdateManagerModel } from './types'

export interface FakeGearLeverProviderOptions {
  readonly available?: boolean
  readonly version?: string | null
  readonly installed?: readonly GearLeverInstalledRow[]
  /** path -> config (테스트가 md5 해시를 직접 계산할 필요 없게, path 그대로 키로 준다). */
  readonly configsByPath?: Readonly<Record<string, GearLeverAppConfig>>
  readonly integrateResult?: GearLeverCommandResult
  readonly setUpdateSourceResult?: GearLeverCommandResult
}

export interface FakeGearLeverProvider extends GearLeverProvider {
  readonly integrateCalls: string[]
  readonly setUpdateSourceCalls: Array<{
    path: string
    manager: UpdateManagerModel
    params: Record<string, string>
  }>
}

export function makeFakeGearLeverProvider(
  opts: FakeGearLeverProviderOptions = {}
): FakeGearLeverProvider {
  const integrateCalls: string[] = []
  const setUpdateSourceCalls: Array<{
    path: string
    manager: UpdateManagerModel
    params: Record<string, string>
  }> = []

  return {
    isAvailable: () => opts.available ?? true,
    version: () => opts.version ?? '4.6.2',
    listInstalled: () => [...(opts.installed ?? [])],
    readAppConfig: (appImagePath) => opts.configsByPath?.[appImagePath] ?? null,
    integrate: (appImagePath) => {
      integrateCalls.push(appImagePath)
      return opts.integrateResult ?? { ok: true, output: '' }
    },
    setUpdateSource: (appImagePath, manager, params) => {
      setUpdateSourceCalls.push({ path: appImagePath, manager, params: { ...params } })
      return opts.setUpdateSourceResult ?? { ok: true, output: '' }
    },
    integrateCalls,
    setUpdateSourceCalls
  }
}

/** gearlever.conf 실측 형식 그대로 생성한다 — 테스트가 직접 md5를 안 다뤄도 되게. */
export function fakeGearleverConfigText(
  entries: ReadonlyArray<{
    path: string
    repo: string
    repoFilename: string
    manager: string
    name?: string
  }>
): string {
  const lines: string[] = ['[DEFAULT]', 'fetch-updates-in-background = no', '']
  for (const e of entries) {
    const hash = gearleverConfigHash(e.path)
    lines.push(`[app.${hash}]`)
    lines.push(`name = ${e.name ?? e.repoFilename}`)
    lines.push(`file_path = ${e.path}`)
    lines.push('')
    lines.push(`[app.${hash}.update_manager]`)
    lines.push(`repo = ${e.repo}`)
    lines.push(`repo_filename = ${e.repoFilename}`)
    lines.push('allow_prereleases = False')
    lines.push(`manager = ${e.manager}`)
    lines.push('')
  }
  return lines.join('\n')
}

export interface FakeAssetResolverOptions {
  readonly assetsByCoordinate?: Readonly<Record<string, ReleaseAsset | null>>
}

export function makeFakeAssetResolver(opts: FakeAssetResolverOptions = {}): AssetResolver {
  return {
    resolveAsset: (coordinate) => Promise.resolve(opts.assetsByCoordinate?.[coordinate] ?? null)
  }
}

export interface FakeDownloaderOptions {
  readonly result?: DownloadResult
}

export interface FakeDownloader extends Downloader {
  readonly calls: Array<{ url: string; destPath: string }>
}

export function makeFakeDownloader(opts: FakeDownloaderOptions = {}): FakeDownloader {
  const calls: Array<{ url: string; destPath: string }> = []
  return {
    download: (url, destPath) => {
      calls.push({ url, destPath })
      return Promise.resolve(opts.result ?? { ok: true, detail: 'ok' })
    },
    calls
  }
}

export function makeFakeAppimageSystemCheckProvider(
  installedPackages: readonly string[] = []
): AppimageSystemCheckProvider {
  const set = new Set(installedPackages)
  return {
    isPackageInstalled: (debPackageName) => set.has(debPackageName)
  }
}

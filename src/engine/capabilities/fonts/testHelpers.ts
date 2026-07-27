/**
 * fonts 테스트 전용 fake provider — Vitest include 패턴에 안 걸리므로 테스트
 * 파일이 아니다. **실제 네트워크 다운로드·zip 라이브러리·fc-cache 실행은
 * 여기 어디에도 없다** (검증 기준 — "시스템 호출·네트워크는 provider
 * 인터페이스 뒤에서 fake 주입으로 테스트").
 */
import type {
  FontAssetResolver,
  FontDownloader,
  FontDownloadResult,
  FontReleaseAsset,
  FontsSystemCommandResult,
  FontsSystemProvider,
  ZipExtractor,
  ZipExtractResult
} from './providerTypes'

export interface FakeFontAssetResolverOptions {
  readonly assetsByCoordinate?: Readonly<Record<string, FontReleaseAsset | null>>
}

export function makeFakeFontAssetResolver(
  opts: FakeFontAssetResolverOptions = {}
): FontAssetResolver {
  return {
    resolveAsset: (coordinate) => Promise.resolve(opts.assetsByCoordinate?.[coordinate] ?? null)
  }
}

export interface FakeFontDownloaderOptions {
  readonly result?: FontDownloadResult
}

export interface FakeFontDownloader extends FontDownloader {
  readonly calls: Array<{ url: string; destPath: string }>
}

export function makeFakeFontDownloader(opts: FakeFontDownloaderOptions = {}): FakeFontDownloader {
  const calls: Array<{ url: string; destPath: string }> = []
  return {
    download: (url, destPath) => {
      calls.push({ url, destPath })
      return Promise.resolve(opts.result ?? { ok: true, detail: 'ok' })
    },
    calls
  }
}

export interface FakeZipExtractorOptions {
  readonly result?: ZipExtractResult
}

export interface FakeZipExtractor extends ZipExtractor {
  readonly calls: Array<{ zipPath: string; destDir: string }>
}

export function makeFakeZipExtractor(opts: FakeZipExtractorOptions = {}): FakeZipExtractor {
  const calls: Array<{ zipPath: string; destDir: string }> = []
  return {
    extract: (zipPath, destDir) => {
      calls.push({ zipPath, destDir })
      return opts.result ?? { ok: true, extractedPaths: [] }
    },
    calls
  }
}

export interface FakeFontsSystemProviderOptions {
  readonly fcCacheAvailable?: boolean
  readonly fcListAvailable?: boolean
  readonly runFcCacheResult?: FontsSystemCommandResult
}

export interface FakeFontsSystemProvider extends FontsSystemProvider {
  readonly runFcCacheCalls: FontsSystemCommandResult[]
}

export function makeFakeFontsSystemProvider(
  opts: FakeFontsSystemProviderOptions = {}
): FakeFontsSystemProvider {
  const runFcCacheCalls: FontsSystemCommandResult[] = []
  return {
    fcCacheAvailable: () => opts.fcCacheAvailable ?? true,
    fcListAvailable: () => opts.fcListAvailable ?? true,
    // v0.1.19: MaybePromise 계약을 실제로 exercise하도록 Promise.resolve로
    // 감싼다(await 누락 회귀 교차 검증).
    runFcCache: () => {
      const result = opts.runFcCacheResult ?? { ok: true, output: '' }
      runFcCacheCalls.push(result)
      return Promise.resolve(result)
    },
    runFcCacheCalls
  }
}

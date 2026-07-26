/**
 * binaries 테스트 전용 fake provider — Vitest include 패턴에 안 걸리므로
 * 테스트 파일이 아니다. **실제 네트워크 다운로드·tar/zip 실행·바이너리 실행은
 * 여기 어디에도 없다** (검증 기준 — "시스템 호출·네트워크는 provider
 * 인터페이스 뒤에서 fake 주입으로 테스트"). `makeWritingFakeBinaryDownloader`만
 * 예외적으로 로컬 fs에 더미 바이트를 쓴다(네트워크 없음 — single-binary
 * 소스의 copyFileSync 경로를 태우는 테스트를 위한 픽스처 사실성).
 */
import fs from 'node:fs'
import type {
  BinariesCommandResult,
  BinariesSystemProvider,
  BinaryAssetResolver,
  BinaryDownloader,
  BinaryDownloadResult,
  BinaryReleaseAsset,
  BinaryZipExtractor,
  BinaryZipExtractResult,
  TarExtractor,
  TarExtractResult
} from './providerTypes'

export interface FakeBinaryAssetResolverOptions {
  readonly assetsByCoordinate?: Readonly<Record<string, BinaryReleaseAsset | null>>
}

export function makeFakeBinaryAssetResolver(
  opts: FakeBinaryAssetResolverOptions = {}
): BinaryAssetResolver {
  return {
    resolveAsset: (coordinate) => Promise.resolve(opts.assetsByCoordinate?.[coordinate] ?? null)
  }
}

export interface FakeBinaryDownloaderOptions {
  readonly result?: BinaryDownloadResult
}

export interface FakeBinaryDownloader extends BinaryDownloader {
  readonly calls: Array<{ url: string; destPath: string }>
}

export function makeFakeBinaryDownloader(
  opts: FakeBinaryDownloaderOptions = {}
): FakeBinaryDownloader {
  const calls: Array<{ url: string; destPath: string }> = []
  return {
    download: (url, destPath) => {
      calls.push({ url, destPath })
      return Promise.resolve(opts.result ?? { ok: true, detail: 'ok' })
    },
    calls
  }
}

/**
 * `single-binary` 소스는 plan.ts가 다운로드한 임시 파일을 `fs.copyFileSync`로
 * destDir에 복사한다(tar.gz/tar.bz2/zip처럼 extractor가 결과 경로를 만들어주는
 * 것과 달리, single-binary는 다운로드 결과 자체가 최종 산출물이라 실제로 그
 * 자리에 파일이 있어야 한다). `makeFakeBinaryDownloader`는 부작용 없이 호출만
 * 기록하므로 이 경로를 태우는 테스트(단일 바이너리 install/backup 시나리오)는
 * 이 쓰기 버전을 써야 한다 — 안 그러면 `copyFileSync`가 ENOENT로 던진다.
 */
export function makeWritingFakeBinaryDownloader(
  opts: FakeBinaryDownloaderOptions = {}
): FakeBinaryDownloader {
  const calls: Array<{ url: string; destPath: string }> = []
  return {
    download: (url, destPath) => {
      calls.push({ url, destPath })
      const result = opts.result ?? { ok: true, detail: 'ok' }
      if (result.ok) fs.writeFileSync(destPath, 'fake-binary-bytes')
      return Promise.resolve(result)
    },
    calls
  }
}

export interface FakeBinaryZipExtractorOptions {
  readonly result?: BinaryZipExtractResult
}

export interface FakeBinaryZipExtractor extends BinaryZipExtractor {
  readonly calls: Array<{ zipPath: string; destDir: string }>
}

export function makeFakeBinaryZipExtractor(
  opts: FakeBinaryZipExtractorOptions = {}
): FakeBinaryZipExtractor {
  const calls: Array<{ zipPath: string; destDir: string }> = []
  return {
    extract: (zipPath, destDir) => {
      calls.push({ zipPath, destDir })
      return opts.result ?? { ok: true, extractedPaths: [] }
    },
    calls
  }
}

export interface FakeTarExtractorOptions {
  readonly gzResult?: TarExtractResult
  readonly bz2Result?: TarExtractResult
}

export interface FakeTarExtractor extends TarExtractor {
  readonly gzCalls: Array<{ tarPath: string; destDir: string }>
  readonly bz2Calls: Array<{ tarPath: string; destDir: string }>
}

export function makeFakeTarExtractor(opts: FakeTarExtractorOptions = {}): FakeTarExtractor {
  const gzCalls: Array<{ tarPath: string; destDir: string }> = []
  const bz2Calls: Array<{ tarPath: string; destDir: string }> = []
  return {
    extractGz: (tarPath, destDir) => {
      gzCalls.push({ tarPath, destDir })
      return opts.gzResult ?? { ok: true, extractedPaths: [] }
    },
    extractBz2: (tarPath, destDir) => {
      bz2Calls.push({ tarPath, destDir })
      return opts.bz2Result ?? { ok: true, extractedPaths: [] }
    },
    gzCalls,
    bz2Calls
  }
}

export interface FakeBinariesSystemProviderOptions {
  readonly resultsByBinaryPath?: Readonly<Record<string, BinariesCommandResult>>
  readonly defaultResult?: BinariesCommandResult
}

export interface FakeBinariesSystemProvider extends BinariesSystemProvider {
  readonly calls: Array<{ binaryPath: string; versionArgs: readonly string[] }>
}

export function makeFakeBinariesSystemProvider(
  opts: FakeBinariesSystemProviderOptions = {}
): FakeBinariesSystemProvider {
  const calls: Array<{ binaryPath: string; versionArgs: readonly string[] }> = []
  return {
    runVersionCommand: (binaryPath, versionArgs) => {
      calls.push({ binaryPath, versionArgs })
      return (
        opts.resultsByBinaryPath?.[binaryPath] ?? opts.defaultResult ?? { ok: true, output: '' }
      )
    },
    calls
  }
}

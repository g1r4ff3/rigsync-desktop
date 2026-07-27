/**
 * binaries capability가 외부 시스템(네트워크·압축 해제·버전 확인 실행)을
 * 건드리는 유일한 통로 — fonts capability와 동일 원칙: 실제 구현은
 * `src/engine/providers/linux/`, 테스트는 여기 인터페이스를 fake로 주입한다.
 * capture/diff/plan은 항상 이 인터페이스들 뒤에서만 시스템에 접근한다.
 *
 * perf 3라운드(providers 비동기화): `runVersionCommand`는 실제 바이너리를
 * spawn하므로 `MaybePromise<T>`(`src/engine/async.ts`)를 돌려준다.
 */
import type { MaybePromise } from '../../async'

export interface BinaryReleaseAsset {
  readonly name: string
  readonly downloadUrl: string
}

/**
 * 좌표(예: "astral-sh/uv")에서 `assetPattern`(와일드카드 `*` 지원)에 맞는
 * 릴리스 asset을 찾는다 — fonts의 `FontAssetResolver`와 동형.
 */
export interface BinaryAssetResolver {
  resolveAsset(
    coordinate: string,
    assetPattern: string,
    tag?: string | null
  ): Promise<BinaryReleaseAsset | null>
}

export interface BinaryDownloadResult {
  readonly ok: boolean
  readonly detail: string
}

export interface BinaryDownloader {
  download(url: string, destPath: string): Promise<BinaryDownloadResult>
}

export interface BinaryZipExtractResult {
  readonly ok: boolean
  /** 추출된 파일의 절대경로 목록 (성공 시). */
  readonly extractedPaths: readonly string[]
  readonly detail?: string
}

/**
 * zip 압축 해제 — fonts capability의 `ZipExtractor`와 동형(구조적으로 재사용
 * 가능: 실제 구현은 `providers/linux/index.ts`가 fonts와 같은 `AdmZipExtractor`
 * 인스턴스를 이 타입으로 다시 assign해 재사용한다 — appimage↔fonts가 이미
 * Downloader를 이렇게 공유하는 것과 같은 패턴).
 */
export interface BinaryZipExtractor {
  extract(
    zipPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): BinaryZipExtractResult
}

export interface TarExtractResult {
  readonly ok: boolean
  /** 추출된 파일의 절대경로 목록 (성공 시). */
  readonly extractedPaths: readonly string[]
  readonly detail?: string
}

/**
 * tar.gz/tar.bz2 압축 해제 — uv 같은 github-release 소스는 asset이 tar.gz라
 * 압축 해제가 필요하다. 실제 구현(`providers/linux/tarExtractor.ts`)은 npm
 * 의존성을 새로 추가하지 않고 시스템 `tar` 명령을 shell out한다(다른
 * 에이전트가 package.json을 동시에 작업 중이라 이번 라운드는 새 런타임
 * 의존성을 넣을 수 없다 — apt/gearlever provider와 동일하게 "실제 구현은
 * 시스템 CLI 호출" 원칙을 그대로 따른 것뿐이라 부자연스럽지 않다).
 */
export interface TarExtractor {
  /** tarPath(.tar.gz) 안에서 `filter(entryFileName)`이 true인 엔트리만 destDir에 추출한다. */
  extractGz(
    tarPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): MaybePromise<TarExtractResult>
  /** tarPath(.tar.bz2) 안에서 `filter(entryFileName)`이 true인 엔트리만 destDir에 추출한다. */
  extractBz2(
    tarPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): MaybePromise<TarExtractResult>
}

export interface BinariesCommandResult {
  readonly ok: boolean
  readonly output: string
}

/** 설치된 실행파일의 버전 확인 — diff의 pinMismatch 판정에 쓰인다. */
export interface BinariesSystemProvider {
  /** binaryPath를 versionArgs로 실행해 결합 출력(stdout+stderr)을 돌려준다. 실행 자체가 실패하면 ok=false. */
  runVersionCommand(
    binaryPath: string,
    versionArgs: readonly string[]
  ): MaybePromise<BinariesCommandResult>
}

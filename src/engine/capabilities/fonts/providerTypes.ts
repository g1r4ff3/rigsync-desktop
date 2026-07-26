/**
 * fonts capability가 외부 시스템(네트워크·압축 해제·fc-cache)을 건드리는
 * 유일한 통로 — 다른 capability들과 동일한 원칙(P2c 결정 ⑥): 실제 구현은
 * `src/engine/providers/linux/`, 테스트는 여기 인터페이스를 fake로 주입한다.
 * 폰트 디렉터리 스캔 자체는 provider가 아니다(`scan.ts` — dotfiles와 동일하게
 * ctx.homeDir 기준 순수 fs라 fake가 필요 없다).
 */

export interface FontReleaseAsset {
  readonly name: string
  readonly downloadUrl: string
}

/**
 * 좌표(예: "naver/d2codingfont")에서 `assetPattern`(와일드카드 `*` 지원)에
 * 맞는 릴리스 asset을 찾는다. appimage의 `AssetResolver`와 달리 정확 일치가
 * 아니라 패턴 매칭이다 — release asset 파일명이 버전을 포함해 매번 바뀌기
 * 때문(예: "D2Coding-Ver1.3.3-20260725.zip").
 */
export interface FontAssetResolver {
  resolveAsset(
    coordinate: string,
    assetPattern: string,
    tag?: string | null
  ): Promise<FontReleaseAsset | null>
}

export interface FontDownloadResult {
  readonly ok: boolean
  readonly detail: string
}

export interface FontDownloader {
  download(url: string, destPath: string): Promise<FontDownloadResult>
}

export interface ZipExtractResult {
  readonly ok: boolean
  /** 추출된 파일의 절대경로 목록 (성공 시). */
  readonly extractedPaths: readonly string[]
  readonly detail?: string
}

/**
 * zip 압축 해제 — D2Coding 같은 github-release 소스는 asset이 zip이라
 * 압축 해제가 필요하다(appimage의 다운로더엔 없던 신규 기능). 실제 구현은
 * `providers/linux/zipExtractor.ts`(adm-zip 사용).
 */
export interface ZipExtractor {
  /** zipPath 안에서 `filter(entryFileName)`이 true인 엔트리만 destDir에 추출한다. */
  extract(
    zipPath: string,
    destDir: string,
    filter: (entryName: string) => boolean
  ): ZipExtractResult
}

export interface FontsSystemCommandResult {
  readonly ok: boolean
  readonly output: string
}

/** fc-cache/fc-list 가용성 + 실행 — doctor 체크 ③ + apply 마지막 단계. */
export interface FontsSystemProvider {
  fcCacheAvailable(): boolean
  fcListAvailable(): boolean
  runFcCache(): FontsSystemCommandResult
}

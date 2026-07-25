/**
 * appimage(T3) capability가 시스템/외부 API를 읽고 쓰는 유일한 통로 —
 * `flatpak run it.mijorus.gearlever` 호출, `gearlever.conf` 파일 읽기, GitHub
 * 릴리스 조회, asset 다운로드를 전부 인터페이스 뒤에 격리한다(P2c 결정 —
 * "gearlever provider는 실제 CLI 호출 없이 fake로 테스트"). 실제 구현은
 * `src/engine/providers/linux/gearlever.ts`(dev 전용).
 */
import type { UpdateManagerModel } from './types'

/** `--list-installed --json`의 `installed[]` 엔트리 하나 (FORWARD.md §7 실측 스키마). */
export interface GearLeverInstalledRow {
  /** JSON 원문 name — **버전이 섞여 있다**("tev (2.13.1)"). 매니페스트 키로 쓰지 않는다. */
  readonly name: string
  /** 로컬 AppImage 경로 — 머신별로 다르다. gearlever.conf 조인 키(md5 해시)로만 쓴다. */
  readonly path: string
  readonly desktopId: string
  readonly currentVersion: string | null
  readonly availableVersion: string | null
  readonly downloadSize: number | null
  readonly manager: string
  readonly embeddedSource: boolean
  readonly running: boolean
}

/** `gearlever.conf`의 `[app.<hash>.update_manager]` 섹션 — 좌표의 유일한 출처. */
export interface GearLeverUpdateManagerConfig {
  readonly repo?: string
  readonly repoFilename?: string
  readonly manager?: string
  readonly allowPrereleases?: boolean
}

export interface GearLeverAppConfig {
  readonly name?: string
  readonly filePath?: string
  readonly updateManager?: GearLeverUpdateManagerConfig
}

export interface GearLeverCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface GearLeverProvider {
  isAvailable(): boolean
  /** 설치된 Gear Lever flatpak 버전 문자열(예: "4.6.2"), 확인 불가하면 null. */
  version(): string | null
  listInstalled(): GearLeverInstalledRow[]
  /**
   * `gearlever.conf`를 읽기 전용으로 파싱해 이 AppImage 경로에 대응하는 설정을
   * 찾는다(조인 키 = md5(path), FORWARD.md §7 실측). 못 찾으면 null.
   */
  readAppConfig(appImagePath: string): GearLeverAppConfig | null
  /** `--integrate <path> --yes`. */
  integrate(appImagePath: string): GearLeverCommandResult
  /** `--set-update-source <path> --manager <model> key=value…`. */
  setUpdateSource(
    appImagePath: string,
    manager: UpdateManagerModel,
    params: Readonly<Record<string, string>>
  ): GearLeverCommandResult
}

export interface ReleaseAsset {
  readonly name: string
  readonly downloadUrl: string
}

/**
 * 좌표(예: "Tom94/tev")에서 릴리스 asset을 해석한다 — 실제 구현은 GitHub REST
 * API를 부른다. `tag`가 없으면(null/undefined) 최신 릴리스, 있으면 그 태그의
 * 릴리스에서 찾는다(pin 지원).
 */
export interface AssetResolver {
  resolveAsset(
    coordinate: string,
    repoFilename: string,
    tag?: string | null
  ): Promise<ReleaseAsset | null>
}

export interface DownloadResult {
  readonly ok: boolean
  readonly detail: string
}

export interface Downloader {
  download(url: string, destPath: string): Promise<DownloadResult>
}

/** libfuse2t64/AppImageLauncher 같은 dpkg 패키지 존재 여부 조회 (doctor성 선행 조건). */
export interface AppimageSystemCheckProvider {
  isPackageInstalled(debPackageName: string): boolean
}

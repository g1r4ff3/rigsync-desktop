/**
 * packages manifest 스키마 + capture/diff 리포트 타입. 레이아웃은 P2a 확정
 * 결정 ①: `common/packages.toml` 한 파일에 provider별 테이블
 * (`[apt]`/`[snap]`/`[flatpak]`) — 구 repo는 apt.toml/snap.toml/flatpak.toml로
 * 파일을 나눴지만(레이어당 1파일), 이 repo는 그린필드라 capability당 1파일로
 * 통합한다(구 manifest 마이그레이션은 이후 phase 몫).
 */

export interface AptSourceEntry {
  readonly name: string
  /** manifestDir 기준 상대 스토어 경로 (예: "packages/apt/sources/<name>"). */
  readonly file: string
  /** Signed-By가 가리키는 절대 키링 경로. 없으면 빈 문자열. */
  readonly keyringDest: string
}

export interface AptSection {
  readonly packages?: readonly string[]
  readonly sources?: readonly AptSourceEntry[]
}

export interface SnapEntry {
  readonly name: string
  readonly classic: boolean
}

export interface SnapSection {
  readonly snap?: readonly SnapEntry[]
}

export interface FlatpakRemoteEntry {
  readonly name: string
  readonly url: string
}

export interface FlatpakAppEntry {
  readonly application: string
  readonly origin: string
  readonly installation: string
}

export interface FlatpakSection {
  readonly remote?: readonly FlatpakRemoteEntry[]
  readonly app?: readonly FlatpakAppEntry[]
}

export interface PackagesManifest {
  readonly apt?: AptSection
  readonly snap?: SnapSection
  readonly flatpak?: FlatpakSection
}

export interface AptCaptureReport {
  readonly skipped: boolean
  readonly manualInstalled: number
  readonly packagesInManifest: number
  readonly packagesAdded: number
  readonly sourcesCaptured: number
  readonly keyringsCaptured: number
  readonly notes: readonly string[]
}

export interface SnapCaptureReport {
  readonly skipped: boolean
  readonly captured: number
  readonly added: number
}

export interface FlatpakCaptureReport {
  readonly skipped: boolean
  readonly remotes: number
  readonly apps: number
  readonly addedRemotes: number
  readonly addedApps: number
}

export interface PackagesCaptureReport {
  readonly capability: 'packages'
  readonly apt: AptCaptureReport
  readonly snap: SnapCaptureReport
  readonly flatpak: FlatpakCaptureReport
}

export interface AptDiffReport {
  readonly skipped: boolean
  readonly toInstall: readonly string[]
  /** 설치돼 있는데 manifest엔 없는 패키지 (unmanaged 후보 — 불변식 ⑤: 보고만). */
  readonly uncaptured: readonly string[]
  readonly sourcesMissing: readonly string[]
  readonly sourcesContentChanged: readonly string[]
}

export interface SnapDiffReport {
  readonly skipped: boolean
  readonly toInstall: readonly SnapEntry[]
  readonly uncaptured: readonly string[]
}

export interface FlatpakDiffReport {
  readonly skipped: boolean
  readonly toAddRemotes: readonly FlatpakRemoteEntry[]
  readonly toInstall: readonly FlatpakAppEntry[]
  readonly uncaptured: readonly string[]
}

export interface PackagesDiffReport {
  readonly capability: 'packages'
  readonly apt: AptDiffReport
  readonly snap: SnapDiffReport
  readonly flatpak: FlatpakDiffReport
}

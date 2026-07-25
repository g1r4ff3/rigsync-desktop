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

/**
 * `~/.local/share/flatpak/overrides/<appId>` 권한 오버라이드 파일 — 정책 §3.2:
 * "이것 없이 앱만 복원하면 대상 머신에서 앱이 조용히 다르게 동작한다". 파일
 * 단위 동기화(dotfiles의 파일 스토어 메커니즘 재사용 — 새 코드 없이 같은
 * copy+backup 유틸을 그대로 부른다).
 */
export interface FlatpakOverrideEntry {
  readonly appId: string
  /** manifestDir 기준 상대 스토어 경로 (예: "packages/flatpak/overrides/<appId>"). */
  readonly storeFile: string
}

export interface FlatpakSection {
  readonly remote?: readonly FlatpakRemoteEntry[]
  readonly app?: readonly FlatpakAppEntry[]
  readonly overrides?: readonly FlatpakOverrideEntry[]
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
  readonly overridesCaptured: number
  readonly overridesAdded: number
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
  /** manifest엔 있는데 라이브 시스템엔 override 파일 자체가 없는 appId. */
  readonly overridesMissing: readonly string[]
  /** 라이브 override 파일 내용이 스토어와 다른 appId. */
  readonly overridesChanged: readonly string[]
}

export interface PackagesDiffReport {
  readonly capability: 'packages'
  readonly apt: AptDiffReport
  readonly snap: SnapDiffReport
  readonly flatpak: FlatpakDiffReport
}

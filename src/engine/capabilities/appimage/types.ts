/**
 * appimage(T3) manifest 스키마 + capture/diff 리포트 — FORWARD.md §7 실측
 * 반영. Gear Lever가 유일한 추적 능력 제공자라 매니페스트는 삼중항
 * (source·coordinate·repoFilename)만 있으면 재현 가능하다(정책 §3.3).
 */

/** Gear Lever의 update manager 모델명 — `--list-update-managers` 실측. */
export type UpdateManagerModel =
  | 'StaticFileUpdater'
  | 'GithubUpdater'
  | 'GitlabUpdater'
  | 'CodebergUpdater'
  | 'FTPUpdater'
  | 'ForgejoUpdater'

export interface AppimageEntry {
  /**
   * manifest 키. 값은 Gear Lever JSON의 `desktop_id`(예: "tev.desktop") —
   * **JSON의 `name` 필드는 쓰지 않는다**: 버전이 섞여 들어간다("tev (2.13.1)",
   * FORWARD.md §7 실측 함정).
   */
  readonly name: string
  readonly source: UpdateManagerModel
  /** 예: "Tom94/tev" (GitHub owner/repo). */
  readonly coordinate: string
  /** 예: "tev.appimage" — 릴리스 asset 파일명 매칭에 쓰인다. */
  readonly repoFilename: string
  /** null/undefined = 최신 추적. 문자열이면 그 버전에 고정. */
  readonly pin?: string | null
}

export interface AppimageCaptureReport {
  readonly skipped: boolean
  readonly capturedCount: number
  readonly added: number
  readonly notes: readonly string[]
}

export interface AppimageDiffReport {
  readonly skipped: boolean
  /** manifest엔 있는데 설치돼 있지 않은 엔트리 이름(desktop_id). */
  readonly toInstall: readonly string[]
  /** pin이 지정돼 있는데 설치된 버전과 다른 엔트리. */
  readonly pinMismatch: readonly { name: string; pinned: string; installed: string }[]
  /**
   * source가 GithubUpdater가 아닌 엔트리 — diff엔 나타나지만 apply는 자동
   * 설치를 지원하지 않는다(정책 §7 결정: "정직하게 skipped 처리").
   */
  readonly unsupportedSource: readonly string[]
  /** 설치는 돼 있는데 manifest엔 없는 것 — "동기화 항목" 화면의 unmanaged 후보. */
  readonly uncaptured: readonly string[]
}

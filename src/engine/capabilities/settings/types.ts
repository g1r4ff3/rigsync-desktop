/**
 * settings(dconf) 레이어 manifest 스키마 + capture/diff 리포트 타입. 구 repo
 * `capture_dconf`/`diff_dconf`/`plan_dconf`(rigsync.py:1479-1535) 행동을 옮긴 것
 * (코드 복사 아님) — `dconf dump <path>` 전문을 파일로 저장하고, 다음 capture 때
 * `path` 필드로 기존 항목을 찾아 갱신한다.
 */

export interface DconfPathEntry {
  readonly path: string
  /** manifestDir 기준 상대 스토어 경로 (예: "settings/dconf/org-gnome-desktop-wm-keybindings.ini"). */
  readonly file: string
}

export interface SettingsManifest {
  readonly path?: readonly DconfPathEntry[]
}

export interface SettingsCaptureReport {
  readonly skipped: boolean
  readonly written: number
  /** dump 결과가 빈 문자열이라 캡처하지 않은 경로 (구 repo `skipped_empty`). */
  readonly skippedEmpty: readonly string[]
}

export interface SettingsDiffReport {
  readonly skipped: boolean
  readonly contentChanged: readonly string[]
}

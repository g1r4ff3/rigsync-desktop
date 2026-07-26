/**
 * fonts capability manifest 스키마 + capture/diff 리포트 — 사용자 결정
 * (2026-07-26): 폰트는 바이너리를 동기화하지 않고(정책 §4와 동일 원칙) 좌표만
 * manifest에 선언한다("동기화 단위는 매니페스트" — FORWARD.md §3). 실기(이
 * 머신)에 수동 설치된 MesloLGS NF 4종 + D2Coding 2종이 이 스키마의 최초 대상.
 *
 * 소스 2종:
 * - static: 직접 파일 URL 목록(예: MesloLGS NF — 버전 개념이 없어 pin이 의미
 *   없다).
 * - github-release: 릴리스 asset(흔히 zip)에서 패턴 매칭으로 파일을 찾는다.
 *   D2Coding처럼 asset 파일명에 날짜/버전이 박혀 있어 **정확한 파일명을
 *   하드코딩할 수 없다** — `assetPattern`은 `*` 와일드카드를 지원하는 매칭
 *   패턴이다(appimage의 정확 일치 `repoFilename`과 달리 fonts는 zip 통째로
 *   받아 내부에서 폰트 파일만 추출하므로 패턴이 필요).
 */

export type FontSourceKind = 'static' | 'github-release'

export interface FontStaticSource {
  readonly kind: 'static'
  /** 직접 다운로드 가능한 파일 URL 목록. */
  readonly urls: readonly string[]
}

export interface FontGithubReleaseSource {
  readonly kind: 'github-release'
  /** "owner/repo" 형식 (예: "naver/d2codingfont"). */
  readonly coordinate: string
  /**
   * 릴리스 asset 파일명 매칭 패턴 — `*`는 임의 문자열 와일드카드(예:
   * "D2Coding-Ver*.zip"). asset이 zip이면 apply가 zip을 통째로 받아 안에서
   * 폰트 파일(.ttf/.otf/.ttc)만 추출한다.
   */
  readonly assetPattern: string
}

export type FontSource = FontStaticSource | FontGithubReleaseSource

export interface FontEntry {
  /** manifest 키 — 폰트 패밀리/식별자 (예: "MesloLGS NF", "D2Coding"). */
  readonly name: string
  readonly source: FontSource
  /**
   * 설치될 파일명 목록(디렉터리 없이 파일명만) — diff가 이 파일들이
   * `~/.local/share/fonts/`(하위 디렉터리 포함) 어딘가에 있는지로 판정한다.
   * capture는 실제로 발견한 파일명 그대로를 기록한다(하드코딩된 "이상적"
   * 목록이 아니다 — 특히 github-release 소스는 파일명 자체가 버전을
   * 담고 있어 실측이 유일한 진실이다).
   */
  readonly files: readonly string[]
  /**
   * 선택적 버전 고정. static 소스는 버전 개념이 없어 사실상 무의미하고,
   * github-release 소스에서만 의미가 있다(레지스트리의 `extractVersion`으로
   * 설치된 파일의 버전을 읽어 이 값과 비교 — diff의 pinMismatch).
   * capture는 이 값을 절대 자동 설정하지 않는다(appimage와 동일 원칙 —
   * 사용자가 수동으로 건 값만 재캡처 때 보존한다).
   */
  readonly pin?: string | null
}

export interface FontsCaptureReport {
  readonly capturedCount: number
  readonly added: number
  /** 알려진 레지스트리에 없어 manifest에 담지 못한 파일 등 -- 재현 불가 항목 보고. */
  readonly notes: readonly string[]
}

export interface FontsPinMismatch {
  readonly name: string
  readonly pinned: string
  readonly installedVersion: string
}

export interface FontsDiffReport {
  /** manifest에 선언됐지만 files 중 일부/전부가 설치되지 않은 폰트 이름. */
  readonly toInstall: readonly string[]
  /** pin이 설정돼 있고, 설치된 파일에서 추출한 버전이 pin과 다른 경우. */
  readonly pinMismatch: readonly FontsPinMismatch[]
  /** 레지스트리로 식별되지만 manifest엔 없는 폰트 이름 — Candidates 화면용. */
  readonly uncaptured: readonly string[]
}

/**
 * tools(nvm→node→npm 자동 설치 체인) 레이어 manifest 스키마 + capture/diff 리포트
 * 타입. 구 repo `capture_tools`/`diff_tools`/`plan_tools`(rigsync.py:1028-1120)
 * 행동을 옮긴 것(코드 복사 아님).
 */

export interface ToolsNodeSpec {
  readonly version: string
  readonly manager: 'nvm'
}

export interface ToolsManifest {
  readonly packages?: readonly string[]
  readonly node?: ToolsNodeSpec
}

export interface ToolsCaptureReport {
  readonly skipped: boolean
  readonly packagesInManifest: number
  readonly added: number
  readonly nodeVersion: string | null
  readonly note?: string
}

export interface ToolsDiffReport {
  readonly skipped: boolean
  readonly toInstall: readonly string[]
  /** null이면 node 자체는 손댈 게 없음. */
  readonly nodeToInstall: string | null
  readonly nvmMissing: boolean
  readonly note?: string
}

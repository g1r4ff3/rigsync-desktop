/**
 * pkexec 스크립트 마커 — 구 repo `gui.py`의 `_SUDO_MARKER_CMD`/`_SUDO_MARKER_FAIL`/
 * `_SUDO_MARKER_DONE` 이식(코드 복사 아님). 스크립트 stdout에 이 마커들을 echo해
 * `parseSudoScriptOutput`/`SudoStreamParser`가 명령별 상태를 되짚는다.
 */

export function markerCmd(index: number): string {
  return `===RIGSYNC CMD ${index}===`
}

export function markerFail(index: number): string {
  return `===RIGSYNC FAIL ${index}===`
}

export const MARKER_DONE = '===RIGSYNC DONE==='

export const MARKER_CMD_RE = /^===RIGSYNC CMD (\d+)===$/
export const MARKER_FAIL_RE = /^===RIGSYNC FAIL (\d+)===$/

/**
 * capability 전반이 공유하는 아주 작은 파일시스템 헬퍼 — symlink 판별/해석은
 * Node의 예외 던지는 API 위에서 반복되므로 한 곳에 모은다.
 */
import fs from 'node:fs'

export function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}

/** fs.realpathSync를 감싸 끊어진 symlink 등에서 예외 대신 빈 문자열을 준다. */
export function safeRealpath(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return ''
  }
}

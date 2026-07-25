/**
 * `~` 축약형 ↔ 절대경로 변환 + 홈 상대경로 변환. 구 repo
 * `~/repos/rigsync/rigsync.py`의 `expand`/`contract_home`/`rel_to_home` 행동을
 * ctx.homeDir 기준으로 옮긴 것(코드 복사 아님 — 전역 `os.homedir()`/`$HOME` 대신
 * ctx를 명시로 받아 테스트가 temp dir를 주입할 수 있게 했다).
 */
import path from 'node:path'
import type { RigsyncContext } from './context'

/** `~` 또는 `~/...` 형태의 manifest 경로를 ctx.homeDir 기준 절대경로로 푼다. */
export function expandHome(ctx: Pick<RigsyncContext, 'homeDir'>, homeStyle: string): string {
  if (homeStyle === '~') return ctx.homeDir
  if (homeStyle.startsWith('~/')) return path.join(ctx.homeDir, homeStyle.slice(2))
  return homeStyle
}

/** 절대경로를 ctx.homeDir 기준 `~/...` 축약형으로 되돌린다 (manifest 기록용). */
export function contractHome(ctx: Pick<RigsyncContext, 'homeDir'>, absPath: string): string {
  if (absPath === ctx.homeDir) return '~'
  if (absPath.startsWith(ctx.homeDir + path.sep)) {
    return '~' + absPath.slice(ctx.homeDir.length)
  }
  return absPath
}

/** homeDir 아래 경로를 홈 상대경로 문자열로 (백업 디렉터리 레이아웃용). */
export function relToHome(ctx: Pick<RigsyncContext, 'homeDir'>, absPath: string): string {
  const rel = path.relative(ctx.homeDir, absPath)
  if (rel.startsWith('..')) {
    // homeDir 바깥 경로 -- 선행 슬래시만 제거해 상대경로 형태로 맞춘다.
    return absPath.replace(/^\/+/, '')
  }
  return rel
}

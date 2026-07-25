/**
 * 덮어쓰기 전 백업 (안전 불변식 ②). 구 repo `backup_path`/`_do_backup` 행동을
 * 옮긴 것(코드 복사 아님) — 백업 루트는 ctx.backupRoot로 주입 가능해
 * 테스트가 실제 `~/.rigsync-backup`을 건드리지 않는다(P1 확정 결정 ④).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../context'
import { isSymlink } from '../fsUtil'
import { relToHome } from '../paths'

/** 이번 실행(run)의 백업 대상 경로. 실제로 백업하지 않고 경로만 계산한다. */
export function backupPath(
  ctx: Pick<RigsyncContext, 'homeDir' | 'backupRoot'>,
  homePath: string,
  runTs: string
): string {
  return path.join(ctx.backupRoot, runTs, relToHome(ctx, homePath))
}

/**
 * homePath(파일·심볼릭 링크·디렉터리)를 백업 디렉터리로 복사한다.
 * homePath가 존재하지 않으면(백업할 것이 없으면) undefined를 반환한다.
 */
export function doBackup(
  ctx: Pick<RigsyncContext, 'homeDir' | 'backupRoot'>,
  homePath: string,
  runTs: string
): string | undefined {
  const exists = fs.existsSync(homePath) || isSymlink(homePath)
  if (!exists) return undefined

  const dest = backupPath(ctx, homePath, runTs)
  fs.mkdirSync(path.dirname(dest), { recursive: true })

  if (isSymlink(homePath)) {
    const linkTarget = fs.readlinkSync(homePath)
    fs.symlinkSync(linkTarget, dest)
  } else if (fs.statSync(homePath).isDirectory()) {
    fs.cpSync(homePath, dest, { recursive: true })
  } else {
    fs.copyFileSync(homePath, dest)
  }
  return dest
}

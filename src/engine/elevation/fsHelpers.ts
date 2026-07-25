/**
 * 스크립트 파일 쓰기/취소 파일 경로 생성/정리 — 구 repo `gui.py`의
 * `write_sudo_script`/`pkexec_available`/취소파일 mkstemp-then-unlink 관용구
 * 이식(코드 복사 아님).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { commandExists } from '../providers/linux/exec'

/** 스크립트를 개인 임시 파일(0700)에 쓰고 경로를 반환한다. pkexec가 root로
 * 이 파일을 읽어야 하니 /tmp가 맞고, 0700이 다른 사용자를 막아준다. */
export function writeSudoScript(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-sudo-'))
  const scriptPath = path.join(dir, 'script.sh')
  fs.writeFileSync(scriptPath, text, { mode: 0o700 })
  fs.chmodSync(scriptPath, 0o700) // umask에 상관없이 보장
  return scriptPath
}

/** 아직 존재하지 않는 유일 경로만 생성한다 — `buildSudoScript`의 취소 체크는
 * `[ -f path ]`라 파일이 미리 있으면 안 된다(취소 버튼이 나중에 touch한다). */
export function makeCancelFilePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-cancel-'))
  return path.join(dir, `cancel-${crypto.randomBytes(4).toString('hex')}`)
}

export function pkexecAvailable(): boolean {
  return commandExists('pkexec')
}

/** 존재하지 않아도(이미 지워졌어도) 조용히 넘어가는 unlink. */
export function safeUnlink(filePath: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch {
    // 이미 없거나 권한 문제 -- 정리 실패는 치명적이지 않다.
  }
}

/**
 * subprocess 실행 + PATH 조회 공용 헬퍼 — 구 repo `_run`/`tool_available`의
 * TS 이식(코드 복사 아님). apt/snap/flatpak provider 구현이 공유한다.
 * **이 파일만 실제 시스템 명령을 만든다** — capture/diff/plan은 항상
 * `AptProvider`/`SnapProvider`/`FlatpakProvider` 인터페이스 뒤에서 호출한다
 * (P2a 결정 ⑥).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function run(argv: readonly string[], timeoutMs = 20_000): RunResult {
  const [cmd, ...args] = argv
  const result = spawnSync(cmd, args, { encoding: 'utf-8', timeout: timeoutMs })
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return { code: 127, stdout: '', stderr: `${cmd}: not found` }
    }
    return { code: 1, stdout: '', stderr: err.message }
  }
  if (result.signal) {
    return { code: 124, stdout: result.stdout ?? '', stderr: 'timeout' }
  }
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** `shutil.which`와 동등한 PATH 조회 — 외부 `which` 바이너리에 기대지 않는다. */
export function commandExists(name: string): boolean {
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK)
      return true
    } catch {
      // 이 디렉터리엔 없음 -- 다음으로.
    }
  }
  return false
}

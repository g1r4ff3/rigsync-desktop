/**
 * `pkexec /bin/sh <script>`를 실행하는 유일한 경로 — 구 repo `gui.py`의
 * `run_sudo_script` 행동을 옮긴 것(코드 복사 아님). Item 2/3 규약 그대로:
 *
 * - rc 126 -> "dismissed"(폴킷 인증 대화상자 취소), 127 -> "unauthorized"
 *   (권한 없음/명령 못 찾음), 3 -> "cancelled"(우리 cancelFile 센티널),
 *   그 외 nonzero -> "script-failed", 0 -> "ok".
 * - stderr는 결과와 무관하게 항상 전문을 반환한다 — 실패가 조용히 묻히지 않게.
 * - 스크립트 파일 자체는 여기서 쓰거나 지우지 않는다 — 호출자가 호출 직전에
 *   쓰고 직후 finally에서 지운다(파일이 존재해야 하는 구간을 pkexec가 실제로
 *   그걸 필요로 하는 순간만으로 좁힌다).
 */
import {
  parseSudoScriptOutput,
  SudoStreamParser,
  type SudoCommandStatus,
  type SudoEvent
} from './parse'
import type { ElevationExec } from './execTypes'

export type SudoOutcome = 'ok' | 'dismissed' | 'unauthorized' | 'cancelled' | 'script-failed'

export interface RunSudoScriptResult {
  readonly events: readonly SudoEvent[]
  readonly statuses: readonly SudoCommandStatus[]
  readonly returncode: number
  readonly stderr: string
  readonly outcome: SudoOutcome
}

export async function runSudoScript(
  exec: ElevationExec,
  scriptPath: string,
  nCommands: number,
  onEvent?: (event: SudoEvent) => void,
  timeoutMs = 3_600_000
): Promise<RunSudoScriptResult> {
  const parser = new SudoStreamParser()
  const stdoutParts: string[] = []

  const { code, stderr } = await exec.spawn({
    argv: ['pkexec', '/bin/sh', scriptPath],
    timeoutMs,
    onStdout: (chunk) => {
      stdoutParts.push(chunk)
      for (const event of parser.feed(chunk)) {
        onEvent?.(event)
      }
    }
  })

  let outcome: SudoOutcome
  if (code === 126) outcome = 'dismissed'
  else if (code === 127) outcome = 'unauthorized'
  else if (code === 3) outcome = 'cancelled'
  else if (code !== 0) outcome = 'script-failed'
  else outcome = 'ok'

  const statuses = parseSudoScriptOutput(stdoutParts.join(''), nCommands, code === 3)

  return { events: parser.events, statuses, returncode: code, stderr, outcome }
}

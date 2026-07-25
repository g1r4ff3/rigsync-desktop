/**
 * `buildSudoScript`가 만든 스크립트의 stdout을 명령별 상태로 되짚는다 — 구
 * repo `gui.py`의 `parse_sudo_script_output`/`SudoStreamParser` 행동을 옮긴
 * 것(코드 복사 아님).
 */
import { MARKER_CMD_RE, MARKER_DONE, MARKER_FAIL_RE } from './constants'

export type SudoCommandStatus = 'ok' | 'failed' | 'not-run'

/**
 * 스크립트의 전체 stdout(문자열 한 덩어리)을 명령 개수(`nCommands`)만큼의
 * 상태 배열로 매핑한다. 출력이 아예 없으면(polkit 인증 대화상자가 닫혀 스크립트가
 * 시작조차 못한 경우) 전부 "not-run".
 *
 * `cancelled`: 취소 파일 센티널(rc 3)로 끝난 경우 true. `buildSudoScript`의
 * 취소 체크는 명령들 **사이**에서만 도니, FAIL 마커 없이 시작만 된 명령은
 * (취소 시점엔) 이미 성공적으로 끝난 것으로 안다 — 기본값인 "failed"(그 외
 * 이유로 프로세스가 명령 도중 죽은 경우)와 구분해야 한다.
 */
export function parseSudoScriptOutput(
  output: string,
  nCommands: number,
  cancelled = false
): SudoCommandStatus[] {
  const started = new Set<number>()
  let failed: number | null = null
  let done = false

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim()
    const cmdMatch = MARKER_CMD_RE.exec(line)
    if (cmdMatch) {
      started.add(Number(cmdMatch[1]))
      continue
    }
    const failMatch = MARKER_FAIL_RE.exec(line)
    if (failMatch) {
      failed = Number(failMatch[1])
      continue
    }
    if (line === MARKER_DONE) {
      done = true
    }
  }

  const statuses: SudoCommandStatus[] = []
  for (let i = 0; i < nCommands; i++) {
    if (done && failed === null) {
      statuses.push('ok')
    } else if (failed !== null) {
      if (i < failed) statuses.push('ok')
      else if (i === failed) statuses.push('failed')
      else statuses.push('not-run')
    } else if (started.has(i)) {
      // 시작은 됐는데 FAIL도 DONE도 없음 -- 명령 도중 프로세스가 죽었다는 뜻.
      // 단, 취소로 끝난 경우는 예외: 취소 체크는 명령 "사이"에서만 일어나므로
      // 시작된 명령은 이미 끝까지 완주했을 것이다.
      statuses.push(cancelled ? 'ok' : 'failed')
    } else {
      statuses.push('not-run')
    }
  }
  return statuses
}

export type SudoEvent =
  | { readonly kind: 'start'; readonly index: number }
  | { readonly kind: 'fail'; readonly index: number }
  | { readonly kind: 'done' }

/**
 * `buildSudoScript` 출력의 증분 라인 파서. 실제 파이프 출력은 줄바꿈에
 * 맞춰 도착한다는 보장이 없으므로(부분 줄·여러 줄·중간 어디든) `.feed(chunk)`를
 * 몇 바이트 단위로 호출해도, 통째로 호출해도 동일한 이벤트 시퀀스가 나와야
 * 한다. `runSudoScript`가 이 클래스로 pkexec 실행 중 실시간 진행 이벤트를 만든다.
 */
export class SudoStreamParser {
  private buffer = ''
  readonly events: SudoEvent[] = []

  /** chunk(임의 크기/정렬)를 먹이고, 이번 호출로 새로 생긴 이벤트만 반환한다. */
  feed(chunk: string): SudoEvent[] {
    this.buffer += chunk
    const newEvents: SudoEvent[] = []

    let newlineIndex = this.buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim()
      this.buffer = this.buffer.slice(newlineIndex + 1)

      const cmdMatch = MARKER_CMD_RE.exec(line)
      if (cmdMatch) {
        newEvents.push({ kind: 'start', index: Number(cmdMatch[1]) })
      } else {
        const failMatch = MARKER_FAIL_RE.exec(line)
        if (failMatch) {
          newEvents.push({ kind: 'fail', index: Number(failMatch[1]) })
        } else if (line === MARKER_DONE) {
          newEvents.push({ kind: 'done' })
        }
      }
      newlineIndex = this.buffer.indexOf('\n')
    }

    this.events.push(...newEvents)
    return newEvents
  }
}

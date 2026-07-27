/**
 * subprocess 실행 + PATH 조회 공용 헬퍼 — 구 repo `_run`/`tool_available`의
 * TS 이식(코드 복사 아님). apt/snap/flatpak provider 구현이 공유한다.
 * **이 파일만 실제 시스템 명령을 만든다** — capture/diff/plan은 항상
 * `AptProvider`/`SnapProvider`/`FlatpakProvider` 인터페이스 뒤에서 호출한다
 * (P2a 결정 ⑥).
 *
 * **perf 3라운드(providers 비동기화)**: `spawnSync`는 utilityProcess 워커
 * 스레드 전체를 서브프로세스 종료까지 멈춘다 — 워커 요청 스케줄러
 * (`requestScheduler.ts`)가 만든 읽기 동시성이 이 지점에서 실질 무효화됐다.
 * 콜백형 `execFile`(비동기)로 전환 — 반환 시그니처(`RunResult` 필드,
 * ENOENT→127·timeout→124 매핑)는 그대로 유지해 이 함수를 쓰는 provider들이
 * `await`만 추가하면 되게 한다. 콜백형을 쓰는 이유는 `input`(stdin 전달,
 * 구 `spawnSync(..., {input})` 대응 — `crontab -`/`dconf load` 등)까지
 * 하나의 함수로 지원하기 위해서다: `util.promisify(execFile)`은 `input`
 * 옵션을 지원하지 않는다(그건 `execFileSync` 전용). 콜백형은 반환된
 * `ChildProcess`의 `stdin`에 바로 쓸 수 있어 이 둘을 통일할 수 있다.
 * 실측(2026-07-27, 이 머신): 콜백형 콜백은 성공/실패 무관하게 stdout·stderr를
 * 항상 별도 인자로 주고(에러 객체에 안 실어도 됨), 종료코드 실패는 숫자
 * `error.code`, spawn 실패는 문자열 `error.code`('ENOENT'), timeout은
 * `error.signal`(예: 'SIGTERM')+`error.code===null`로 구분된다 — 분기 순서가
 * 이 구분을 그대로 반영한다.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function run(
  argv: readonly string[],
  timeoutMs = 20_000,
  input?: string
): Promise<RunResult> {
  const [cmd, ...args] = argv
  return new Promise((resolve) => {
    const child = execFile(
      cmd,
      args,
      { encoding: 'utf-8', timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout: stdout ?? '', stderr: stderr ?? '' })
          return
        }
        const err = error as NodeJS.ErrnoException & {
          code?: number | string | null
          signal?: NodeJS.Signals | null
        }
        if (err.code === 'ENOENT') {
          resolve({ code: 127, stdout: '', stderr: `${cmd}: not found` })
          return
        }
        if (err.signal) {
          resolve({ code: 124, stdout: stdout ?? '', stderr: 'timeout' })
          return
        }
        const code = typeof err.code === 'number' ? err.code : 1
        resolve({ code, stdout: stdout ?? '', stderr: stderr || err.message })
      }
    )
    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
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

/**
 * elevation 테스트 전용 fake `ElevationExec` — 이 파일은 Vitest include
 * 패턴에 안 걸리므로 테스트 파일이 아니다. **실제 pkexec는 여기 어디에도
 * 없다**(P2b 결정 ①·⑥) — "run" 모드는 구 repo `gui.py`
 * `_FakePkexecPath`/`_PKEXEC_SHIM_MODES`가 하던 것과 똑같이, argv에서
 * "pkexec"만 떼고 나머지(`/bin/sh <script>`)를 지금(비root) 사용자로 실제
 * 실행한다 — 실제 명령 효과(파일 생성 등)를 그대로 관찰할 수 있으면서도
 * 진짜 pkexec/root 권한은 전혀 필요하지 않다.
 */
import { spawn } from 'node:child_process'
import type { ElevationExec, ElevationSpawnOptions, ElevationSpawnResult } from './execTypes'

export type FakePkexecMode = 'run' | 'dismiss' | 'unauthorized'

export function makeFakeElevationExec(mode: FakePkexecMode = 'run'): ElevationExec {
  return {
    spawn: (options: ElevationSpawnOptions): Promise<ElevationSpawnResult> => {
      if (mode === 'dismiss') return Promise.resolve({ code: 126, stderr: '' })
      if (mode === 'unauthorized') return Promise.resolve({ code: 127, stderr: '' })

      // "run": argv[0]("pkexec")는 건너뛰고 나머지를 진짜로 실행한다.
      const [, ...rest] = options.argv
      const [cmd, ...args] = rest
      return new Promise((resolve) => {
        const child = spawn(cmd, args)
        let stderr = ''
        let settled = false
        const timer = setTimeout(() => child.kill(), options.timeoutMs)
        const finish = (result: ElevationSpawnResult): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        }
        child.stdout?.on('data', (buf: Buffer) => options.onStdout(buf.toString('utf-8')))
        child.stderr?.on('data', (buf: Buffer) => {
          stderr += buf.toString('utf-8')
        })
        child.on('close', (code) => finish({ code: code ?? 1, stderr }))
        child.on('error', (err: Error) => finish({ code: 127, stderr: stderr + err.message }))
      })
    }
  }
}

/**
 * 실제 pkexec 실행 — `ElevationExec`의 Linux 구현. dev 환경에서만 쓰인다
 * (테스트는 fake exec를 주입 — P2b 결정 ①). `child_process.spawn`(동기 아님)을
 * 써서 stdout을 라인 정렬 보장 없이 청크 단위로 흘려보낸다 —
 * `SudoStreamParser`가 그 어떤 청크 분할에도 맞게 설계됐다.
 */
import { spawn } from 'node:child_process'
import type {
  ElevationExec,
  ElevationSpawnOptions,
  ElevationSpawnResult
} from '../../elevation/execTypes'

export class LinuxPkexecExec implements ElevationExec {
  async spawn(options: ElevationSpawnOptions): Promise<ElevationSpawnResult> {
    const [cmd, ...args] = options.argv
    return new Promise((resolve) => {
      const child = spawn(cmd, args)
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        child.kill()
      }, options.timeoutMs)

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

      child.on('error', (err: NodeJS.ErrnoException) => {
        // pkexec 자체가 PATH에 없는 경우 등 -- "미권한/못 찾음"과 같은 뜻으로
        // 127을 준다(run_sudo_script의 rc 분류와 합류시킨다).
        finish({ code: 127, stderr: stderr + err.message })
      })

      child.on('close', (code) => {
        finish({ code: code ?? 1, stderr })
      })
    })
  }
}

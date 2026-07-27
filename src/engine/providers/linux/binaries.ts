/**
 * 설치된 실행파일의 버전 확인 — `BinariesSystemProvider`의 Linux 구현.
 * diff의 pinMismatch 판정(pin이 걸린 엔트리만)이 이 provider를 쓴다.
 */
import type {
  BinariesCommandResult,
  BinariesSystemProvider
} from '../../capabilities/binaries/providerTypes'
import { run } from './exec'

export class LinuxBinariesSystemProvider implements BinariesSystemProvider {
  async runVersionCommand(
    binaryPath: string,
    versionArgs: readonly string[]
  ): Promise<BinariesCommandResult> {
    const result = await run([binaryPath, ...versionArgs], 10_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}

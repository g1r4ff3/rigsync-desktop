/**
 * 관리자 권한 명령들을 하나의 /bin/sh 스크립트로 묶는다 — 구 repo `gui.py`의
 * `build_sudo_script` 행동을 옮긴 것(코드 복사 아님).
 *
 * - 각 명령 앞의 `sudo `는 벗긴다: pkexec가 이미 root로 스크립트 전체를
 *   실행하므로 남겨두면 잡음일 뿐이고, root의 PATH에 sudo가 없는 시스템에서는
 *   오히려 실패한다.
 * - 명령 실행 전 echo 마커 + 실패 시 FAIL 마커로 `parseSudoScriptOutput`/
 *   `SudoStreamParser`가 명령별 상태를 재구성할 수 있게 한다.
 * - 첫 실패 명령에서 실행이 멈춘다(사람이 하나씩 손으로 실행했을 때와 동일).
 * - `cancelFile`(취소 버튼): 주어지면 매 명령 **앞**(명령 도중은 절대 아님)에
 *   그 파일 존재 여부를 체크해 있으면 exit 3. 협조적 소프트 취소 — 이미 실행
 *   중인 명령은 항상 끝까지 마친다. 취소 버튼은 이 파일을 touch할 뿐이고, 이
 *   함수는 파일을 지우지 않는다(생애주기는 호출자 소유).
 */
import { markerCmd, markerFail, MARKER_DONE } from './constants'

export function buildSudoScript(commands: readonly string[], cancelFile?: string): string {
  const lines: string[] = ['#!/bin/sh', '# rigsync -- 관리자 권한 작업 일괄 실행 (pkexec 1회 인증)']

  commands.forEach((rawCmd, index) => {
    let cmd = rawCmd.trim()
    if (cmd.startsWith('sudo ')) {
      cmd = cmd.slice('sudo '.length)
    }
    if (cancelFile !== undefined) {
      lines.push(`[ -f '${cancelFile}' ] && exit 3`)
    }
    lines.push(`echo '${markerCmd(index)}'`)
    lines.push(`${cmd} || { echo '${markerFail(index)}'; exit 1; }`)
  })

  lines.push(`echo '${MARKER_DONE}'`)
  return lines.join('\n') + '\n'
}

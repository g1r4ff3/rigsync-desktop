import { describe, expect, it } from 'vitest'
import {
  hostLayerMoveCommitMessage,
  ignoreToggleBulkCommitMessage,
  ignoreToggleCommitMessage,
  registerEntryCommitMessage,
  selectModeCommitMessage,
  selectToggleBulkCommitMessage,
  selectToggleCommitMessage,
  unregisterEntryCommitMessage
} from './authoredWriteMessage'

describe('authoredWriteMessage (WS5 커밋 메시지 어휘)', () => {
  it('ignoreToggleCommitMessage: on/off를 ignored로 인코딩한다', () => {
    expect(ignoreToggleCommitMessage('lab-main', 'apt', 'v4l-utils', true)).toBe(
      'ignore: lab-main apt:v4l-utils (on)'
    )
    expect(ignoreToggleCommitMessage('lab-main', 'apt', 'v4l-utils', false)).toBe(
      'ignore: lab-main apt:v4l-utils (off)'
    )
  })

  it('ignoreToggleBulkCommitMessage: N건을 담는다', () => {
    expect(ignoreToggleBulkCommitMessage('lab-main', 'apt', 3)).toBe('ignore: lab-main apt 3건')
  })

  it('hostLayerMoveCommitMessage: host/common 방향을 인코딩한다', () => {
    expect(hostLayerMoveCommitMessage('lab-main', 'dotfiles', '~/.zshrc', 'host')).toBe(
      'host-layer: lab-main dotfiles:~/.zshrc (host)'
    )
    expect(
      hostLayerMoveCommitMessage('lab-main', 'services', 'cliproxyapi.service', 'common')
    ).toBe('host-layer: lab-main services:cliproxyapi.service (common)')
  })

  it('registerEntryCommitMessage: register: <machineId> <capability>:<key>', () => {
    expect(registerEntryCommitMessage('lab-main', 'apt', 'zsh')).toBe('register: lab-main apt:zsh')
  })

  it('unregisterEntryCommitMessage: unregister: <machineId> <capability>:<key>', () => {
    expect(unregisterEntryCommitMessage('lab-main', 'apt', 'zsh')).toBe(
      'unregister: lab-main apt:zsh'
    )
  })

  it('selectToggleCommitMessage: on/off를 subscribed로 인코딩한다', () => {
    expect(selectToggleCommitMessage('lab-main', 'apt', 'v4l-utils', true)).toBe(
      'select: lab-main apt:v4l-utils (on)'
    )
    expect(selectToggleCommitMessage('lab-main', 'apt', 'v4l-utils', false)).toBe(
      'select: lab-main apt:v4l-utils (off)'
    )
  })

  it('selectToggleBulkCommitMessage: N건을 담는다', () => {
    expect(selectToggleBulkCommitMessage('lab-main', 'apt', 5)).toBe('select: lab-main apt 5건')
  })

  it('selectModeCommitMessage: mode=<mode>를 담는다', () => {
    expect(selectModeCommitMessage('lab-main', 'select')).toBe('select: lab-main mode=select')
    expect(selectModeCommitMessage('lab-main', 'all')).toBe('select: lab-main mode=all')
  })
})

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import type { ImRobotConfig, ImRobotToken, Challenge } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG } from '../styles'
import { setupScreenshotShield } from '../screenshot-shield'

export interface ImRobotProps {
  difficulty?: 'easy' | 'medium' | 'hard'
  theme?: 'light' | 'dark'
  ttl?: number
  onVerified?: (token: ImRobotToken) => void
  onError?: (error: Error) => void
}

export function ImRobot({
  difficulty = 'medium',
  theme = 'light',
  ttl,
  onVerified,
  onError,
}: ImRobotProps) {
  const [challenge, setChallenge] = useState<Challenge>(() =>
    generateChallenge({ difficulty, ...(ttl ? { ttl } : {}) }),
  )
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'idle' | 'verified' | 'failed'>('idle')
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.ceil(challenge.ttl / 1000),
  )
  const [shielded, setShielded] = useState(false)
  const startTime = useRef(Date.now())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const css = useMemo(() => getStyles(theme), [theme])
  const display = useMemo(
    () => formatPipeline(challenge.visibleSeed, challenge.pipeline),
    [challenge],
  )
  const challengeJson = useMemo(() => JSON.stringify(challenge), [challenge])

  const refreshChallenge = useCallback(() => {
    const newChallenge = generateChallenge({ difficulty, ...(ttl ? { ttl } : {}) })
    setChallenge(newChallenge)
    setAnswer('')
    setStatus('idle')
    startTime.current = Date.now()
    setRemainingSeconds(Math.ceil(newChallenge.ttl / 1000))
  }, [difficulty, ttl])

  // Countdown timer
  useEffect(() => {
    if (status === 'verified') return

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - challenge.timestamp
      const remaining = Math.max(0, Math.ceil((challenge.ttl - elapsed) / 1000))
      setRemainingSeconds(remaining)
      if (remaining <= 0) {
        refreshChallenge()
      }
    }, 1000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [challenge, status, refreshChallenge])

  // Screenshot shield
  useEffect(() => {
    return setupScreenshotShield(setShielded)
  }, [])

  const handleVerify = useCallback(() => {
    const trimmed = answer.trim()
    if (!trimmed) return

    if (verifyAnswer(challenge, trimmed)) {
      setStatus('verified')
      const token = createToken(challenge, trimmed, startTime.current)
      onVerified?.(token)
    } else {
      setStatus('failed')
      onError?.(new Error('Verification failed'))
    }
  }, [answer, challenge, onVerified, onError])

  const handleRetry = useCallback(() => {
    refreshChallenge()
  }, [refreshChallenge])

  const totalSec = challenge.ttl / 1000
  const pct = (remainingSeconds / totalSec) * 100

  return (
    <>
      <style>{css}</style>
      <div
        className="imrobot"
        data-imrobot-challenge={challengeJson}
        role="region"
        aria-label="ImRobot verification challenge"
      >
        <div className="imrobot-header">
          <span
            className="imrobot-icon"
            dangerouslySetInnerHTML={{ __html: ROBOT_SVG }}
          />
          <span>Prove you&apos;re a robot</span>
        </div>

        {status !== 'verified' && (
          <div className="imrobot-timer">
            <span className="imrobot-timer-label">Time</span>
            <div className="imrobot-timer-bar">
              <div
                className={`imrobot-timer-fill${pct <= 25 ? ' imrobot-timer-fill--warn' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="imrobot-timer-text">{remainingSeconds}s</span>
          </div>
        )}

        <div
          className={`imrobot-challenge${shielded ? ' imrobot-challenge--shielded' : ''}`}
          aria-label="Challenge pipeline"
          onContextMenu={(e) => e.preventDefault()}
          onCopy={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <span className="imrobot-shield-notice">Screenshot protected</span>
          {display}
        </div>

        {status !== 'verified' && (
          <div className="imrobot-row">
            <input
              className="imrobot-input"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              placeholder="Enter pipeline result..."
              aria-label="Challenge answer"
              autoComplete="off"
            />
            <button
              className="imrobot-btn"
              onClick={handleVerify}
              disabled={!answer.trim()}
            >
              Verify
            </button>
          </div>
        )}

        <div className="imrobot-footer">
          <div>
            {status === 'verified' && (
              <span className="imrobot-status imrobot-status--verified">
                &#10003; Verified: You are a robot
              </span>
            )}
            {status === 'failed' && (
              <span className="imrobot-status imrobot-status--failed">
                &#10007; Failed —{' '}
                <button
                  onClick={handleRetry}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  try again
                </button>
              </span>
            )}
          </div>
          <span className="imrobot-brand">imrobot</span>
        </div>
      </div>
    </>
  )
}

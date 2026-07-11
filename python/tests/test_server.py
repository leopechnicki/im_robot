"""Tests for server-side HMAC verification."""

from imrobot.server import ImRobotVerifier, ChallengeReplayGuard, create_verifier
from imrobot.core import solve_challenge


SECRET = "test-secret-minimum-16-chars"


class TestImRobotVerifier:

    def test_create_verifier(self):
        verifier = ImRobotVerifier(secret=SECRET)
        assert verifier is not None

    def test_short_secret_raises(self):
        try:
            ImRobotVerifier(secret="short")
            assert False, "Should have raised"
        except ValueError:
            pass

    def test_generate_returns_signed_challenge(self):
        verifier = ImRobotVerifier(secret=SECRET)
        challenge = verifier.generate()
        assert challenge.hmac != ""
        assert challenge.expires_at > 0

    def test_verify_correct_answer(self):
        verifier = ImRobotVerifier(secret=SECRET)
        challenge = verifier.generate()
        answer = solve_challenge(challenge)
        result = verifier.verify(challenge, answer)
        assert result.valid is True
        assert result.elapsed is not None
        assert result.suspicious is not None

    def test_verify_wrong_answer(self):
        verifier = ImRobotVerifier(secret=SECRET)
        challenge = verifier.generate()
        result = verifier.verify(challenge, "wrong_answer")
        assert result.valid is False
        assert result.reason == "wrong_answer"

    def test_verify_tampered_hmac(self):
        verifier = ImRobotVerifier(secret=SECRET)
        challenge = verifier.generate()
        challenge.hmac = "0000000000000000000000000000000000000000000000000000000000000000"
        answer = solve_challenge(challenge)
        result = verifier.verify(challenge, answer)
        assert result.valid is False
        assert result.reason == "invalid_hmac"

    def test_verify_different_secret(self):
        verifier1 = ImRobotVerifier(secret=SECRET)
        verifier2 = ImRobotVerifier(secret="different-secret-16-chars-long")
        challenge = verifier1.generate()
        answer = solve_challenge(challenge)
        result = verifier2.verify(challenge, answer)
        assert result.valid is False
        assert result.reason == "invalid_hmac"

    def test_difficulty_override(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="easy")
        challenge = verifier.generate(difficulty="hard")
        assert challenge.difficulty == "hard"

    def test_all_difficulties(self):
        for diff in ("easy", "medium", "hard"):
            verifier = ImRobotVerifier(secret=SECRET, difficulty=diff)
            challenge = verifier.generate()
            answer = solve_challenge(challenge)
            result = verifier.verify(challenge, answer)
            assert result.valid is True, f"Failed for difficulty {diff}"


class TestCreateVerifier:

    def test_factory_function(self):
        verifier = create_verifier(secret=SECRET)
        challenge = verifier.generate()
        answer = solve_challenge(challenge)
        result = verifier.verify(challenge, answer)
        assert result.valid is True


class TestReplayGuard:

    def test_first_use_allowed(self):
        guard = ChallengeReplayGuard()
        assert guard.mark_used("test-id-1") is True

    def test_second_use_blocked(self):
        guard = ChallengeReplayGuard()
        guard.mark_used("test-id-1")
        assert guard.mark_used("test-id-1") is False

    def test_different_ids_allowed(self):
        guard = ChallengeReplayGuard()
        assert guard.mark_used("id-1") is True
        assert guard.mark_used("id-2") is True

    def test_replay_in_verification(self):
        guard = ChallengeReplayGuard()
        verifier = ImRobotVerifier(secret=SECRET, replay_guard=guard)
        challenge = verifier.generate()
        answer = solve_challenge(challenge)

        result1 = verifier.verify(challenge, answer)
        assert result1.valid is True

        result2 = verifier.verify(challenge, answer)
        assert result2.valid is False
        assert result2.reason == "replay"

"""Tests for core challenge generation, solving, and verification."""

import time
from imrobot.core import generate_challenge, solve_challenge, verify_answer
from imrobot.types import Challenge


class TestGenerateChallenge:

    def test_returns_challenge(self):
        challenge = generate_challenge()
        assert isinstance(challenge, Challenge)

    def test_default_difficulty(self):
        challenge = generate_challenge()
        assert challenge.difficulty == "medium"

    def test_easy_difficulty(self):
        challenge = generate_challenge(difficulty="easy")
        assert challenge.difficulty == "easy"
        assert len(challenge.pipeline) >= 2
        assert len(challenge.pipeline) <= 3

    def test_medium_difficulty(self):
        challenge = generate_challenge(difficulty="medium")
        assert len(challenge.pipeline) >= 3
        assert len(challenge.pipeline) <= 5

    def test_hard_difficulty(self):
        challenge = generate_challenge(difficulty="hard")
        assert len(challenge.pipeline) >= 5
        assert len(challenge.pipeline) <= 7

    def test_custom_ttl(self):
        challenge = generate_challenge(ttl=5000)
        assert challenge.ttl == 5000

    def test_default_ttl_by_difficulty(self):
        easy = generate_challenge(difficulty="easy")
        medium = generate_challenge(difficulty="medium")
        hard = generate_challenge(difficulty="hard")
        assert easy.ttl == 30_000
        assert medium.ttl == 20_000
        assert hard.ttl == 15_000

    def test_seed_structure(self):
        challenge = generate_challenge(difficulty="medium")
        assert len(challenge.visible_seed) == 16
        assert len(challenge.nonce) == 6
        assert challenge.seed == challenge.visible_seed + challenge.nonce

    def test_version_is_1(self):
        challenge = generate_challenge()
        assert challenge.version == 1

    def test_id_is_hex(self):
        challenge = generate_challenge()
        assert len(challenge.id) == 16
        assert all(c in "0123456789abcdef" for c in challenge.id)

    def test_verification_is_hex(self):
        challenge = generate_challenge()
        assert len(challenge.verification) == 8
        assert all(c in "0123456789abcdef" for c in challenge.verification)

    def test_timestamp_is_recent(self):
        before = int(time.time() * 1000)
        challenge = generate_challenge()
        after = int(time.time() * 1000)
        assert before <= challenge.timestamp <= after

    def test_unique_ids(self):
        ids = {generate_challenge().id for _ in range(20)}
        assert len(ids) == 20


class TestSolveChallenge:

    def test_solve_returns_string(self):
        challenge = generate_challenge()
        answer = solve_challenge(challenge)
        assert isinstance(answer, str)
        assert len(answer) > 0

    def test_solve_is_deterministic(self):
        challenge = generate_challenge()
        a = solve_challenge(challenge)
        b = solve_challenge(challenge)
        assert a == b

    def test_solve_all_difficulties(self):
        for diff in ("easy", "medium", "hard"):
            challenge = generate_challenge(difficulty=diff)
            answer = solve_challenge(challenge)
            assert isinstance(answer, str)
            assert len(answer) > 0


class TestVerifyAnswer:

    def test_correct_answer_verifies(self):
        challenge = generate_challenge()
        answer = solve_challenge(challenge)
        assert verify_answer(challenge, answer) is True

    def test_wrong_answer_fails(self):
        challenge = generate_challenge()
        assert verify_answer(challenge, "wrong_answer_xyz") is False

    def test_expired_challenge_fails(self):
        challenge = generate_challenge(ttl=1)
        answer = solve_challenge(challenge)
        # Wait for expiry
        time.sleep(0.01)
        assert verify_answer(challenge, answer) is False

    def test_all_difficulties_verify(self):
        for diff in ("easy", "medium", "hard"):
            challenge = generate_challenge(difficulty=diff)
            answer = solve_challenge(challenge)
            assert verify_answer(challenge, answer) is True


class TestChallengeFromDict:

    def test_roundtrip(self):
        challenge = generate_challenge()
        d = challenge.to_dict()
        restored = Challenge.from_dict(d)

        assert restored.id == challenge.id
        assert restored.seed == challenge.seed
        assert restored.difficulty == challenge.difficulty
        assert restored.verification == challenge.verification
        assert len(restored.pipeline) == len(challenge.pipeline)

    def test_solve_restored_challenge(self):
        challenge = generate_challenge()
        answer_original = solve_challenge(challenge)

        d = challenge.to_dict()
        restored = Challenge.from_dict(d)
        answer_restored = solve_challenge(restored)

        assert answer_original == answer_restored

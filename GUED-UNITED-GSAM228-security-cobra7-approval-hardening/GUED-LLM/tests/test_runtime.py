import tempfile, unittest
from pathlib import Path
from app.security import CredentialStore
from app.storage import RuntimeStore

class RuntimeTests(unittest.TestCase):
    def test_token_rotation_and_revocation(self):
        db = str(Path(tempfile.mkdtemp()) / "state.sqlite3")
        store = CredentialStore(db)
        token, identity = store.create("agent01")
        self.assertEqual(store.authenticate(token).agent_id, identity.agent_id)
        rotated = store.rotate(identity.agent_id)
        self.assertIsNotNone(rotated)
        new_token, new_identity = rotated
        self.assertIsNone(store.authenticate(token))
        self.assertEqual(store.authenticate(new_token).agent_id, new_identity.agent_id)

    def test_conversation_isolation(self):
        db = str(Path(tempfile.mkdtemp()) / "state.sqlite3")
        store = CredentialStore(db)
        runtime = RuntimeStore(db)
        _, agent_a = store.create("agentA")
        _, agent_b = store.create("agentB")
        conv = runtime.conversation(agent_a.agent_id, None)
        runtime.append(agent_a.agent_id, conv, "user", "secret-A")
        self.assertEqual(runtime.history(agent_a.agent_id, conv, 10)[0]["content"], "secret-A")
        self.assertEqual(runtime.history(agent_b.agent_id, conv, 10), [])

if __name__ == "__main__":
    unittest.main()

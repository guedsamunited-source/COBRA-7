import tempfile,unittest
from pathlib import Path
from app.security import CredentialStore,RateLimiter
class SecurityTests(unittest.TestCase):
 def test_credentials(self):
  s=CredentialStore(str(Path(tempfile.mkdtemp())/'x.sqlite3')); token,i=s.create('agent-one'); self.assertEqual(s.authenticate(token).agent_id,i.agent_id); self.assertIsNone(s.authenticate(token+'x')); self.assertTrue(s.revoke(i.agent_id)); self.assertIsNone(s.authenticate(token))
 def test_rate_limit(self):
  r=RateLimiter(2); self.assertTrue(r.allow('a')); self.assertTrue(r.allow('a')); self.assertFalse(r.allow('a'))
if __name__=='__main__': unittest.main()

from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
import admin_tunnel


class AdminTunnelTests(unittest.TestCase):
    def test_three_public_health_failures_restart_only_the_tunnel_child(self):
        stop = Mock()
        stop.wait.side_effect = [False, False, False]
        stop.is_set.return_value = False
        process = Mock()
        with patch.object(admin_tunnel, 'stopped', stop), patch.object(admin_tunnel, 'healthy', return_value=False), patch.object(admin_tunnel, 'publish') as publish:
            admin_tunnel.heartbeat('https://example.trycloudflare.com', process)
        process.terminate.assert_called_once()
        publish.assert_not_called()

    def test_transient_failure_resets_after_a_successful_health_probe(self):
        stop = Mock()
        stop.wait.side_effect = [False, False, False, True]
        process = Mock()
        with patch.object(admin_tunnel, 'stopped', stop), patch.object(admin_tunnel, 'healthy', side_effect=[False, True, False]), patch.object(admin_tunnel, 'publish'):
            admin_tunnel.heartbeat('https://example.trycloudflare.com', process)
        process.terminate.assert_not_called()


if __name__ == '__main__': unittest.main()

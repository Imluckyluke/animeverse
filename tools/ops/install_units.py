from pathlib import Path
import os
import shutil

source = Path(__file__).resolve().parent
if os.geteuid() != 0:
    raise SystemExit('Administrator installation is required')
names = ['animeverse-production-monitor.service', 'animeverse-production-monitor.timer',
         'animeverse-private-backup.service', 'animeverse-private-backup.timer']
for name in names:
    target = Path('/etc/systemd/system') / name
    if target.exists() and target.read_bytes() != (source / name).read_bytes():
        raise SystemExit('Existing unit differs; inspect before changing it')
    shutil.copyfile(source / name, target)
    os.chmod(target, 0o644)
print('OPS_UNIT_TEMPLATES_INSTALLED_AND_MATCHED')

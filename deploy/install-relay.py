"""Run on the authorized server after uploading the bundle and private state."""
import pathlib,subprocess,shutil,os,json,pwd,tarfile,time
root=pathlib.Path('/srv/codex-remote')
assert root.resolve()==root
if shutil.disk_usage('/').free<100*1024*1024:raise RuntimeError('Insufficient disk space for isolated deployment')
release=root/'releases'/'20261106-030'
release.mkdir(parents=True,exist_ok=True)
with tarfile.open(root/'incoming.tar.gz') as archive:
 for member in archive.getmembers():
  if member.name not in ['relay.mjs','codex-remote.service','nginx.locations.conf','version.json'] or not member.isfile():raise RuntimeError('Invalid deployment archive')
  (release/member.name).write_bytes(archive.extractfile(member).read())
try:account=pwd.getpwnam('codex-relay')
except KeyError:
 subprocess.run(['useradd','--system','--home-dir',str(root),'--shell','/sbin/nologin','codex-relay'],check=True)
 account=pwd.getpwnam('codex-relay')
for p in [root/'state',root/'backups',root/'downloads']:p.mkdir(exist_ok=True)
os.chmod(root/'state',0o700);os.chown(root/'state',account.pw_uid,account.pw_gid)
for p in (root/'state').iterdir():os.chmod(p,0o600);os.chown(p,account.pw_uid,account.pw_gid)
current=root/'current'
if current.is_symlink():current.unlink()
elif current.exists():raise RuntimeError('Refusing to replace unknown current directory')
current.symlink_to(release,target_is_directory=True)
shutil.copyfile(release/'codex-remote.service','/etc/systemd/system/codex-remote.service')
nginx=pathlib.Path('/etc/nginx/conf.d/daxuecheng.conf')
original=nginx.read_text()
backup=root/'backups'/('nginx-'+time.strftime('%Y%m%d-%H%M%S')+'.conf')
backup.write_text(original);os.chmod(backup,0o600)
include='    include /etc/nginx/codex-remote.locations.conf;'
anchor='    listen 10.1.0.7:443 ssl;\n    server_name daxuechengminiapp.site;'
if include not in original:
 if original.count(anchor)!=1:raise RuntimeError('HTTPS gateway layout changed; refusing automatic edit')
 nginx.write_text(original.replace(anchor,anchor+'\n'+include))
shutil.copyfile(release/'nginx.locations.conf','/etc/nginx/codex-remote.locations.conf')
test=subprocess.run(['nginx','-t'],capture_output=True,text=True)
if test.returncode:
 nginx.write_text(original);raise RuntimeError('Nginx validation failed; original restored: '+test.stderr)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','codex-remote.service'],check=True,capture_output=True)
subprocess.run(['systemctl','restart','codex-remote.service'],check=True)
for _ in range(20):
 r=subprocess.run(['curl','--fail','--silent','http://127.0.0.1:28787/health'],capture_output=True,text=True)
 if r.returncode==0:break
 time.sleep(.3)
else:raise RuntimeError('Relay did not become healthy; gateway not reloaded')
subprocess.run(['systemctl','reload','nginx'],check=True)
print(json.dumps({'relay':json.loads(r.stdout),'nginx_config_valid':True,'gateway_reloaded':True,'free_bytes':shutil.disk_usage('/').free,'backup':str(backup)}))

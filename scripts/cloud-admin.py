"""Remoteapp deployment transport. Credentials are read locally, never printed/copied."""
import pathlib,re,sys,json,paramiko
sys.stdout.reconfigure(encoding='utf8')
source=pathlib.Path('C:/Users/18386/Documents/大学诚/本地云服务器与异地组网说明.md').read_text(encoding='utf8')
def field(label):
    match=re.search(r'\|\s*'+re.escape(label)+r'\s*\|\s*`([^`]+)`',source)
    if not match:raise RuntimeError('Missing deployment field: '+label)
    return match[1]
private=pathlib.Path('E:/Codex/content/secure/remoteapp');private.mkdir(parents=True,exist_ok=True)
known=private/'known_hosts'
if not known.exists():known.touch()
client=paramiko.SSHClient();client.load_host_keys(str(known));client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    for host in [field('NetBird IP'),field('公网 IP')]:
        try:client.connect(host,username=field('SSH 用户'),password=field('SSH 密码'),timeout=8,auth_timeout=8,look_for_keys=False,allow_agent=False);break
        except (TimeoutError,OSError):continue
    if not client.get_transport() or not client.get_transport().is_active():raise RuntimeError('SSH unavailable')
    if sys.argv[1]=='audit':
        commands={
          'host':'hostname; cat /etc/os-release | head -4',
          'capacity':'df -h /; free -m',
          'runtime':'command -v node; node --version; command -v docker; docker --version; nginx -v',
          'services':'systemctl is-active nginx docker daxuecheng-api daxuecheng-release-api; ss -lntp',
          'gateway':"sed -n '/server_name/p; /listen /p; /location /p; /include /p; /proxy_pass /p; /ssl_certificate/p' /etc/nginx/conf.d/daxuecheng.conf",
        }
        for name,command in commands.items():
            _,out,err=client.exec_command(command,timeout=15)
            print(json.dumps({'check':name,'output':out.read().decode()+err.read().decode()},ensure_ascii=False))
    elif sys.argv[1]=='run':
        script=pathlib.Path(sys.argv[2]).read_bytes()
        stdin,out,err=client.exec_command('python3 -',timeout=90)
        stdin.write(script.decode());stdin.channel.shutdown_write()
        output=out.read().decode();errors=err.read().decode();status=out.channel.recv_exit_status()
        print(output);print(errors,file=sys.stderr)
        if status:raise SystemExit(status)
    elif sys.argv[1]=='put':
        with client.open_sftp() as ftp:ftp.put(sys.argv[2],sys.argv[3])
        print('Uploaded deployment artifact')
    elif sys.argv[1]=='stage-relay':
        _,out,err=client.exec_command('install -d -m 755 /srv/codex-remote; install -d -m 700 /srv/codex-remote/state',timeout=15)
        if out.channel.recv_exit_status():raise RuntimeError('Could not prepare isolated relay directory')
        with client.open_sftp() as ftp:
            ftp.put('artifacts/cloud-relay-0.3.0.tar.gz','/srv/codex-remote/incoming.tar.gz')
            for name in ['bridge-token','devices.json']:
                local=pathlib.Path('.state')/name
                if not local.exists():continue
                remote='/srv/codex-remote/state/'+name
                try:
                    with ftp.open(remote,'rb') as existing: prior=existing.read()
                    if name=='bridge-token' and prior!=local.read_bytes():raise RuntimeError('Existing cloud identity differs; refusing overwrite')
                except FileNotFoundError:
                    ftp.put(str(local),remote);ftp.chmod(remote,0o600)
        print('Staged relay bundle and protected device state; no credentials printed')
    elif sys.argv[1]=='publish-apk':
        import hashlib
        version=sys.argv[2] if len(sys.argv)>2 else '0.3.0'
        if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',version):raise RuntimeError('Invalid artifact version')
        local=pathlib.Path('E:/Codex/content/releases/remoteapp/20261106')/('codex-remote-'+version+'.apk')
        digest=hashlib.file_digest(local.open('rb'),'sha256').hexdigest()
        remote='/srv/codex-remote/downloads/codex-remote-'+version+'.apk'
        with client.open_sftp() as ftp:ftp.put(str(local),remote+'.part')
        verify="""import pathlib,hashlib,json,os
p=pathlib.Path('/srv/codex-remote/downloads/codex-remote-0.3.0.apk.part')
h=hashlib.file_digest(p.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else hashlib.sha256(p.read_bytes()).hexdigest()
assert h==EXPECTED
p.replace(p.with_suffix(''))
dest=p.with_suffix('');os.chmod(dest,0o644)
(dest.parent/'codex-remote-0.3.0.sha256').write_text(h+'  '+dest.name+chr(10))
print(json.dumps({'published':True,'sha256':h,'size':dest.stat().st_size}))
""".replace('0.3.0',version).replace('EXPECTED',repr(digest))
        stdin,out,err=client.exec_command('python3 -',timeout=30);stdin.write(verify);stdin.channel.shutdown_write()
        output=out.read().decode();errors=err.read().decode()
        if out.channel.recv_exit_status():raise RuntimeError('Publication failed: '+errors)
        print(output)
    elif sys.argv[1]=='archive-old-runner':
        import tarfile,hashlib
        backup=pathlib.Path('E:/Codex/content/backups/remoteapp-server-predeploy-20261106')
        backup.mkdir(parents=True,exist_ok=True)
        target=backup/'runner-externals-2.337.0.tar.gz'
        _,out,err=client.exec_command('tar -czf - -C /opt/actions-runner externals.2.337.0',timeout=180)
        with target.open('wb') as dest:
            while chunk:=out.read(1024*1024):dest.write(chunk)
        if out.channel.recv_exit_status():raise RuntimeError('Runner archive failed')
        with tarfile.open(target) as archive:
            if not all(n.name=='externals.2.337.0' or n.name.startswith('externals.2.337.0/') for n in archive):raise RuntimeError('Unexpected archive path')
        digest=hashlib.file_digest(target.open('rb'),'sha256').hexdigest()
        (backup/'SHA256.txt').write_text(digest+'  '+target.name+'\n')
        prune="""import pathlib,shutil,json
root=pathlib.Path('/opt/actions-runner'); old=root/'externals.2.337.0'
assert old.resolve()==old and old.parent==root and old.is_dir() and not old.is_symlink()
assert (root/'externals').resolve()!=old
for p in pathlib.Path('/proc').iterdir():
 if p.name.isdigit():
  try:
   assert str(old) not in str((p/'exe').resolve())
   assert str(old).encode() not in (p/'cmdline').read_bytes()
  except (FileNotFoundError,PermissionError,ProcessLookupError):pass
shutil.rmtree(old)
print(json.dumps({'old_upgrade_cache_removed':True,'free_bytes':shutil.disk_usage('/').free}))
"""
        stdin,out,err=client.exec_command('python3 -',timeout=40);stdin.write(prune);stdin.channel.shutdown_write()
        output=out.read().decode();errors=err.read().decode()
        if out.channel.recv_exit_status():raise RuntimeError('Guarded cache cleanup failed: '+errors)
        print(json.dumps({'backup':str(target),'sha256':digest,'remote':output.strip()}))
finally:client.close()

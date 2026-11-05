"""Fetch exact SDK archives from Google's repository and verify repository SHA-1."""
import pathlib,urllib.request,xml.etree.ElementTree as ET,hashlib,time,zipfile
cache=pathlib.Path('E:/Codex/content/tools')
root=pathlib.Path('E:/AndroidSDK').resolve()
tree=ET.fromstring((cache/'remoteapp-sdk-repository.xml').read_bytes())
for package_id,target in [('ndk;27.1.12297006',root/'ndk'/'27.1.12297006'),('build-tools;36.0.0',root/'build-tools'/'36.0.0'),('cmake;3.22.1',root/'cmake'/'3.22.1')]:
 if (target/'source.properties').exists():continue
 pkg=next(p for p in tree.findall('remotePackage') if p.get('path')==package_id)
 archive=next(a.find('complete') for a in pkg.findall('./archives/archive') if a.findtext('host-os')=='windows')
 name=archive.findtext('url');expected=archive.findtext('checksum');dest=cache/name
 for attempt in range(8):
  try:
   start=dest.stat().st_size if dest.exists() else 0
   if start==int(archive.findtext('size')):break
   req=urllib.request.Request('https://mirrors.cloud.tencent.com/AndroidSDK/'+name,headers={'Range':f'bytes={start}-'})
   with urllib.request.urlopen(req,timeout=30) as response:
    mode='ab' if response.status==206 else 'wb'
    with dest.open(mode) as output:
     last=time.monotonic()
     while data:=response.read(1024*1024):
      output.write(data)
      if time.monotonic()-last>15:print(name,output.tell(),flush=True);last=time.monotonic()
   break
  except Exception as e:print(name,type(e).__name__,flush=True);time.sleep(1)
 digest=hashlib.file_digest(dest.open('rb'),'sha1').hexdigest()
 if digest!=expected:raise RuntimeError('SDK_CHECKSUM_MISMATCH '+name)
 target=target.resolve()
 if not target.is_relative_to(root):raise RuntimeError('INVALID_SDK_TARGET')
 target.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(dest) as z:
  for info in z.infolist():
   rel=pathlib.PurePosixPath(info.filename)
   if name.startswith('cmake'):rel=pathlib.PurePosixPath('root')/rel
   if len(rel.parts)<2:continue
   out=(target/pathlib.Path(*rel.parts[1:])).resolve()
   if not out.is_relative_to(target):raise RuntimeError('INVALID_ARCHIVE_PATH')
   if info.is_dir():out.mkdir(parents=True,exist_ok=True)
   else:out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(z.read(info))
 print('Installed',package_id,flush=True)

import concurrent.futures,pathlib,urllib.request,time,hashlib
root=pathlib.Path('E:/Codex/content/tools/remoteapp-ndk-parts');root.mkdir(exist_ok=True)
total=781495902;block=4*1024*1024
def fetch(index):
 start=index*block;end=min(start+block,total)-1;target=root/str(index)
 if target.exists() and target.stat().st_size==end-start+1:return
 for attempt in range(12):
  try:
   req=urllib.request.Request('https://mirrors.cloud.tencent.com/AndroidSDK/android-ndk-r27b-windows.zip',headers={'Range':f'bytes={start}-{end}'})
   with urllib.request.urlopen(req,timeout=30) as response:
    if response.status!=206 or response.getheader('Content-Range')!=f'bytes {start}-{end}/{total}':raise RuntimeError('INVALID_RANGE')
    with target.open('wb') as f:
     while data:=response.read(256*1024):f.write(data)
   if target.stat().st_size!=end-start+1:raise RuntimeError('TRUNCATED_RANGE')
   return
  except Exception as e:
   if attempt==11:raise
   time.sleep(1)
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as executor:
 futures=[executor.submit(fetch,i) for i in range((total+block-1)//block)]
 done=0
 for f in concurrent.futures.as_completed(futures):
  f.result();done+=1
  if done%8==0:print('NDK parts',done,'/',len(futures),flush=True)
dest=pathlib.Path('E:/Codex/content/tools/android-ndk-r27b-windows.zip')
with dest.open('wb') as f:
 for i in range(len(futures)):
  with (root/str(i)).open('rb') as part:
   while data:=part.read(1024*1024):f.write(data)
if hashlib.file_digest(dest.open('rb'),'sha1').hexdigest()!='3bb7efc850cd0af7707854b7e0d5c3b6a7153703':raise RuntimeError('NDK_CHECKSUM_MISMATCH')
print('NDK official checksum verified',flush=True)

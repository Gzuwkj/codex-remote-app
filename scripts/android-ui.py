"""Acceptance helper for the dedicated com.remoteapp.test Android app only."""
import subprocess,xml.etree.ElementTree as ET,sys,re,pathlib,shlex,os
sys.stdout.reconfigure(encoding='utf8')
ADB='E:/AndroidSDK/platform-tools/adb.exe'
SERIAL=os.environ.get('REMOTEAPP_ADB_SERIAL','emulator-5570')
if SERIAL not in ['emulator-5570','emulator-5572']:raise RuntimeError('INVALID_EMULATOR')
PACKAGE=os.environ.get('REMOTEAPP_UI_PACKAGE','com.remoteapp.test')
if PACKAGE not in ['com.remoteapp.test','com.remoteapp.mobile']:raise RuntimeError('INVALID_TEST_TARGET')
def run(*args):return subprocess.run([ADB,'-s',SERIAL,*args],capture_output=True,encoding='utf8',check=True).stdout
def nodes():
 run('shell','uiautomator','dump','/sdcard/remoteapp-state.xml')
 root=ET.fromstring(run('shell','cat','/sdcard/remoteapp-state.xml'))
 if not any(n.get('package')==PACKAGE for n in root.iter('node')):raise RuntimeError('TEST_APP_NOT_VISIBLE')
 return list(root.iter('node'))
args=sys.argv[1:]
if args and args[0] in ['tap','input','clear']:
 matches=[n for n in nodes() if args[1] in [n.get('text'),n.get('content-desc')]]
 if not matches:raise RuntimeError('UI_ELEMENT_NOT_FOUND '+args[1])
 n=next((n for n in matches if n.get('clickable')=='true'),matches[0]);x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds')))
 run('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))
 if args[0] in ['input','clear']:
  if n.get('class')!='android.widget.EditText':raise RuntimeError('NOT_EDITABLE')
  run('shell','input','keycombination','113','29')
  if args[0]=='clear':run('shell','input','keyevent','67')
  else:run('shell','input','text',shlex.quote(args[2].replace(' ','%s')))

elif args and args[0]=='swipe':run('shell','input','swipe','500','1200','500','450','350')
elif args and args[0]=='screenshot':
 nodes();target=pathlib.Path(args[1]).resolve();allowed=pathlib.Path('E:/Codex/content/repos/remoteapp/artifacts').resolve()
 if not target.is_relative_to(allowed):raise RuntimeError('INVALID_OUTPUT')
 target.parent.mkdir(parents=True,exist_ok=True)
 target.write_bytes(subprocess.check_output([ADB,'-s',SERIAL,'exec-out','screencap','-p']));print(target);sys.exit()
for n in nodes():
 text=n.get('text')or n.get('content-desc')
 if text:print(('<redacted>' if n.get('content-desc')=='配对码' else text[:180]),n.get('bounds'))

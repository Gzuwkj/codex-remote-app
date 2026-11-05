import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const token=fs.readFileSync('.state/admin-token','utf8').trim();
const env={...process.env,REMOTEAPP_UI_PACKAGE:'com.remoteapp.mobile'};
const ui=(...args)=>execFileSync('python',['scripts/android-ui.py',...args],{env,encoding:'utf8',maxBuffer:1024*1024});
const profile=path.resolve('artifacts/qa-control-browser');
let browser,code='';
try {
  browser=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1100,height:850},env:{...process.env,TEMP:path.resolve('artifacts'),TMP:path.resolve('artifacts')}});
  const page=browser.pages()[0]??await browser.newPage();
  await page.goto('http://127.0.0.1:18887/#'+token);
  await page.waitForFunction(()=>document.querySelector('#connection')?.textContent?.startsWith('已连接云端中转'));
  const before=await (await fetch('http://127.0.0.1:18887/api/status',{headers:{Authorization:'Bearer '+token}})).json();
  await page.getByRole('button',{name:'刷新配对码',exact:true}).click();
  await page.waitForFunction(previous=>{
    const value=document.querySelector('#code')?.textContent??'';
    return /^\d{6}$/.test(value)&&value!==previous;
  },before.pairCode);
  code=(await page.locator('#code').textContent()).trim();
  ui('input','配对码',code);
  ui('tap','开始配对');
  await page.getByRole('button',{name:'允许连接',exact:true}).waitFor({state:'visible',timeout:20000});
  await page.getByRole('button',{name:'允许连接',exact:true}).click();
  await page.waitForFunction(count=>document.querySelector('#devices')?.children.length>count,before.devices.length,{timeout:20000});
  await page.screenshot({path:'artifacts/cloud-pairing-control.png',mask:[page.locator('#code')],fullPage:true});
  const after=await (await fetch('http://127.0.0.1:18887/api/status',{headers:{Authorization:'Bearer '+token}})).json();
  console.log(JSON.stringify({desktopControlOpened:true,phoneRequested:true,desktopConfirmed:true,devicesBefore:before.devices.length,devicesAfter:after.devices.length}));
} catch(error) {
  let message=String(error?.stack??error).replaceAll(token,'<redacted>');
  if(code)message=message.replaceAll(code,'<pair-code>');
  console.error(message);process.exitCode=1;
} finally { await browser?.close(); }

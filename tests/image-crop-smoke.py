#!/usr/bin/env python3
"""Crop real image pixels with mouse/touch; no screenshots or images leave the browser."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:5500')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
BASE = args.base.rstrip('/')
FIXTURE = '''<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/frontend/src/assets/css/variables.css">
<link rel="stylesheet" href="/frontend/src/assets/css/base.css">
<link rel="stylesheet" href="/frontend/src/assets/css/components.css">
<link rel="stylesheet" href="/frontend/src/assets/css/tutor-attachments.css">
</head><body><button id="openCrop">Chọn vùng ảnh</button><button id="background">Nội dung bài học</button>
<script type="module">
import {createImageCropper} from '/frontend/src/modules/learning/ImageCropper.js';
window.cropper=createImageCropper({document});window.cropDone=false;window.cropResult=null;
window.makePattern=()=>new Promise(resolve=>{const c=document.createElement('canvas');c.width=800;c.height=400;const g=c.getContext('2d');
 for(const [color,x,y] of [['#ef2020',0,0],['#20d020',400,0],['#2020ef',0,200],['#efd020',400,200]]){g.fillStyle=color;g.fillRect(x,y,400,200)}c.toBlob(resolve,'image/png')});
window.openCrop=async()=>{window.cropDone=false;window.cropResult=null;window.cropAbort=new AbortController();window.cropResult=await cropper.edit(await makePattern(),{signal:cropAbort.signal});window.cropDone=true};
document.querySelector('#openCrop').onclick=window.openCrop;
window.readResult=async()=>{
 if(!cropResult)return null;const b=await createImageBitmap(cropResult),c=document.createElement('canvas');c.width=b.width;c.height=b.height;const g=c.getContext('2d');g.drawImage(b,0,0);
 const sample=(x,y)=>[...g.getImageData(Math.min(c.width-1,x),Math.min(c.height-1,y),1,1).data].slice(0,3);
 const result={width:c.width,height:c.height,center:sample(Math.floor(c.width/2),Math.floor(c.height/2)),corners:[sample(2,2),sample(c.width-3,2),sample(2,c.height-3),sample(c.width-3,c.height-3)]};b.close();return result;
};
</script></body></html>'''


def require(value, message):
    if not value:
        raise AssertionError(message)


def stage(page):
    surface = page.locator('#imgCropSurface')
    expect(surface).to_be_visible()
    return surface.bounding_box()


def select_area(page, start, end, touch=False):
    box = stage(page)
    sx, sy = box['x'] + box['width'] * start[0], box['y'] + box['height'] * start[1]
    ex, ey = box['x'] + box['width'] * end[0], box['y'] + box['height'] * end[1]
    if touch:
        page.locator('#imgCropSurface').evaluate('''(surface,p)=>{
            const common={bubbles:true,cancelable:true,pointerId:41,pointerType:'touch',isPrimary:true};
            surface.dispatchEvent(new PointerEvent('pointerdown',{...common,clientX:p[0],clientY:p[1],buttons:1}));
            surface.dispatchEvent(new PointerEvent('pointermove',{...common,clientX:p[2],clientY:p[3],buttons:1}));
            surface.dispatchEvent(new PointerEvent('pointerup',{...common,clientX:p[2],clientY:p[3],buttons:0}));
        }''', [sx, sy, ex, ey])
    else:
        page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(ex, ey, steps=8); page.mouse.up()
    return box


results = []
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    for mobile in [False, True]:
        context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1280, 'height': 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=3 if mobile else 1.25)
        page = context.new_page(); errors = []; outside = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def route_request(route):
            if route.request.url == BASE + '/crop-fixture.html':route.fulfill(content_type='text/html', body=FIXTURE)
            elif route.request.url.startswith(BASE):route.continue_()
            else:outside.append(route.request.url);route.abort()
        context.route('**/*', route_request)
        page.goto(BASE + '/crop-fixture.html', wait_until='domcontentloaded')
        page.wait_for_function('window.cropper !== undefined')
        page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible();expect(page.locator('#imgCropConfirm')).to_be_disabled()
        select_area(page, (.05,.1), (.45,.4), touch=mobile)
        expect(page.locator('#imgCropConfirm')).to_be_enabled()
        page.screenshot(path='/tmp/strobot-crop-'+('mobile' if mobile else 'desktop')+'.png',full_page=True)
        page.locator('#imgCropConfirm').click();page.wait_for_function('window.cropDone')
        result = page.evaluate('window.readResult()')
        require(abs(result['width']-320)<=3 and abs(result['height']-120)<=3, 'Displayed-to-original coordinate scaling failed: '+str(result))
        require(all(red>180 and green<90 and blue<90 for red,green,blue in result['corners']+[result['center']]), 'Export contains pixels outside the selected red region: '+str(result))
        # Resize a selected region, including a touch handle on a high-DPI viewport.
        page.locator('#openCrop').click();select_area(page,(.1,.1),(.3,.3),touch=mobile)
        handle=page.locator('[data-crop-handle="se"]');expect(handle).to_be_visible()
        box=stage(page);h=handle.bounding_box();sx=h['x']+h['width']/2;sy=h['y']+h['height']/2;ex=box['x']+box['width']*.45;ey=box['y']+box['height']*.4
        if mobile:
            handle.evaluate('''(handle,p)=>{
                const c={bubbles:true,cancelable:true,pointerId:42,pointerType:'touch',isPrimary:true};
                handle.dispatchEvent(new PointerEvent('pointerdown',{...c,clientX:p[0],clientY:p[1],buttons:1}));
                document.querySelector('#imgCropSurface').dispatchEvent(new PointerEvent('pointermove',{...c,clientX:p[2],clientY:p[3],buttons:1}));
                document.querySelector('#imgCropSurface').dispatchEvent(new PointerEvent('pointerup',{...c,clientX:p[2],clientY:p[3],buttons:0}));
            }''',[sx,sy,ex,ey])
        else:
            page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(ex,ey,steps=8);page.mouse.up()
        require(abs(float(page.locator('#imgCropWidth').input_value())-280)<=3 and abs(float(page.locator('#imgCropHeight').input_value())-120)<=3,'Resize handle did not adjust original-pixel selection')
        page.locator('#imgCropCancel').click();page.wait_for_function('window.cropDone')
        # Numeric controls provide a keyboard-accessible selection independent of drag precision.
        page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible()
        for selector,value in [('#imgCropWidth','200'),('#imgCropHeight','100'),('#imgCropX','450'),('#imgCropY','50')]:
            page.locator(selector).fill(value);page.locator(selector).dispatch_event('change')
        page.locator('#imgCropConfirm').click();page.wait_for_function('window.cropDone')
        keyboard_result=page.evaluate('window.readResult()')
        require(keyboard_result['width']==200 and keyboard_result['height']==100,'Numeric crop dimensions were not applied: '+str(keyboard_result))
        require(all(green>150 and red<90 and blue<90 for red,green,blue in keyboard_result['corners']+[keyboard_result['center']]),'Numeric crop used the wrong source region: '+str(keyboard_result))
        # Full image is an explicit alternative, never the implicit result of opening the editor.
        page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible();page.locator('#imgCropFull').click();page.wait_for_function('window.cropDone')
        full = page.evaluate('window.readResult()');require(full['width']==800 and full['height']==400,'Full-image action changed original dimensions')
        # Reset and cancelling must not export or leave a modal behind.
        page.locator('#openCrop').click();select_area(page,(.1,.1),(.4,.4),touch=mobile);page.locator('#imgCropReset').click();expect(page.locator('#imgCropConfirm')).to_be_disabled();page.locator('#imgCropCancel').click();page.wait_for_function('window.cropDone');require(page.evaluate('window.cropResult===null'),'Cancel exported an image')
        page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible();page.keyboard.press('Escape');page.wait_for_function('window.cropDone');require(page.evaluate('window.cropResult===null'),'Escape exported an image')
        page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible();page.evaluate('window.cropAbort.abort()');page.wait_for_function('window.cropDone');expect(page.locator('#imgCropDialog')).to_be_hidden();require(page.evaluate('window.cropResult===null'),'Abort exported an image')
        if mobile:
            page.locator('#openCrop').click();expect(page.locator('#imgCropDialog')).to_be_visible()
            page.set_viewport_size({'width':390,'height':420})
            page.wait_for_function('''() => {const r=document.querySelector('#imgCropDialog').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}''')
            page.locator('#imgCropWidth').fill('200');page.locator('#imgCropHeight').fill('100')
            page.locator('#imgCropConfirm').scroll_into_view_if_needed();expect(page.locator('#imgCropConfirm')).to_be_in_viewport()
            page.locator('#imgCropCancel').click();page.wait_for_function('window.cropDone')
            page.set_viewport_size({'width':390,'height':844})
        require(page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'Crop editor caused horizontal overflow')
        require(not errors,'Crop browser errors: '+str(errors));require(not outside,'Crop attempted external traffic')
        results.append({'mobile':mobile,'selection_pixels':result,'full_image':{'width':full['width'],'height':full['height']},'resize_handle':True,'numeric_keyboard_region':True,'cancel_escape_abort':True,'outside_requests':len(outside)})
        context.close()
    browser.close()
print(json.dumps({'checks':results,'physical_devices_tested':False,'browser':'Chromium'},ensure_ascii=False))
print('PASS crop editor: original pixels, mouse/touch mapping, explicit full image, reset/cancel/Escape/abort and responsive layout; no network uploads')

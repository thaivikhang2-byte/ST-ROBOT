#!/usr/bin/env python3
"""Real lesson attachment UI, using image/capture fixtures and no paid requests."""
import argparse
import base64
import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base', default='http://127.0.0.1:8000')
parser.add_argument('--chromium', default='/usr/bin/chromium')
args = parser.parse_args()
BASE = args.base.rstrip('/')
AI = 'https://st-robot-1.onrender.com'
REPLY = 'Kiểm tra dây nối và đối chiếu thông báo lỗi trong ảnh.'


def require(value, message):
    if not value:
        raise AssertionError(message)


# A real two-track MediaStream exercises video readiness and stopping every track.
# Canvas frames keep advancing until both tracks have stopped.
CAPTURE_MOCK = '''mode => {
    window.captureMode=mode; window.captureOptions=[]; window.captureTracks=[];
    window.makeCaptureStream=()=>{
        const [width,height]=window.captureDimensions?.[window.captureTracks.length/2]||[640,360];
        const canvases=[document.createElement('canvas'),document.createElement('canvas')];
        const tracks=canvases.map((canvas,index)=>{
            canvas.width=width;canvas.height=height;
            const ctx=canvas.getContext('2d');ctx.fillStyle=index?'#fff':'#1e40af';ctx.fillRect(0,0,width,height);
            const track=canvas.captureStream(30).getVideoTracks()[0],original=track.stop.bind(track);
            track.stop=()=>{track.testStops=(track.testStops||0)+1;original()};
            return track;
        });
        let tick=0;const timer=setInterval(()=>{
            canvases.forEach(canvas=>{const ctx=canvas.getContext('2d');ctx.fillStyle=tick++%2?'#1e40af':'#2563eb';ctx.fillRect(0,0,width,height)});
            if(tracks.every(track=>track.readyState==='ended'))clearInterval(timer);
        },30);
        window.captureTracks.push(...tracks);return new MediaStream(tracks);
    };
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:options=>{
        window.captureOptions.push(options);
        if(window.captureMode==='deny')return Promise.reject(new DOMException('Cancelled fixture','NotAllowedError'));
        if(window.captureMode==='defer')return new Promise(resolve=>window.resolveCapture=()=>resolve(window.makeCaptureStream()));
        return Promise.resolve(window.makeCaptureStream());
    }});
}'''


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.set_default_timeout(10000)
    errors, posts = [], []
    mode = {'reply': 'ok'}
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route_request(route):
        parsed = urlparse(route.request.url)
        origin = f'{parsed.scheme}://{parsed.netloc}'
        if origin == AI and route.request.method == 'OPTIONS':
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'})
        elif origin == AI and parsed.path == '/health':
            route.fulfill(content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body='{"ok":true,"ai":{"keyConfigured":true}}')
        elif origin == AI and parsed.path == '/api/tutor':
            posts.append(route.request.post_data_json)
            data = {'reply': REPLY} if mode['reply'] == 'ok' else {'error': 'Ảnh chưa phân tích được, hãy thử lại.', 'code': 'AI_IMAGE_INVALID', 'retryable': False}
            route.fulfill(status=200 if mode['reply'] == 'ok' else 400, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps(data, ensure_ascii=False))
        elif origin == BASE:
            route.continue_()
        else:
            route.abort()

    context.route('**/*', route_request)
    page.goto(BASE + '/frontend/public/course.learning.html?course=arduino')
    page.wait_for_function('window.STROBOT_TUTOR_ATTACHMENTS && window.STROBOT_FLOATING_TUTOR')
    expect(page.locator('#tutorPanel')).to_be_hidden()
    page.locator('#tutorLauncher').click()
    page.locator('#learningLevel').select_option('advanced')
    image_url = page.evaluate('''() => {
        const canvas=document.createElement('canvas');canvas.width=2560;canvas.height=1440;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2560,1440);
        ctx.fillStyle='#123';ctx.font='60px sans-serif';ctx.fillText('Arduino error fixture',80,150);
        return canvas.toDataURL('image/png');
    }''')
    image_file = {'name': 'arduino-error.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(image_url.split(',')[1])}
    previews = page.locator('#tutorAttachments figure')
    attachment_status = page.locator('#tutorAttachmentStatus')
    send = page.locator('#tutorSend')

    def upload():
        page.locator('#tutorImageInput').set_input_files(image_file)
        expect(send).to_be_enabled()

    def stop_assertion():
        page.wait_for_function('captureTracks.length===2 && captureTracks.every(track=>track.readyState==="ended" && track.testStops>=1)')

    upload()
    expect(previews).to_have_count(1)
    dimensions = previews.locator('img').evaluate('e=>({width:e.naturalWidth,height:e.naturalHeight,src:e.src})')
    require(dimensions['width'] == 1600 and dimensions['height'] == 900 and dimensions['src'].startswith('data:image/jpeg;base64,'), 'Upload was not normalized to bounded JPEG')
    require(not posts, 'Selecting an image sent an API request before explicit submission')
    # The ordinary paste event works inside the form without clipboard permission.
    page.locator('#tutorQuestion').evaluate('''(input,url)=>{
        const bytes=Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0));
        const data=new DataTransfer();data.items.add(new File([bytes],'pasted.png',{type:'image/png'}));
        input.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    }''', image_url)
    expect(previews).to_have_count(2)
    upload()
    expect(attachment_status).to_contain_text('tối đa 2 ảnh')
    expect(previews).to_have_count(2)
    page.evaluate(CAPTURE_MOCK, 'ok')
    page.locator('#tutorCapture').click()
    expect(attachment_status).to_contain_text('tối đa 2 ảnh')
    require(page.evaluate('captureOptions.length===0 && captureTracks.length===0'), 'Full attachment list still opened a screen picker')
    previews.first.get_by_role('button').click()
    expect(previews).to_have_count(1)
    require(not posts, 'Pasting or removing a preview sent an API request')
    question = 'Giải thích **lỗi này** và giữ count += presses.'
    page.locator('#tutorQuestion').fill(question)
    send.click()
    expect(page.locator('#tutorMessages')).to_contain_text(REPLY)
    expect(send).to_be_enabled()
    expect(previews).to_have_count(0)
    require(len(posts) == 1 and posts[0]['question'] == question and posts[0]['history'] == [], 'Image submission changed raw question/history')
    require(posts[0]['course'] == 'arduino' and posts[0]['lesson'] == 'led' and posts[0]['learningLevel'] == 'advanced' and posts[0]['platformKey'], 'Image submission lost lesson/platform/level context')
    require(len(posts[0]['images']) == 1 and set(posts[0]['images'][0]) == {'dataUrl'} and posts[0]['images'][0]['dataUrl'].startswith('data:image/jpeg;base64,'), 'Image API payload changed or included browser-only metadata')
    expect(page.locator('#tutorMessages .chat-message.user img')).to_have_count(1)
    page.locator('#tutorQuestion').fill('Câu hỏi tiếp theo.')
    send.click()
    expect(page.locator('#tutorMessages .chat-message:not(.user)')).to_have_count(2)
    require('images' not in posts[1] and posts[1]['history'] == [{'role': 'user', 'content': question}, {'role': 'assistant', 'content': REPLY}], 'Image leaked into later text-only history')
    # A failed reply keeps the draft images and question for retry.
    upload()
    expect(previews).to_have_count(1)
    mode['reply'] = 'fail'
    page.locator('#tutorQuestion').fill('Đối chiếu lại ảnh.')
    send.click()
    expect(page.locator('#tutorStatus')).to_contain_text('Ảnh chưa phân tích được')
    expect(previews).to_have_count(1)
    expect(page.locator('#tutorQuestion')).to_have_value('Đối chiếu lại ảnh.')
    page.locator('#tutorReset').click()
    expect(previews).to_have_count(0)
    # The clipboard button also supports permission-granted browser clipboard reads.
    page.evaluate('''url=>{
        const blob=new Blob([Uint8Array.from(atob(url.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'});
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>[{types:['image/png'],getType:async()=>blob}]}});
    }''', image_url)
    page.locator('#tutorPaste').click()
    expect(previews).to_have_count(1)
    page.locator('#tutorReset').click()
    page.evaluate(CAPTURE_MOCK, 'ok')
    page.locator('#tutorCapture').click()
    expect(previews).to_have_count(1)
    stop_assertion()
    require(page.evaluate('captureOptions[0].audio===false && captureOptions[0].video.displaySurface==="browser"'), 'Capture requested unexpected media')
    require(page.locator('#tutorPanel').evaluate('e=>e.style.visibility') == '' and page.locator('#tutorLauncher').evaluate('e=>e.style.visibility') == '', 'Capture left the tutor invisible')
    require(page.locator('body > video').count() == 0, 'Capture left its video element behind')
    require(len(posts) == 3, 'Capture sent an image without a form submission')
    page.locator('#tutorReset').click()
    # Cancelling capture A while its encoder is pending must not let A's late
    # callback stop capture B or restore B's temporarily hidden tutor controls.
    page.evaluate(CAPTURE_MOCK, 'ok')
    page.evaluate('''() => {
        window.captureDimensions=[[480,270],[640,360]];
        window.captureBlobs=[];window.originalCaptureToBlob=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(callback,...args){
            const index=captureBlobs.length,entry={ready:false,released:false};captureBlobs.push(entry);
            return originalCaptureToBlob.call(this,blob=>{
                entry.ready=true;
                entry.release=()=>{entry.released=true;callback(blob)};
                if(index>=2)entry.release();
            },...args);
        };
    }''')
    page.locator('#tutorCapture').click()
    page.wait_for_function('captureBlobs[0]?.ready && captureTracks.length===2')
    # The controls are hidden while a screenshot is being encoded, so invoke the
    # same close action directly rather than clicking an invisible close button.
    page.evaluate('window.STROBOT_FLOATING_TUTOR.close()')
    stop_assertion()
    expect(send).to_be_enabled()
    page.locator('#tutorLauncher').click()
    page.locator('#tutorCapture').click()
    page.wait_for_function('captureBlobs[1]?.ready && captureTracks.length===4')
    preserved = page.evaluate('''async () => {
        captureBlobs[0].release();
        // A's continuation and perform.finally run in this microtask checkpoint.
        await new Promise(resolve=>queueMicrotask(resolve));
        return {
            live:captureTracks.slice(2).every(track=>track.readyState==='live' && !track.testStops),
            hidden:[document.querySelector('#tutorPanel'),document.querySelector('#tutorLauncher')].every(element=>element.style.visibility==='hidden'),
            busy:window.STROBOT_TUTOR_ATTACHMENTS.busy,
            previews:document.querySelectorAll('#tutorAttachments figure').length
        };
    }''')
    require(preserved['live'] and preserved['hidden'] and preserved['busy'] and preserved['previews'] == 0,
            'Cancelled capture A disrupted pending capture B: '+str(preserved))
    page.evaluate('captureBlobs[1].release()')
    expect(previews).to_have_count(1)
    page.wait_for_function('captureTracks.length===4 && captureTracks.every(track=>track.readyState==="ended" && track.testStops>=1)')
    require(previews.locator('img').evaluate('e=>e.naturalWidth===640 && e.naturalHeight===360'), 'Stale capture A replaced the preview from capture B')
    require(page.locator('#tutorPanel').evaluate('e=>e.style.visibility') == '' and page.locator('#tutorLauncher').evaluate('e=>e.style.visibility') == '', 'Capture B did not restore its controls')
    page.evaluate('''() => {
        HTMLCanvasElement.prototype.toBlob=window.originalCaptureToBlob;
        delete window.captureDimensions;delete window.captureBlobs;delete window.originalCaptureToBlob;
    }''')
    page.locator('#tutorReset').click()
    # User cancellation returns to normal controls without a preview or request.
    page.evaluate(CAPTURE_MOCK, 'deny')
    page.locator('#tutorCapture').click()
    expect(attachment_status).to_contain_text('Đã dừng chụp')
    expect(previews).to_have_count(0)
    expect(send).to_be_enabled()
    # Closing while the browser picker is pending stops a subsequently chosen stream.
    page.evaluate(CAPTURE_MOCK, 'defer')
    page.locator('#tutorCapture').click()
    page.wait_for_function('typeof window.resolveCapture === "function"')
    page.locator('#tutorClose').click()
    page.evaluate('window.resolveCapture()')
    stop_assertion()
    page.locator('#tutorLauncher').click()
    expect(previews).to_have_count(0)
    expect(send).to_be_enabled()
    # Changing lessons clears prepared images and also cancels an outstanding picker.
    upload()
    expect(previews).to_have_count(1)
    page.evaluate(CAPTURE_MOCK, 'defer')
    page.locator('#tutorCapture').click()
    page.wait_for_function('typeof window.resolveCapture === "function"')
    page.locator('#lessonList .lesson-item').nth(1).click()
    page.evaluate('window.resolveCapture()')
    stop_assertion()
    expect(previews).to_have_count(0)
    expect(page.locator('#tutorMessages')).to_be_empty()
    # Unsupported capture keeps upload and paste available.
    page.evaluate("Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:undefined})")
    page.locator('#tutorCapture').click()
    expect(attachment_status).to_contain_text('Thêm ảnh hoặc dán ảnh')
    expect(page.locator('#tutorImageInput')).to_be_enabled()
    # Real image form remains within a small keyboard-sized viewport, with a usable
    # message area and textarea; extra image controls scroll inside the form.
    page.set_viewport_size({'width': 375, 'height': 360})
    upload()
    expect(previews).to_have_count(1)
    layout = page.locator('#tutorPanel').evaluate('''panel=>{
        const r=panel.getBoundingClientRect(),q=document.querySelector('#tutorQuestion').getBoundingClientRect(),m=document.querySelector('#tutorMessages').getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,q:q.height,m:m.height,overflow:document.documentElement.scrollWidth>innerWidth};
    }''')
    require(layout['left'] >= 11 and layout['right'] <= 364 and layout['top'] >= 11 and layout['bottom'] <= 349, 'Mobile tutor crossed the visible viewport: '+str(layout))
    require(layout['q'] >= 56 and layout['m'] >= 48 and not layout['overflow'], 'Mobile image form removed usable question/message space: '+str(layout))
    send.scroll_into_view_if_needed()
    expect(send).to_be_in_viewport()
    require(not errors, 'Browser errors: '+json.dumps(errors))
    context.close()
    browser.close()
print('PASS tutor images: upload/paste/remove, JPEG bounds, explicit image request/context, text-only history, failure retry, capture/cancel/late-stream cleanup, stale encoder isolation, full-list capture guard, lesson reset, unsupported capture and mobile form; no paid calls')

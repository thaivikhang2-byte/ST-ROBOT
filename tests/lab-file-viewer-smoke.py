#!/usr/bin/env python3
"""Exercise saved-file viewing without accounts, provider requests or uploads."""
import argparse
import base64
import json
import pathlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5519')
parser.add_argument('--chromium', default='/usr/bin/chromium' if pathlib.Path('/usr/bin/chromium').is_file() else None)
args = parser.parse_args()
base = args.base.rstrip('/')
png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=')
archive = bytes([80, 75, 3, 4, 0, 255, 128, 13, 10])
html = '''<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/frontend/src/assets/css/variables.css"><link rel="stylesheet" href="/frontend/src/assets/css/base.css">
<link rel="stylesheet" href="/frontend/src/assets/css/components.css"><link rel="stylesheet" href="/frontend/src/assets/css/pages/selfstudy.css"></head>
<body class="learning-page"><button id="open">Mở tệp đã lưu</button><script type="module">
import { LabFileViewer } from '/frontend/src/modules/learning/LabFileViewer.js';
window.currentOwner=true; window.viewer=new LabFileViewer(document.body); window.viewerReady=true;
window.objectUrls=new Set();const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=create(blob);objectUrls.add(url);return url};
URL.revokeObjectURL=url=>{objectUrls.delete(url);return revoke(url)};
window.openViewer=(files,extra={})=>viewer.open({files,getBytes:async file=>new Uint8Array(file.bytes),isCurrent:()=>currentOwner,...extra});
</script></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    context = browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
    errors=[]
    def route(request_route):
        parsed=urlparse(request_route.request.url)
        if parsed.path=='/__lab_file_viewer_fixture__.html':
            request_route.fulfill(status=200,content_type='text/html',body=html)
        elif parsed.netloc==urlparse(base).netloc or parsed.scheme in {'data','blob'}:
            request_route.continue_()
        else:request_route.abort()
    context.route('**/*',route)
    page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(base+'/__lab_file_viewer_fixture__.html',wait_until='domcontentloaded')
    page.wait_for_function('window.viewerReady')
    files=[{'id':'image','name':'ket-qua.png','sizeBytes':len(png),'bytes':list(png)},
        {'id':'html','name':'renamed-image.png','bytes':list(b'<script>window.injected=true</script><h1>untrusted</h1>')},
        {'id':'zip','name':'robot.zip','sizeBytes':len(archive),'bytes':list(archive)},
        {'id':'pdf','name':'worksheet.pdf','bytes':list(b'%PDF-1.4\n% local preview fixture')},
        {'id':'large-text','name':'large.txt','bytes':list(b'a'*(512*1024+1))}]
    page.evaluate('files=>openViewer(files)',files)
    dialog=page.locator('[data-lab-file-viewer]')
    expect(dialog).to_be_visible()
    expect(dialog.locator('.lab-file-viewer-choice')).to_have_count(5)
    expect(dialog.locator('.lab-file-viewer-preview')).to_be_empty()
    assert page.evaluate('viewer.bytes === null'), 'Choosing the list must not read any file automatically'
    dialog.get_by_role('button',name='ket-qua.png').click()
    expect(dialog.locator('img')).to_be_visible()
    assert dialog.locator('img').evaluate('(image)=>image.complete && image.naturalWidth === 1')
    dialog.get_by_role('button',name='renamed-image.png').click()
    expect(dialog.locator('.lab-file-viewer-preview pre')).to_contain_text('<script>')
    expect(dialog.locator('.lab-file-viewer-preview img, .lab-file-viewer-preview script')).to_have_count(0)
    assert page.evaluate('window.injected || false') is False
    dialog.get_by_role('button',name='robot.zip').click()
    expect(dialog.locator('.lab-file-viewer-preview')).to_contain_text('giữ nguyên định dạng')
    with page.expect_download() as downloaded:dialog.get_by_role('button',name='Tải tệp',exact=True).click()
    assert downloaded.value.suggested_filename=='robot.zip'
    assert pathlib.Path(downloaded.value.path()).read_bytes()==archive
    dialog.get_by_role('button',name='worksheet.pdf').click()
    expect(dialog.locator('iframe')).to_have_attribute('sandbox','')
    expect(dialog.locator('iframe')).to_have_attribute('referrerpolicy','no-referrer')
    assert dialog.locator('iframe').get_attribute('src').startswith('blob:')
    dialog.get_by_role('button',name='large.txt').click()
    expect(dialog.locator('.lab-file-viewer-preview')).to_contain_text('Tải tệp')
    expect(dialog.locator('.lab-file-viewer-preview pre')).to_have_count(0)
    print('PASS file chooser; raster/text/PDF previews; renamed HTML stays inert; opaque byte-exact download; bounded text',flush=True)

    page.evaluate('''() => openViewer([{id:'private',name:'private.txt'}], {getBytes:()=>new Promise(resolve=>window.releaseOld=()=>resolve(new TextEncoder().encode('old private data')))})''')
    dialog.get_by_role('button',name='private.txt').click()
    page.evaluate('''() => { currentOwner=false; releaseOld(); }''')
    expect(dialog).to_be_hidden()
    assert page.evaluate('viewer.bytes===null && viewer.files.length===0 && objectUrls.size===0')
    page.evaluate('''() => {currentOwner=true;window.loadSignals=[];openViewer([{id:'slow',name:'slow.txt'},{id:'new',name:'new.txt'}],
        {getBytes:(file,{signal})=>{loadSignals.push(signal);return file.id==='slow'?new Promise(resolve=>window.releaseSlow=()=>resolve(new TextEncoder().encode('stale result'))):Promise.resolve(new TextEncoder().encode('new selected result'))}})}''')
    dialog.get_by_role('button',name='slow.txt').click()
    dialog.get_by_role('button',name='new.txt').click()
    expect(dialog.locator('pre')).to_have_text('new selected result')
    assert page.evaluate('loadSignals[0].aborted'), 'Switching files must abort an older download'
    page.evaluate('releaseSlow()')
    expect(dialog.locator('pre')).to_have_text('new selected result')
    page.keyboard.press('Escape')
    expect(dialog).to_be_hidden()
    assert page.evaluate('viewer.bytes===null && viewer.files.length===0 && objectUrls.size===0')
    # A native close event queued by an old modal must not clear a newly opened one.
    page.evaluate('''() => {openViewer([]);viewer.close();openViewer([],{
        notes:'<img src=x onerror="window.injected=true">',code:'print("saved")',sourceName:'main.py',
        projectUrl:'javascript:alert(1)',savedAt:'2026-11-25T08:00:00Z'})}''')
    expect(dialog).to_be_visible()
    expect(dialog.locator('.lab-file-viewer-record')).to_be_visible()
    expect(dialog.locator('.lab-file-viewer-notes')).to_contain_text('<img')
    expect(dialog.locator('.lab-file-viewer-record img, .lab-file-viewer-record a')).to_have_count(0)
    expect(dialog.locator('.lab-file-viewer-record pre')).to_have_text('print("saved")')
    assert page.evaluate('window.injected || false') is False
    print('PASS delayed selection/owner isolation, Escape cleanup, Blob revocation and saved-note/source separation',flush=True)

    for width in [390,1440]:
        page.set_viewport_size({'width':width,'height':1000})
        page.evaluate('files=>openViewer(files)',files[:3])
        dialog.get_by_role('button',name='ket-qua.png').click()
        expect(dialog.locator('img')).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1')
        bounds=dialog.bounding_box();assert bounds and bounds['width']<=width
        page.screenshot(path=f'/tmp/strobot-file-viewer-{width}.png')
    page.evaluate('viewer.destroy()')
    expect(dialog).to_have_count(0)
    assert page.evaluate('objectUrls.size===0')
    assert not errors,errors
    browser.close()
print('PASS saved-file viewer desktop/mobile layout and complete destroy cleanup')

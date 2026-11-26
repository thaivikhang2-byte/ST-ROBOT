#!/usr/bin/env python3
"""Exercise public-first lessons and owner-bound lab drafts; no external accounts or AI."""
import argparse
import base64
import io
import json
import pathlib
import zipfile
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5518')
parser.add_argument('--chromium', default='/usr/bin/chromium' if pathlib.Path('/usr/bin/chromium').is_file() else None)
args = parser.parse_args()
base = args.base.rstrip('/')
fixture = r'''
export const LEARNER_KEYS=['strobot.original.course.v3'];
export const learnerSync={ownerId:null,status:{status:'synced',message:'Fixture account synchronized'},
 ready(){return window.__fixtureGate ||=new Promise(resolve=>window.__openWorkspace=owner=>{this.ownerId=owner;resolve(owner)})},
 hasTabDrafts(){return false},recordActivity(){},sync(){return this.status}};
window.__fixtureSync=learnerSync;
export function getLearnerStorage(){const ownerId=learnerSync.ownerId;return {ownerId,
 getItem:key=>localStorage.getItem((ownerId?'fixture.owner.'+ownerId+'.':'')+key),
 setItem:(key,value)=>localStorage.setItem((ownerId?'fixture.owner.'+ownerId+'.':'')+key,value)}};
'''
file_store_fixture = r'''
export const LAB_ATTACHMENT_LIMITS={fileBytes:26214400,accountBytes:262144000,filesPerLab:50,filesPerAccount:500,chunkBytes:1048576};
export function validateLabAttachment(file){if(file.size>LAB_ATTACHMENT_LIMITS.fileBytes)throw Error('Mỗi tệp được lưu tối đa 25 MB.');return file}
const calls=window.__fixtureFileCalls=[];
const key=context=>'fixture.files.'+context.ownerId;
const read=context=>JSON.parse(localStorage.getItem(key(context))||'[]');
const same=(left,right)=>['courseId','lessonId','platformKey'].every(name=>left[name]===right[name]);
const check=(context,signal)=>{if(signal?.aborted||window.__fixtureSync?.ownerId!==context.ownerId)throw Object.assign(Error('Phiên đã thay đổi'),{code:'REQUEST_ABORTED'})};
const meta=file=>Object.fromEntries(['id','name','sizeBytes','mimeType','createdAt'].map(name=>[name,file[name]]));
const encode=bytes=>{let text='';for(let start=0;start<bytes.length;start+=8192)text+=String.fromCharCode(...bytes.subarray(start,start+8192));return btoa(text)};
export class LabFileStore{
 async list(context,{signal}={}){check(context,signal);calls.push({kind:'list',...context});const files=read(context);return{files:files.filter(file=>same(file,context)).map(meta),limits:{...LAB_ATTACHMENT_LIMITS},usage:{usedBytes:files.reduce((sum,file)=>sum+file.sizeBytes,0),reservedBytes:0}}}
 async upload(context,file,{signal,onProgress}={}){check(context,signal);validateLabAttachment(file);calls.push({kind:'upload',name:file.name,...context});onProgress?.({loaded:0,total:file.size});const bytes=new Uint8Array(await file.arrayBuffer());check(context,signal);const value={...context,id:crypto.randomUUID(),name:file.name,sizeBytes:bytes.length,mimeType:file.type,createdAt:new Date().toISOString(),dataBase64:encode(bytes)};const files=read(context);files.push(value);localStorage.setItem(key(context),JSON.stringify(files));onProgress?.({loaded:bytes.length,total:file.size});return meta(value)}
 async download(context,file,{signal}={}){check(context,signal);calls.push({kind:'download',name:file.name,...context});const stored=read(context).find(value=>value.id===file.id&&same(value,context));if(!stored)throw Error('Không tìm thấy tệp');if(window.__fixtureHoldDownload)await new Promise(resolve=>window.__releaseFixtureDownload=resolve);check(context,signal);return Uint8Array.from(atob(stored.dataBase64),value=>value.charCodeAt(0))}
 async remove(context,id,{signal}={}){check(context,signal);calls.push({kind:'remove',id,...context});localStorage.setItem(key(context),JSON.stringify(read(context).filter(file=>file.id!==id||!same(file,context))));return{deleted:true}}
}
'''
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    context = browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
    errors=[]
    def route(r):
        parsed=urlparse(r.request.url)
        if parsed.path.endswith('/LearnerSyncService.js'):
            r.fulfill(status=200,content_type='text/javascript',body=fixture)
        elif parsed.path.endswith('/LabFileStore.js'):
            r.fulfill(status=200,content_type='text/javascript',body=file_store_fixture)
        elif parsed.netloc==urlparse(base).netloc:r.continue_()
        else:r.abort()
    context.route('**/*',route)
    page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(base+'/frontend/public/course.learning.html?course=arduino',wait_until='domcontentloaded')
    expect(page.locator('#lessonTitle')).to_be_visible()
    expect(page.locator('#labWorkSave')).to_be_disabled()
    assert not page.locator('#main').evaluate('(node)=>node.inert')
    page.locator('#courseSelect').select_option('microbit')
    page.locator('#lessonList button').nth(1).click();page.locator('#tabBtnLab').click()
    assert page.evaluate('course.id')=='microbit' and page.evaluate('lesson().id')=='buttons'
    expect(page.locator('#practiceFrame')).to_have_count(0)
    guest_record = {'microbit': {'buttons': {'note': 'Existing guest journal stays local', 'done': False,
        'labWork': {'python': {'version': 1, 'savedAt': '2026-11-19T00:00:00Z', 'code': 'legacy guest source',
            'notes': 'Legacy guest checkpoint', 'projectUrl': '', 'fileName': 'legacy.py'}}}}}
    guest_raw = json.dumps(guest_record)
    page.evaluate('(raw) => localStorage.setItem("strobot.original.course.v3",raw)', guest_raw)
    page.evaluate('__openWorkspace("ownerA")')
    expect(page.locator('#labWorkSave')).to_be_enabled()
    expect(page.locator('#labWorkNotes')).to_have_value('')
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') == guest_raw
    expect(page.locator('#labView')).to_be_visible()
    expect(page.locator('#practiceFrame')).to_have_count(1)
    assert page.evaluate('lesson().id')=='buttons' and page.evaluate('frameKey')=='python'
    page.locator('#labWorkSourceDetails > summary').click()
    page.locator('#labWorkCode').fill('print("owned source A")')
    page.locator('#labWorkNotes').fill('Resume after changing the button')
    expect(page.locator('#labWorkProjectUrl')).to_be_hidden()
    page.locator('#labWorkSave').click()
    expect(page.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
    saved = page.evaluate('JSON.parse(localStorage.getItem("fixture.owner.ownerA.strobot.original.course.v3"))')
    assert saved['microbit']['buttons']['labWork']['python']['code']=='print("owned source A")'
    page.locator('#labButtons button[data-lab-key="local"]').click()
    expect(page.locator('#labWorkCode')).to_have_value('')
    page.locator('#labWorkNotes').fill('Separate local-model checkpoint');page.locator('#labWorkSave').click()
    page.locator('#labButtons button[data-lab-key="python"]').click()
    expect(page.locator('#labWorkCode')).to_have_value('print("owned source A")')
    # Over-limit and binary imports leave the current checkpoint intact.
    page.locator('#labWorkFile').set_input_files({'name':'too-big.py','mimeType':'text/plain','buffer':b'x'*32769})
    expect(page.locator('#labWorkStatus')).to_contain_text('32 KiB')
    expect(page.locator('#labWorkCode')).to_have_value('print("owned source A")')
    page.locator('#labWorkFile').set_input_files({'name':'broken.py','mimeType':'text/plain','buffer':bytes([255,254])})
    expect(page.locator('#labWorkCode')).to_have_value('print("owned source A")')
    # Browser text import and restore use the visible UI, with safe download fallback.
    page.locator('#labWorkFile').set_input_files({'name':'my-code.py','mimeType':'text/plain','buffer':b'print("imported")'})
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    expect(page.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
    with page.expect_download() as download:page.locator('#labWorkDownload').click()
    assert download.value.suggested_filename=='my-code.py'
    # Attachments use a separate owner-scoped file store, without the old type/256 KiB/four-file limit.
    package = io.BytesIO()
    with zipfile.ZipFile(package, 'w') as archive:
        archive.writestr('main.py', 'print("native archive")')
        archive.writestr('data.bin', bytes([0, 255, 128, 10]))
    native_bytes = package.getvalue()
    png_bytes = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
    large_bytes = bytes(range(256)) * 2400  # 600 KiB in an arbitrary format.
    active_document = b'<html><script>window.UNSAFE_LAB_DOCUMENT=true</script><p>Saved lab markup</p></html>'
    uploads = [
        {'name':'python-backup.zip','mimeType':'application/zip','buffer':native_bytes},
        {'name':'ket-qua.png','mimeType':'image/png','buffer':png_bytes},
        {'name':'robot-capture.custom','mimeType':'application/octet-stream','buffer':large_bytes},
        {'name':'document.html','mimeType':'text/html','buffer':active_document},
        {'name':'README.md','mimeType':'text/markdown','buffer':b'# Private lab notes'},
    ]
    assert page.locator('#labWorkFiles').get_attribute('accept') in [None, '', '*/*']
    page.locator('#labWorkFiles').set_input_files(uploads)
    expect(page.locator('#labWorkFileList li')).to_have_count(5)
    for upload in uploads:
        expect(page.locator('#labWorkFileList')).to_contain_text(upload['name'])
    owner_a_course = page.evaluate('localStorage.getItem("fixture.owner.ownerA.strobot.original.course.v3")')
    work = json.loads(owner_a_course)['microbit']['buttons']['labWork']['python']
    assert not work.get('files') and 'robot-capture.custom' not in owner_a_course
    assert len(owner_a_course) < 10000, 'File bytes leaked into the ordinary learner snapshot'
    assert page.evaluate('JSON.parse(localStorage.getItem("fixture.files.ownerA")).length') == 5
    # The saved-work action opens a chooser. It never replaces the source form with an old copy.
    page.locator('#labWorkCode').fill('print("draft stays while viewing")')
    downloads_before = page.evaluate('__fixtureFileCalls.filter(call=>call.kind==="download").length')
    page.locator('#labWorkRestore').click()
    viewer = page.locator('dialog[data-lab-file-viewer]')
    expect(viewer).to_be_visible()
    expect(viewer.locator('.lab-file-viewer-choice')).to_have_count(5)
    assert page.evaluate('__fixtureFileCalls.filter(call=>call.kind==="download").length') == downloads_before
    expect(page.locator('#labWorkCode')).to_have_value('print("draft stays while viewing")')
    viewer.get_by_role('button',name='ket-qua.png',exact=False).click()
    expect(viewer.locator('.lab-file-viewer-preview img')).to_be_visible()
    page.wait_for_function('document.querySelector(".lab-file-viewer-preview img")?.naturalWidth === 1')
    with page.expect_download() as image_download:
        viewer.get_by_role('button',name='Tải tệp',exact=True).click()
    assert pathlib.Path(image_download.value.path()).read_bytes() == png_bytes
    viewer.get_by_role('button',name='robot-capture.custom',exact=False).click()
    expect(viewer.get_by_role('button',name='Tải tệp',exact=True)).to_be_enabled()
    with page.expect_download() as opaque_download:
        viewer.get_by_role('button',name='Tải tệp',exact=True).click()
    assert pathlib.Path(opaque_download.value.path()).read_bytes() == large_bytes
    viewer.get_by_role('button',name='document.html',exact=False).click()
    expect(viewer.locator('.lab-file-viewer-preview pre')).to_contain_text('window.UNSAFE_LAB_DOCUMENT=true')
    expect(viewer.locator('.lab-file-viewer-preview iframe')).to_have_count(0)
    assert page.evaluate('window.UNSAFE_LAB_DOCUMENT || false') is False
    viewer.get_by_role('button',name='python-backup.zip',exact=False).click()
    expect(viewer.get_by_role('button',name='Tải tệp',exact=True)).to_be_enabled()
    with page.expect_download() as native_download:
        viewer.get_by_role('button',name='Tải tệp',exact=True).click()
    assert pathlib.Path(native_download.value.path()).read_bytes() == native_bytes
    viewer.get_by_role('button',name='Đóng danh sách tệp đã lưu',exact=True).click()
    expect(viewer).to_be_hidden()
    expect(page.locator('#labWorkCode')).to_have_value('print("draft stays while viewing")')
    page.locator('#labWorkCode').fill('print("imported")')
    page.locator('#labWorkSave').click()
    # Each platform and lesson gets its own file list, including observation-only models.
    page.locator('#labButtons button[data-lab-key="local"]').click()
    expect(page.locator('#labWorkFileList li')).to_have_count(0)
    page.locator('#labWorkFiles').set_input_files({'name':'model-result.csv','mimeType':'text/csv','buffer':b'input,result\n330,9.09\n'})
    expect(page.locator('#labWorkFileList')).to_contain_text('model-result.csv')
    page.locator('#labButtons button[data-lab-key="python"]').click()
    expect(page.locator('#labWorkFileList li')).to_have_count(5)
    expect(page.locator('#labWorkFileList')).not_to_contain_text('model-result.csv')
    page.locator('#lessonList button').nth(0).click()
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkFileList li')).to_have_count(0)
    page.locator('#lessonList button').nth(1).click()
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkFileList li')).to_have_count(5)
    for width in [390, 1440]:
        page.set_viewport_size({'width':width,'height':1000})
        page.locator('#labWorkspace').scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=f'/tmp/strobot-native-save-{width}.png')
    page.reload(wait_until='domcontentloaded');page.evaluate('__openWorkspace("ownerA")')
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkFileList li')).to_have_count(5)
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    page.locator('#labWorkSourceDetails > summary').click()
    # Cancelling an upload keeps existing saved files; deleting one file is explicit.
    page.evaluate('''() => { window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseRemovedImport=()=>resolve(new TextEncoder().encode('superseded attachment').buffer))}; }''')
    page.locator('#labWorkFiles').set_input_files({'name':'new.py','mimeType':'text/plain','buffer':b'ignored'})
    page.locator('#labWorkCancelUpload').click()
    page.evaluate('() => {releaseRemovedImport(); File.prototype.arrayBuffer=originalArrayBuffer}')
    expect(page.locator('#labWorkCancelUpload')).to_be_hidden()
    expect(page.locator('#labWorkFileList li')).to_have_count(5)
    expect(page.locator('#labWorkFileList')).not_to_contain_text('new.py')
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#labWorkFileList li').filter(has_text='python-backup.zip').get_by_role('button',name='Xóa tệp',exact=True).click()
    expect(page.locator('#labWorkFileList li')).to_have_count(4)
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    # A different owner is never a write target for stale controls.
    page.evaluate('''() => { window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseImport=()=>resolve(new TextEncoder().encode('late-owner-source').buffer))}; }''')
    page.locator('#labWorkFile').set_input_files({'name':'late.py','mimeType':'text/plain','buffer':b'ignored'})
    page.evaluate('() => { __fixtureSync.ownerId="ownerB"; releaseImport(); File.prototype.arrayBuffer=originalArrayBuffer; }')
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    page.locator('#labWorkNotes').fill('Stale input must not reach B')
    page.locator('#labWorkSave').click()
    assert page.evaluate('localStorage.getItem("fixture.owner.ownerB.strobot.original.course.v3")') is None
    # A delayed native upload cannot commit after the active owner changes either.
    page.evaluate('''() => { __fixtureSync.ownerId="ownerA"; window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseOwnerUpload=()=>resolve(new Uint8Array([1,2,3,4]).buffer))}; }''')
    page.locator('#labWorkFiles').set_input_files({'name':'late-owner.artifact','mimeType':'application/octet-stream','buffer':b'1234'})
    page.evaluate('() => { __fixtureSync.ownerId="ownerB"; releaseOwnerUpload(); File.prototype.arrayBuffer=originalArrayBuffer; }')
    page.wait_for_timeout(100)
    assert page.evaluate('JSON.parse(localStorage.getItem("fixture.files.ownerA")).some(file=>file.name==="late-owner.artifact")') is False
    assert page.evaluate('localStorage.getItem("fixture.files.ownerB")') is None
    page.reload(wait_until='domcontentloaded');page.evaluate('__openWorkspace("ownerB")')
    expect(page.locator('#labWorkSave')).to_be_enabled()
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkNotes')).to_have_value('')
    expect(page.locator('#labWorkCode')).to_have_value('')
    expect(page.locator('#labWorkFileList li')).to_have_count(0)
    page.locator('#labWorkFiles').set_input_files({'name':'owner-b-private.png','mimeType':'image/png','buffer':png_bytes})
    expect(page.locator('#labWorkFileList')).to_contain_text('owner-b-private.png')
    owner_b_files = page.evaluate('localStorage.getItem("fixture.files.ownerB")')
    # Real scope-change notification on logout clears private source immediately.
    page.locator('#labWorkSourceDetails > summary').click()
    page.locator('#labWorkCode').fill('print("private owner B")')
    page.locator('#labWorkNotes').fill('Private account B checkpoint')
    page.locator('#labWorkSave').click()
    expect(page.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
    owner_b_saved = page.evaluate('localStorage.getItem("fixture.owner.ownerB.strobot.original.course.v3")')
    page.evaluate('''() => { window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseLogoutImport=()=>resolve(new TextEncoder().encode('late-after-logout').buffer))}; }''')
    page.locator('#labWorkFile').set_input_files({'name':'late-logout.py','mimeType':'text/plain','buffer':b'ignored'})
    page.locator('#labWorkRestore').click()
    expect(page.locator('dialog[data-lab-file-viewer]')).to_be_visible()
    page.locator('dialog[data-lab-file-viewer]').get_by_role('button',name='owner-b-private.png',exact=False).click()
    expect(page.locator('dialog[data-lab-file-viewer] .lab-file-viewer-preview img')).to_be_visible()
    with page.expect_navigation(wait_until='domcontentloaded'):
        page.evaluate('''() => { __fixtureSync.ownerId=null;
            document.dispatchEvent(new CustomEvent('strobot:learner-scope-changed',{detail:{previousUserId:'ownerB',userId:null}}));
            releaseLogoutImport(); }''')
    page.wait_for_function('typeof window.__openWorkspace === "function"')
    page.evaluate('__openWorkspace(null)')
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkSave')).to_be_disabled()
    expect(page.locator('#labWorkSave')).to_be_hidden()
    expect(page.locator('#labWorkSignInNotice')).to_be_visible()
    expect(page.locator('#labWorkSignIn')).to_have_attribute('href', 'account.html')
    expect(page.locator('#labWorkStatus')).to_contain_text('Đăng nhập')
    expect(page.locator('#labWorkNotes')).to_have_value('')
    expect(page.locator('#labWorkCode')).to_have_value('')
    assert 'private owner B' not in page.locator('#labWorkspace').inner_text()
    expect(page.locator('dialog[data-lab-file-viewer]')).to_be_hidden()
    expect(page.locator('#labWorkFileList li')).to_have_count(0)
    assert 'owner-b-private.png' not in page.locator('#labWorkspace').inner_text()
    assert page.evaluate('localStorage.getItem("fixture.files.ownerB")') == owner_b_files
    assert page.evaluate('localStorage.getItem("fixture.owner.ownerB.strobot.original.course.v3")') == owner_b_saved
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') == guest_raw
    # A synthetic click/input must not bypass disabled/hidden guest controls.
    page.evaluate('''() => {
        document.getElementById('labWorkCode').value='guest must not save';
        document.getElementById('labWorkCode').dispatchEvent(new Event('input',{bubbles:true}));
        document.getElementById('labWorkSave').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    }''')
    page.wait_for_timeout(650)
    assert page.evaluate('labWorkspace.persist()') is False
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') == guest_raw
    assert page.evaluate('localStorage.getItem("fixture.owner.ownerB.strobot.original.course.v3")') == owner_b_saved
    # Public theory, models and pre-existing guest journals remain usable.
    page.locator('#tabBtnTheory').click()
    expect(page.locator('#lessonTitle')).to_be_visible()
    page.locator('#tabBtnLab').click()
    page.locator('#labButtons button[data-lab-key="local"]').click()
    expect(page.locator('#localLab')).to_be_visible()
    expect(page.locator('#journal')).to_have_value('Existing guest journal stays local')
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') == guest_raw
    assert not errors,errors
    browser.close()
print('PASS account-bound files: five arbitrary attachments including PNG and 600 KiB binary; lazy chooser/image preview/safe HTML and exact downloads; scope/reload isolation; stale uploads/logout guards; preserved guest journals')

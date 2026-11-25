#!/usr/bin/env python3
"""Exercise public-first lessons and owner-bound lab drafts; no external accounts or AI."""
import argparse
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
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
    context = browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
    errors=[]
    def route(r):
        parsed=urlparse(r.request.url)
        if parsed.path.endswith('/LearnerSyncService.js'):
            r.fulfill(status=200,content_type='text/javascript',body=fixture)
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
    # Native project bytes are retained independently of the optional source copy.
    package = io.BytesIO()
    with zipfile.ZipFile(package, 'w') as archive:
        archive.writestr('main.py', 'print("native archive")')
        archive.writestr('data.bin', bytes([0, 255, 128, 10]))
    native_bytes = package.getvalue()
    page.locator('#labWorkFiles').set_input_files({'name':'python-backup.zip','mimeType':'application/zip','buffer':native_bytes})
    expect(page.locator('#labWorkFileList')).to_contain_text('python-backup.zip')
    expect(page.locator('#labWorkStatus')).to_contain_text('Đã đồng bộ')
    with page.expect_download() as native_download:
        page.locator('#labWorkFileList').get_by_role('button',name='Tải tệp',exact=True).click()
    assert pathlib.Path(native_download.value.path()).read_bytes() == native_bytes
    for width in [390, 1440]:
        page.set_viewport_size({'width':width,'height':1000})
        page.locator('#labWorkspace').scroll_into_view_if_needed()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=f'/tmp/strobot-native-save-{width}.png')
    page.reload(wait_until='domcontentloaded');page.evaluate('__openWorkspace("ownerA")')
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkFileList')).to_contain_text('python-backup.zip')
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    page.locator('#labWorkSourceDetails > summary').click()
    # Restoring or removing an attachment cancels older asynchronous imports.
    page.evaluate('''() => { window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseRestoreImport=()=>resolve(new TextEncoder().encode('superseded import').buffer))}; }''')
    page.locator('#labWorkFile').set_input_files({'name':'superseded.py','mimeType':'text/plain','buffer':b'ignored'})
    page.locator('#labWorkRestore').click()
    page.evaluate('() => {releaseRestoreImport(); File.prototype.arrayBuffer=originalArrayBuffer}')
    expect(page.locator('#labWorkCode')).to_have_value('print("imported")')
    page.evaluate('''() => { window.originalArrayBuffer=File.prototype.arrayBuffer;
        File.prototype.arrayBuffer=function(){return new Promise(resolve=>window.releaseRemovedImport=()=>resolve(new TextEncoder().encode('superseded attachment').buffer))}; }''')
    page.locator('#labWorkFiles').set_input_files({'name':'new.py','mimeType':'text/plain','buffer':b'ignored'})
    page.locator('#labWorkFileList').get_by_role('button',name='Bỏ khỏi bản lưu',exact=True).click()
    page.evaluate('() => {releaseRemovedImport(); File.prototype.arrayBuffer=originalArrayBuffer}')
    expect(page.locator('#labWorkFileList li')).to_have_count(0)
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
    page.reload(wait_until='domcontentloaded');page.evaluate('__openWorkspace("ownerB")')
    expect(page.locator('#labWorkSave')).to_be_enabled()
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkNotes')).to_have_value('')
    expect(page.locator('#labWorkCode')).to_have_value('')
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
print('PASS public-first lessons; signed-in lab persistence; stale-owner/delayed-import isolation; logout blocks guest lab saves and preserves prior guest records')

#!/usr/bin/env python3
"""Exercise public-first lessons and owner-bound lab drafts; no external accounts or AI."""
import argparse
import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5518')
parser.add_argument('--chromium', default='/usr/bin/chromium')
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
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') is None
    page.evaluate('__openWorkspace("ownerA")')
    expect(page.locator('#labWorkSave')).to_be_enabled()
    expect(page.locator('#labView')).to_be_visible()
    expect(page.locator('#practiceFrame')).to_have_count(1)
    assert page.evaluate('lesson().id')=='buttons' and page.evaluate('frameKey')=='python'
    page.locator('#labWorkspace summary').click()
    page.locator('#labWorkCode').fill('print("owned source A")')
    page.locator('#labWorkNotes').fill('Resume after changing the button')
    page.locator('#labWorkProjectUrl').fill('https://example.com/my-project')
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
    # An invalid restored session resolves to guest, without importing A/B records.
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#labWorkSave')).to_be_disabled()
    page.evaluate('__openWorkspace(null)')
    expect(page.locator('#labWorkSave')).to_be_enabled()
    page.locator('#tabBtnLab').click()
    expect(page.locator('#labWorkNotes')).to_have_value('')
    expect(page.locator('#labWorkCode')).to_have_value('')
    assert page.evaluate('localStorage.getItem("strobot.original.course.v3")') is None
    assert not errors,errors
    browser.close()
print('PASS public lessons stay usable while identity waits; selected lesson/tab survive; lab code/files persist by platform and account; stale-owner writes blocked')
